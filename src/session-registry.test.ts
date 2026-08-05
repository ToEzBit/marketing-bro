/**
 * Run with: npx tsx src/session-registry.test.ts
 * Asserts the session register's agreed behaviour: one live session per thread
 * whatever the timing (single-flight), `/task` handing a thread over without
 * ever leaving it unowned, and sweeping only the sessions that are idle.
 *
 * Entries here are plain objects — the register is deliberately unaware of what
 * an Agent Session is, so these tests spawn nothing.
 */
import assert from "node:assert/strict";
import { SessionRegistry } from "./session-registry.js";

let failures = 0;

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A tick long enough for pending promise callbacks to run. */
function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Fake = { name: string };

type Harness = {
  registry: SessionRegistry<Fake>;
  /** Names of the sessions built, in order. */
  built: string[];
  /** Names of the sessions retired, in order. */
  retired: string[];
  /** Every step, so ordering between retire and build is assertable. */
  events: string[];
  /** A factory that builds instantly. */
  build: (name: string) => () => Fake;
  /** A factory that hangs until its returned `release` is called. */
  slowBuild: (name: string) => { factory: () => Promise<Fake>; release: () => void };
  /** Makes the next retire of `name` hang until the returned `release` runs. */
  hangRetire: (name: string) => () => void;
  /** Makes the next retire of `name` throw. */
  breakRetire: (name: string) => void;
};

function harness(): Harness {
  const built: string[] = [];
  const retired: string[] = [];
  const events: string[] = [];
  const hanging = new Map<string, Promise<void>>();
  const broken = new Set<string>();

  const registry = new SessionRegistry<Fake>({
    retire: async (entry) => {
      events.push(`retire:${entry.name}`);
      const wait = hanging.get(entry.name);
      if (wait) {
        hanging.delete(entry.name);
        await wait;
      }
      if (broken.delete(entry.name)) throw new Error(`cannot close ${entry.name}`);
      retired.push(entry.name);
    },
  });

  return {
    registry,
    built,
    retired,
    events,
    build: (name) => () => {
      built.push(name);
      events.push(`build:${name}`);
      return { name };
    },
    slowBuild: (name) => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        factory: async () => {
          built.push(name);
          events.push(`build:${name}`);
          await gate;
          return { name };
        },
        release,
      };
    },
    hangRetire: (name) => {
      let release: () => void = () => undefined;
      hanging.set(
        name,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return release;
    },
    breakRetire: (name) => {
      broken.add(name);
    },
  };
}

console.log("one session per thread");

await check("a thread with no session gets one, and it becomes the live one", async () => {
  const h = harness();
  const entry = await h.registry.getOrCreate("t1", h.build("a"));
  assert.deepEqual(entry, { name: "a" });
  assert.equal(h.registry.get("t1"), entry);
  assert.equal(h.registry.size, 1);
  assert.deepEqual(h.registry.values(), [entry]);
});

await check("a thread that already has a session never builds a second", async () => {
  const h = harness();
  const first = await h.registry.getOrCreate("t1", h.build("a"));
  const second = await h.registry.getOrCreate("t1", h.build("b"));
  assert.equal(second, first);
  assert.deepEqual(h.built, ["a"]);
});

await check("callers arriving while one is being built all get that same session", async () => {
  const h = harness();
  const slow = h.slowBuild("a");
  // All three land inside the build's await window — the slot is reserved from
  // the first call, so the later two must not start builds of their own.
  const first = h.registry.getOrCreate("t1", slow.factory);
  const second = h.registry.getOrCreate("t1", h.build("b"));
  await settle();
  const third = h.registry.getOrCreate("t1", h.build("c"));
  assert.equal(h.registry.get("t1"), undefined, "nothing is live until the build finishes");

  slow.release();
  const entries = await Promise.all([first, second, third]);
  assert.deepEqual(h.built, ["a"], "only the first caller's factory ran");
  assert.equal(entries[1], entries[0]);
  assert.equal(entries[2], entries[0]);
  assert.equal(h.registry.get("t1"), entries[0]);
  assert.equal(h.registry.size, 1);
});

