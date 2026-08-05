/**
 * Run with: npx tsx src/discord/render.test.ts
 * Asserts ThreadReporter's status-message hook (issue #5): it reports the
 * new message's id the moment one is actually created, and undefined the
 * moment it's actually gone — the two facts a caller needs to persist so a
 * startup sweep can find and fix one stranded by a crash. The hook must
 * never fire ahead of what's really true in Discord (an edit of an existing
 * status message must not re-report the same id, and a create that never
 * happens must not report one at all).
 */
import assert from "node:assert/strict";
import { ThreadReporter, type Postable } from "./render.js";

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

let nextMessageId = 1;

type FakeMessage = {
  id: string;
  content: string;
  deleted: boolean;
  edit: (content: string) => Promise<FakeMessage>;
  delete: () => Promise<void>;
};

function fakeMessage(content: string): FakeMessage {
  const message: FakeMessage = {
    id: `msg-${nextMessageId++}`,
    content,
    deleted: false,
    edit: async (next) => {
      message.content = next;
      return message;
    },
    delete: async () => {
      message.deleted = true;
    },
  };
  return message;
}

/** Stands in for a thread: only send() is exercised by the status-message path. */
function fakeThread(): Postable & { sent: FakeMessage[] } {
  const sent: FakeMessage[] = [];
  const thread = {
    sent,
    send: async (content: unknown) => {
      const text =
        typeof content === "string" ? content : ((content as { content?: string }).content ?? "");
      const message = fakeMessage(text);
      sent.push(message);
      return message;
    },
  };
  return thread as unknown as Postable & { sent: FakeMessage[] };
}

console.log("status message hook — creation");

await check("the first status message reports its id", async () => {
  const thread = fakeThread();
  const seen: (string | undefined)[] = [];
  const reporter = new ThreadReporter(thread, (id) => seen.push(id));

  // First flush has zero debounce delay — a short tick is enough to see it.
  reporter.setHeadline("กำลังคิด");
  await until(() => thread.sent.length === 1);

  assert.deepEqual(seen, [thread.sent[0]!.id]);
});

await check("no hook passed is a harmless no-op", async () => {
  const thread = fakeThread();
  const reporter = new ThreadReporter(thread);
  reporter.setHeadline("กำลังคิด");
  await until(() => thread.sent.length === 1);
  await reporter.clearStatus();
  // Reaching here without throwing is the assertion — the hook is optional.
});

console.log("\nstatus message hook — editing an existing message");

await check("editing the same status message does not re-report an id", async () => {
  const thread = fakeThread();
  const seen: (string | undefined)[] = [];
  const reporter = new ThreadReporter(thread, (id) => seen.push(id));

  reporter.setHeadline("กำลังคิด");
  await until(() => thread.sent.length === 1);

  reporter.addActivity("Read foo.ts");
  // The second flush waits out the ~1.5s debounce — poll for the edit to land
  // instead of a blind sleep. Generous margin over STATUS_EDIT_INTERVAL_MS so
  // this doesn't flake on a loaded machine.
  await until(() => thread.sent[0]!.content.includes("Read foo.ts"), 4000);

  assert.equal(thread.sent.length, 1, "the same message was edited, not a second one sent");
  assert.deepEqual(seen, [thread.sent[0]!.id], "the hook fired exactly once, on creation only");
});

console.log("\nstatus message hook — clearing");

await check("clearStatus reports undefined once the message is gone", async () => {
  const thread = fakeThread();
  const seen: (string | undefined)[] = [];
  const reporter = new ThreadReporter(thread, (id) => seen.push(id));

  reporter.setHeadline("กำลังคิด");
  await until(() => thread.sent.length === 1);
  await reporter.clearStatus();

  assert.deepEqual(seen, [thread.sent[0]!.id, undefined]);
  assert.equal(thread.sent[0]!.deleted, true);
});

await check("clearStatus with nothing to clear never fires the hook", async () => {
  const thread = fakeThread();
  const seen: (string | undefined)[] = [];
  const reporter = new ThreadReporter(thread, (id) => seen.push(id));

  await reporter.clearStatus();
  assert.deepEqual(seen, []);
});

if (failures > 0) {
  console.error(`\n${failures} render test(s) failed`);
  process.exit(1);
}
console.log("\nall render tests passed");
