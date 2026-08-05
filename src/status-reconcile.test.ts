/**
 * Run with: npx tsx src/status-reconcile.test.ts
 * Asserts the issue #5 startup sweep: a TaskRecord whose statusMessageId
 * survived a crash gets its stray "⚙️ กำลังใช้…" message edited to say the
 * task was interrupted (never left lying), and the field cleared either way
 * — including when the thread or message is already gone, which must stay
 * quiet and never fail startup. The last case replays the actual crash +
 * restart formula from the ticket's verify round, wiring a real
 * ThreadReporter to a real TaskStore on disk.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reconcileStatusMessages,
  STATUS_MESSAGE_INTERRUPTED,
  type ThreadFetcher,
} from "./bot.js";
import { ThreadReporter, type Postable } from "./discord/render.js";
import { TaskStore, type TaskRecord } from "./store.js";

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

/** Positive expectations poll until they hold (or time out and fail)… */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Fresh temp dir per case, so one case's state file can't leak into another. */
function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "status-reconcile-test-"));
}

/** Captures console.error output from fn instead of letting it dump into the test log. */
async function captureErrors(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines;
}

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    threadId: "t1",
    ownerId: "owner",
    workspace: "/tmp/ws",
    model: "sonnet",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

let nextMessageId = 1;

type FakeMessage = {
  id: string;
  content: string;
  edit: (content: string) => Promise<FakeMessage>;
  delete: () => Promise<void>;
};

function fakeMessage(content: string): FakeMessage {
  const message: FakeMessage = {
    id: `msg-${nextMessageId++}`,
    content,
    edit: async (next) => {
      message.content = next;
      return message;
    },
    // Exercised by ThreadReporter.clearStatus() in the combined regression
    // case below — a real Message would leave the channel; the fake just
    // needs to resolve so that final clearStatus() doesn't log a swallowed
    // "message.delete is not a function" error.
    delete: async () => undefined,
  };
  return message;
}

/** A fake thread: send() creates messages, messages.fetch() finds them by id
 *  (rejecting for an unknown id, like discord.js does for a deleted message). */
function fakeThread(): Postable & {
  sent: FakeMessage[];
  messages: { fetch: (id: string) => Promise<FakeMessage> };
} {
  const byId = new Map<string, FakeMessage>();
  const sent: FakeMessage[] = [];
  const thread = {
    sent,
    send: async (content: unknown) => {
      const text =
        typeof content === "string" ? content : ((content as { content?: string }).content ?? "");
      const message = fakeMessage(text);
      byId.set(message.id, message);
      sent.push(message);
      return message;
    },
    messages: {
      fetch: async (id: string) => {
        const message = byId.get(id);
        if (!message) throw new Error(`Unknown Message: ${id}`);
        return message;
      },
    },
  };
  return thread as unknown as Postable & {
    sent: FakeMessage[];
    messages: { fetch: (id: string) => Promise<FakeMessage> };
  };
}

/** A ThreadFetcher backed by a fixed thread-id → fake thread map, recording every call. */
function fetcherFor(threads: Map<string, Postable>): { fetcher: ThreadFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: ThreadFetcher = async (threadId) => {
    calls.push(threadId);
    return threads.get(threadId);
  };
  return { fetcher, calls };
}

console.log("reconcileStatusMessages");

await check("a status message that's still there gets edited and the field cleared", async () => {
  const store = new TaskStore(join(await tempDir(), "sessions.json"));
  await store.load();
  const thread = fakeThread();
  const stray = await thread.send("⚙️ กำลังใช้ Bash");
  await store.put(taskRecord({ statusMessageId: stray.id }));

  const { fetcher, calls } = fetcherFor(new Map([["t1", thread]]));
  await reconcileStatusMessages(store, fetcher);

  assert.deepEqual(calls, ["t1"]);
  assert.equal(stray.content, STATUS_MESSAGE_INTERRUPTED, "edited, not deleted");
  assert.equal(store.get("t1")!.statusMessageId, undefined);
});

