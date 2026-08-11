/**
 * Run with: npx tsx src/browser-queue.test.ts
 * Asserts the Browser queue's agreed behaviour (ADR 0006): first come first
 * served, the next in line proceeds the moment the holder lets go, waiters can
 * leave (cancel) or expire (deadline) without wedging the line.
 */
import assert from "node:assert/strict";
import { BrowserQueue } from "./browser-queue.js";

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

/** A tick long enough for promise callbacks and short timers to run. */
function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log("acquiring a free browser");

await check("a free browser is acquired immediately and the requester holds it", async () => {
  const queue = new BrowserQueue();
  const outcome = await queue.acquire("task-a");
  assert.equal(outcome, "acquired");
  assert.equal(queue.holder, "task-a");
});

console.log("\nwaiting in line");

await check("a second task waits, then proceeds the moment the holder releases", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");

  let outcome: string | undefined;
  const waiting = queue.acquire("task-b").then((result) => (outcome = result));
  await settle();
  assert.equal(outcome, undefined, "task-b must still be waiting");
  assert.equal(queue.holder, "task-a");

  queue.release("task-a");
  await waiting;
  assert.equal(outcome, "acquired");
  assert.equal(queue.holder, "task-b");
});

await check("three tasks are served first come, first served", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const order: string[] = [];
  const b = queue.acquire("task-b").then(() => order.push("task-b"));
  const c = queue.acquire("task-c").then(() => order.push("task-c"));

  queue.release("task-a");
  await b;
  assert.equal(queue.holder, "task-b");
  queue.release("task-b");
  await c;
  assert.equal(queue.holder, "task-c");
  assert.deepEqual(order, ["task-b", "task-c"]);
});

await check("release by someone who is not the holder changes nothing", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  queue.release("task-b");
  assert.equal(queue.holder, "task-a");
});

await check("the holder acquiring again is a harmless no-op", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const outcome = await queue.acquire("task-a");
  assert.equal(outcome, "acquired");
  assert.equal(queue.holder, "task-a");
  queue.release("task-a");
  assert.equal(queue.holder, undefined);
});

await check("a waiter is told its position and who holds the browser", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const seen: Array<{ position: number; holder: string }> = [];
  void queue.acquire("task-b", { onWait: (position, holder) => seen.push({ position, holder }) });
  void queue.acquire("task-c", { onWait: (position, holder) => seen.push({ position, holder }) });
  await settle();
  assert.deepEqual(seen, [
    { position: 1, holder: "task-a" },
    { position: 2, holder: "task-a" },
  ]);
});

console.log("\nleaving the line early");

await check("aborting the signal while waiting resolves cancelled and leaves the line", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const abort = new AbortController();
  const waiting = queue.acquire("task-b", { signal: abort.signal });
  const behind = queue.acquire("task-c");
  await settle(5);

  abort.abort();
  assert.equal(await waiting, "cancelled");

  queue.release("task-a");
  assert.equal(await behind, "acquired");
  assert.equal(queue.holder, "task-c");
});

await check("cancelWaiting removes a requester from the line", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const waiting = queue.acquire("task-b");
  await settle(5);

  queue.cancelWaiting("task-b");
  assert.equal(await waiting, "cancelled");

  queue.release("task-a");
  assert.equal(queue.holder, undefined);
});

await check("cancelWaiting does not touch the holder", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  queue.cancelWaiting("task-a");
  assert.equal(queue.holder, "task-a");
});

await check("a waiter that moves up after a cancellation hears its new position", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const seen: number[] = [];
  const abort = new AbortController();
  void queue.acquire("task-b", { signal: abort.signal });
  void queue.acquire("task-c", { onWait: (position) => seen.push(position) });
  await settle(5);

  abort.abort();
  await settle(5);
  assert.deepEqual(seen, [2, 1]);
});

console.log("\ndeadlines (a Schedule waits at most until its own next round)");

await check("a deadline that passes while waiting resolves deadline and leaves the line", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const waiting = queue.acquire("schedule:s1", { deadlineAt: Date.now() + 30 });
  assert.equal(await waiting, "deadline");

  queue.release("task-a");
  assert.equal(queue.holder, undefined);
});

await check("a deadline already in the past resolves deadline right away when busy", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const outcome = await queue.acquire("schedule:s1", { deadlineAt: Date.now() - 1 });
  assert.equal(outcome, "deadline");
});