await check("a build that fails leaves the thread empty and the next caller can retry", async () => {
  const h = harness();
  await assert.rejects(
    h.registry.getOrCreate("t1", () => {
      throw new Error("discord said no");
    }),
    /discord said no/,
  );
  assert.equal(h.registry.get("t1"), undefined);
  assert.equal(h.registry.size, 0);

  const entry = await h.registry.getOrCreate("t1", h.build("a"));
  assert.deepEqual(entry, { name: "a" });
});

await check("different threads keep their own sessions", async () => {
  const h = harness();
  const a = await h.registry.getOrCreate("t1", h.build("a"));
  const b = await h.registry.getOrCreate("t2", h.build("b"));
  assert.notEqual(a, b);
  assert.equal(h.registry.size, 2);
  await h.registry.close("t1");
  assert.equal(h.registry.get("t2"), b);
});

console.log("\n`/task` handing a thread over (replace)");

await check("the old session is retired before the new one is built", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("old"));
  const fresh = await h.registry.replace("t1", h.build("new"));
  assert.deepEqual(h.events, ["build:old", "retire:old", "build:new"]);
  assert.deepEqual(h.retired, ["old"]);
  assert.equal(h.registry.get("t1"), fresh);
  assert.equal(h.registry.size, 1);
});

await check("replace on a thread with no session just builds one", async () => {
  const h = harness();
  const entry = await h.registry.replace("t1", h.build("a"));
  assert.deepEqual(h.retired, []);
  assert.equal(h.registry.get("t1"), entry);
});

await check("a message arriving while the old session is still closing gets the new one", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("old"));
  const releaseClose = h.hangRetire("old");

  const handover = h.registry.replace("t1", h.build("new"));
  await settle();
  assert.deepEqual(h.retired, [], "the old session is still closing");
  // This is the `/task` race: mid-hand-over the thread must still have an
  // owner, or this call builds a rival session that nothing can reach.
  const arriving = h.registry.getOrCreate("t1", h.build("rival"));
  await settle();

  releaseClose();
  const [fresh, seen] = await Promise.all([handover, arriving]);
  assert.deepEqual(h.built, ["old", "new"], "no rival session was ever built");
  assert.equal(seen, fresh);
  assert.equal(h.registry.get("t1"), fresh);
  assert.equal(h.registry.size, 1);
});

await check("a message arriving while the new session is being built gets it too", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("old"));
  const slow = h.slowBuild("new");

  const handover = h.registry.replace("t1", slow.factory);
  await settle();
  const arriving = h.registry.getOrCreate("t1", h.build("rival"));
  await settle();

  slow.release();
  const [fresh, seen] = await Promise.all([handover, arriving]);
  assert.deepEqual(h.built, ["old", "new"]);
  assert.equal(seen, fresh);
  assert.deepEqual(h.retired, ["old"]);
});

await check("two hand-overs at once run in order and leave one session", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("old"));
  const slow = h.slowBuild("first");

  const one = h.registry.replace("t1", slow.factory);
  const two = h.registry.replace("t1", h.build("second"));
  await settle();
  slow.release();

  const [a, b] = await Promise.all([one, two]);
  assert.deepEqual(h.retired, ["old", "first"], "each session is closed as it is replaced");
  assert.equal(h.registry.get("t1"), b);
  assert.deepEqual(b, { name: "second" });
  assert.notEqual(a, b);
  assert.equal(h.registry.size, 1);
});

await check("a hand-over whose build fails leaves the thread empty, old session closed", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("old"));
  await assert.rejects(
    h.registry.replace("t1", () => Promise.reject(new Error("thread is gone"))),
    /thread is gone/,
  );
  assert.deepEqual(h.retired, ["old"]);
  assert.equal(h.registry.get("t1"), undefined);
  assert.equal(h.registry.size, 0);
});

console.log("\nclosing");

await check("close retires the session and empties the thread", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("a"));
  await h.registry.close("t1");
  assert.deepEqual(h.retired, ["a"]);
  assert.equal(h.registry.get("t1"), undefined);
  assert.equal(h.registry.size, 0);
});