await check(
  "a live reporter replacing the id mid-sweep is not clobbered by the sweep's own clear",
  async () => {
    // The sweep resolves one record over several awaited Discord calls
    // (fetch thread, fetch message, edit). A Task message can land through
    // Discord's own event and build a brand-new ThreadReporter — with a
    // brand-new status message of its own — for that same thread before the
    // sweep gets back around to clearing the field. This fetcher simulates
    // exactly that: a live reporter claims the field partway through the
    // sweep's own fetch.
    const store = new TaskStore(join(await tempDir(), "sessions.json"));
    await store.load();
    const thread = fakeThread();
    const stray = await thread.send("⚙️ กำลังใช้ Bash");
    await store.put(taskRecord({ statusMessageId: stray.id }));

    const { fetcher: baseFetcher } = fetcherFor(new Map([["t1", thread]]));
    const racingFetcher: ThreadFetcher = async (threadId) => {
      const result = await baseFetcher(threadId);
      await store.setStatusMessageId(threadId, "live-id-from-a-new-reporter");
      return result;
    };

    await reconcileStatusMessages(store, racingFetcher);

    assert.equal(stray.content, STATUS_MESSAGE_INTERRUPTED, "the stray message was still fixed");
    assert.equal(
      store.get("t1")!.statusMessageId,
      "live-id-from-a-new-reporter",
      "the sweep must not clear an id a live reporter set after the sweep started resolving it",
    );
  },
);

await check("a thread that's gone is skipped quietly and the field is cleared", async () => {
  const store = new TaskStore(join(await tempDir(), "sessions.json"));
  await store.load();
  await store.put(taskRecord({ statusMessageId: "msg-ghost" }));

  const { fetcher, calls } = fetcherFor(new Map());
  const logs = await captureErrors(() => reconcileStatusMessages(store, fetcher));

  assert.deepEqual(calls, ["t1"]);
  assert.deepEqual(logs, [], "an already-gone thread is expected, not an operator-facing error");
  assert.equal(store.get("t1")!.statusMessageId, undefined);
});

await check(
  "a message that's gone (thread still there) is skipped quietly and the field is cleared",
  async () => {
    const store = new TaskStore(join(await tempDir(), "sessions.json"));
    await store.load();
    const thread = fakeThread(); // never sent anything — the message id is unknown to it
    await store.put(taskRecord({ statusMessageId: "msg-ghost" }));

    const { fetcher } = fetcherFor(new Map([["t1", thread]]));
    const logs = await captureErrors(() => reconcileStatusMessages(store, fetcher));

    assert.deepEqual(logs, [], "an already-gone message is expected, not an operator-facing error");
    assert.equal(store.get("t1")!.statusMessageId, undefined);
  },
);

await check("no record has a pending status message — the fetcher is never called", async () => {
  const store = new TaskStore(join(await tempDir(), "sessions.json"));
  await store.load();
  await store.put(taskRecord({ threadId: "t1" }));
  await store.put(taskRecord({ threadId: "t2", statusMessageId: undefined }));

  const { fetcher, calls } = fetcherFor(new Map());
  await reconcileStatusMessages(store, fetcher);

  assert.deepEqual(calls, []);
});

console.log("\ncrash + restart (the ticket's verify formula)");

await check(
  "a status message left by a crashed reporter is fixed on restart, and a fresh reporter doesn't stack on it",
  async () => {
    const dir = await tempDir();
    const path = join(dir, "sessions.json");
    const store = new TaskStore(path);
    await store.load();
    await store.put(taskRecord());

    // First "process": a reporter creates a status message and is abandoned
    // mid-turn — never calls clearStatus(). This is the crash.
    const thread = fakeThread();
    const firstReporter = new ThreadReporter(thread, (id) => {
      void store.setStatusMessageId("t1", id);
    });
    firstReporter.setHeadline("กำลังใช้ Bash");
    await until(() => thread.sent.length === 1);
    await until(() => store.get("t1")?.statusMessageId === thread.sent[0]!.id);
    const strayId = thread.sent[0]!.id;

    // "Restart": a fresh store loaded from the same file, like a real reboot.
    const restarted = new TaskStore(path);
    await restarted.load();
    assert.equal(restarted.get("t1")!.statusMessageId, strayId, "the crash left the id on disk");

    const { fetcher } = fetcherFor(new Map([["t1", thread]]));
    await reconcileStatusMessages(restarted, fetcher);

    assert.equal(
      thread.sent[0]!.content,
      STATUS_MESSAGE_INTERRUPTED,
      "the stray message was fixed in place",
    );
    assert.equal(restarted.get("t1")!.statusMessageId, undefined);

    // A brand new reporter for the same thread works normally afterward: its
    // own status message is a distinct message, never the old one reused.
    const seen: (string | undefined)[] = [];
    const secondReporter = new ThreadReporter(thread, (id) => seen.push(id));
    secondReporter.setHeadline("กำลังใช้ Read");
    await until(() => thread.sent.length === 2);

    assert.notEqual(
      thread.sent[1]!.id,
      strayId,
      "the new status message is a distinct message, not the old one edited again",
    );
    assert.deepEqual(seen, [thread.sent[1]!.id]);

    await secondReporter.clearStatus();
  },
);

if (failures > 0) {
  console.error(`\n${failures} status-reconcile test(s) failed`);
  process.exit(1);
}
console.log("\nall status-reconcile tests passed");