await check("a deadline is irrelevant when the browser is free", async () => {
  const queue = new BrowserQueue();
  const outcome = await queue.acquire("schedule:s1", { deadlineAt: Date.now() - 1 });
  assert.equal(outcome, "acquired");
  assert.equal(queue.holder, "schedule:s1");
});

await check("a deadline beyond setTimeout's 2^31-1 ms clamp does not fire early", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  let outcome: string | undefined;
  const waiting = queue
    .acquire("schedule:s1", { deadlineAt: Date.now() + 2 ** 31 + 60_000 })
    .then((result) => (outcome = result));
  await settle(30);
  assert.equal(outcome, undefined, "must still be waiting, not falsely at the deadline");
  queue.release("task-a");
  await waiting;
  assert.equal(outcome, "acquired");
});

await check("acquiring before the deadline stops the deadline from firing later", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const waiting = queue.acquire("schedule:s1", { deadlineAt: Date.now() + 500 });
  await settle(5);
  queue.release("task-a");
  assert.equal(await waiting, "acquired");
  await settle(30);
  assert.equal(queue.holder, "schedule:s1");
});

await check("waiting reports who is in line, in the order they will be served", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  assert.deepEqual(queue.waiting, [], "the holder is not one of the waiters");

  void queue.acquire("task-b");
  void queue.acquire("schedule:s1");
  await settle(5);
  assert.deepEqual(queue.waiting, ["task-b", "schedule:s1"]);

  queue.release("task-a");
  await settle(5);
  // task-b took the browser, so only the schedule is still in line.
  assert.equal(queue.holder, "task-b");
  assert.deepEqual(queue.waiting, ["schedule:s1"]);
});

console.log("\nthe timings behind the line (heldSince / waitingDetail)");

await check("heldSince follows the browser as it changes hands", async () => {
  const queue = new BrowserQueue();
  assert.equal(queue.heldSince, undefined, "nobody holds it yet");

  await queue.acquire("task-a");
  const heldByA = queue.heldSince;
  assert.equal(typeof heldByA, "number");

  await settle(5);
  await queue.acquire("task-a");
  assert.equal(queue.heldSince, heldByA, "the holder asking again is one hold, not a new one");
  void queue.acquire("task-b");
  await settle(5);
  assert.equal(queue.heldSince, heldByA, "someone joining the line does not touch the holder");

  queue.release("task-a");
  await settle(5);
  assert.equal(queue.holder, "task-b");
  assert.ok(queue.heldSince! > heldByA!, "the hand-over starts task-b's own clock");

  queue.release("task-b");
  assert.equal(queue.heldSince, undefined, "a browser nobody holds has nothing to time");
});

await check("waitingDetail is the same line as waiting, with since and the armed deadline", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  assert.deepEqual(queue.waitingDetail(), [], "the holder is not one of the waiters");

  const before = Date.now();
  const deadlineAt = before + 60_000;
  void queue.acquire("task-b");
  void queue.acquire("schedule:s1", { deadlineAt });
  await settle(5);

  const detail = queue.waitingDetail();
  assert.deepEqual(
    detail.map((waiter) => waiter.requester),
    queue.waiting,
    "same requesters, same FIFO order",
  );
  assert.ok(detail[0]!.since >= before && detail[0]!.since <= Date.now());
  // A Task waits as long as it takes (ADR 0006); only a Schedule brings a
  // deadline, and it is the value the timer was armed with — nothing recomputed.
  assert.equal(detail[0]?.deadlineAt, undefined);
  assert.equal(detail[1]?.deadlineAt, deadlineAt);

  queue.release("task-a");
  await settle(5);
  assert.deepEqual(
    queue.waitingDetail().map((waiter) => waiter.requester),
    ["schedule:s1"],
    "task-b took the browser and left the line",
  );
});

await check("a waiter that gave up is gone from waitingDetail too", async () => {
  const queue = new BrowserQueue();
  await queue.acquire("task-a");
  const abort = new AbortController();
  const waiting = queue.acquire("task-b", { signal: abort.signal });
  await settle(5);
  assert.equal(queue.waitingDetail().length, 1);

  abort.abort();
  assert.equal(await waiting, "cancelled");
  assert.deepEqual(queue.waitingDetail(), []);
});

if (failures > 0) {
  console.error(`\n${failures} browser-queue test(s) failed`);
  process.exit(1);
}
console.log("\nall browser-queue tests passed");