await check("close on a thread with no session does nothing", async () => {
  const h = harness();
  await h.registry.close("t1");
  assert.deepEqual(h.retired, []);
});

await check("close waits for a session still being built, then retires it", async () => {
  const h = harness();
  const slow = h.slowBuild("a");
  const building = h.registry.getOrCreate("t1", slow.factory);

  let closed = false;
  const closing = h.registry.close("t1").then(() => (closed = true));
  await settle();
  assert.equal(closed, false, "close must not give up on a session mid-build");

  slow.release();
  await building;
  await closing;
  assert.deepEqual(h.retired, ["a"], "the freshly built session was closed, not leaked");
  assert.equal(h.registry.size, 0);
});

await check("closeAll retires every session, including one mid-build", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("a"));
  await h.registry.getOrCreate("t2", h.build("b"));
  const slow = h.slowBuild("c");
  const building = h.registry.getOrCreate("t3", slow.factory);

  const closing = h.registry.closeAll();
  slow.release();
  await building;
  await closing;
  assert.deepEqual([...h.retired].sort(), ["a", "b", "c"]);
  assert.equal(h.registry.size, 0);
});

await check("a session that refuses to close does not wedge the register (logs below)", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("a"));
  h.breakRetire("a");
  await h.registry.close("t1");
  assert.equal(h.registry.get("t1"), undefined);

  const entry = await h.registry.getOrCreate("t1", h.build("b"));
  assert.deepEqual(entry, { name: "b" });
});

console.log("\nsessions that die on their own (forget)");

await check("forget drops the session without closing it", async () => {
  const h = harness();
  const entry = await h.registry.getOrCreate("t1", h.build("a"));
  h.registry.forget("t1", entry);
  assert.equal(h.registry.get("t1"), undefined);
  assert.deepEqual(h.retired, [], "a dead session has nothing left to close");
});

await check("forget by a session that was already replaced leaves the new one alone", async () => {
  const h = harness();
  const old = await h.registry.getOrCreate("t1", h.build("old"));
  const fresh = await h.registry.replace("t1", h.build("new"));
  // The replaced session's death notice arrives late; it must not unregister
  // the session that took over the thread.
  h.registry.forget("t1", old);
  assert.equal(h.registry.get("t1"), fresh);
  assert.equal(h.registry.size, 1);
});

console.log("\nsweeping idle sessions");

await check("only the idle sessions are swept", async () => {
  const h = harness();
  const busy = await h.registry.getOrCreate("t1", h.build("busy"));
  await h.registry.getOrCreate("t2", h.build("idle"));
  const reaped = await h.registry.sweepIdle((entry) => entry.name === "idle");
  assert.deepEqual(reaped, ["t2"]);
  assert.deepEqual(h.retired, ["idle"]);
  assert.equal(h.registry.get("t1"), busy);
  assert.equal(h.registry.size, 1);
});

await check("a session still being built is never swept", async () => {
  const h = harness();
  const slow = h.slowBuild("a");
  const building = h.registry.getOrCreate("t1", slow.factory);
  const reaped = await h.registry.sweepIdle(() => true);
  assert.deepEqual(reaped, []);

  slow.release();
  const entry = await building;
  assert.equal(h.registry.get("t1"), entry, "it survives the sweep and goes live");
  assert.deepEqual(h.retired, []);
});

await check("a session that stops being idle mid-sweep is spared", async () => {
  const h = harness();
  await h.registry.getOrCreate("t1", h.build("first"));
  await h.registry.getOrCreate("t2", h.build("second"));
  const idle = new Set(["first", "second"]);
  // Closing the first one takes a while; the second gets a message meanwhile.
  const release = h.hangRetire("first");
  const sweeping = h.registry.sweepIdle((entry) => idle.has(entry.name));
  await settle();
  idle.delete("second");
  release();

  assert.deepEqual(await sweeping, ["t1"]);
  assert.deepEqual(h.retired, ["first"]);
  assert.equal(h.registry.size, 1);
});

if (failures > 0) {
  console.error(`\n${failures} session-registry test(s) failed`);
  process.exit(1);
}
console.log("\nall session-registry tests passed");
