/**
 * Run with: npx tsx src/store.test.ts
 * Asserts TaskStore and ScheduleStore survive a corrupted state file on disk
 * (truncated/empty/non-array JSON) by quarantining it instead of throwing —
 * baseline b269ed3 let SyntaxError escape load() straight into main(), which
 * exits the process, so a half-written state file meant the bot could never
 * boot again. Also asserts writes are atomic (tmp + rename) and queued, so
 * many concurrent put()s never race each other into a torn file.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScheduleStore, type ScheduleRecord } from "./schedule-store.js";
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

/** Fresh temp dir per case, so one case's quarantine file can't leak into another. */
function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "store-test-"));
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

/** Finds the quarantine sibling load() should have created next to `base`. */
async function corruptSibling(dir: string, base: string): Promise<string | undefined> {
  const entries = await readdir(dir);
  return entries.find((name) => name.startsWith(`${base}.corrupt-`));
}

async function tmpLeftovers(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith(".tmp"));
}

console.log("TaskStore — corrupted state files");

await check("a missing file loads silently as empty state (ENOENT stays quiet)", async () => {
  const dir = await tempDir();
  const path = join(dir, "sessions.json");
  const store = new TaskStore(path);

  const logs = await captureErrors(() => store.load());

  assert.deepEqual(logs, []);
  assert.equal(store.get("thread-1"), undefined);
  assert.equal(await corruptSibling(dir, "sessions.json"), undefined);
});

await check("a truncated JSON file is quarantined, not thrown", async () => {
  const dir = await tempDir();
  const path = join(dir, "sessions.json");
  const truncated = `[{"threadId":"x"`;
  await writeFile(path, truncated, "utf8");
  const store = new TaskStore(path);

  const logs = await captureErrors(() => store.load());

  assert.equal(store.get("x"), undefined, "state starts empty");
  const sibling = await corruptSibling(dir, "sessions.json");
  assert.ok(sibling, "a quarantine file was created");
  const quarantined = await readFile(join(dir, sibling!), "utf8");
  assert.equal(quarantined, truncated, "original bytes preserved verbatim, not lost");
  await assert.rejects(
    () => readFile(path, "utf8"),
    /ENOENT/,
    "original path no longer holds the corrupt content — it was moved, not copied",
  );
  assert.ok(
    logs.some((line) => line.includes(sibling!)),
    "operator-facing log names the quarantine file",
  );
});

await check("an empty file is quarantined the same way", async () => {
  const dir = await tempDir();
  const path = join(dir, "sessions.json");
  await writeFile(path, "", "utf8");
  const store = new TaskStore(path);

  await captureErrors(() => store.load());

  assert.equal(store.get("anything"), undefined);
  assert.ok(await corruptSibling(dir, "sessions.json"), "a quarantine file was created for the empty file too");
});

await check("a JSON array that throws partway through still starts fully empty", async () => {
  const dir = await tempDir();
  const path = join(dir, "sessions.json");
  // The first element would populate the map before the second (not a real
  // record) throws while iterating — state must still end up fully empty,
  // matching what the quarantine log tells the Operator, not one dangling
  // record from before the throw.
  await writeFile(path, JSON.stringify([{ threadId: "a" }, null]), "utf8");
  const store = new TaskStore(path);

  await captureErrors(() => store.load());

  assert.equal(store.get("a"), undefined, "no partial record survives a mid-array failure");
  assert.ok(await corruptSibling(dir, "sessions.json"));
});

await check("after quarantine the store is fully usable again", async () => {
  const dir = await tempDir();
  const path = join(dir, "sessions.json");
  await writeFile(path, "not json at all", "utf8");
  const store = new TaskStore(path);
  await captureErrors(() => store.load());

  const record: TaskRecord = {
    threadId: "t1",
    ownerId: "owner",
    workspace: "/tmp/ws",
    model: "sonnet",
    createdAt: new Date().toISOString(),
  };
  await store.put(record);

  assert.deepEqual(store.get("t1"), record);
  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(onDisk, [record]);
});

console.log("\nTaskStore — atomic + queued writes");

await check("many concurrent put()s all land without racing, and no .tmp is left behind", async () => {
  const dir = await tempDir();
  const path = join(dir, "sessions.json");
  const store = new TaskStore(path);
  await store.load();

  const filler = "x".repeat(4000);
  const total = 50;
  const records: TaskRecord[] = Array.from({ length: total }, (_, i) => ({
    threadId: `thread-${i}`,
    ownerId: "owner",
    workspace: filler,
    model: "sonnet",
    createdAt: new Date().toISOString(),
  }));

  // Fired together, not awaited one by one — this is what two Tasks saving
  // at the same moment looks like.
  await Promise.all(records.map((record) => store.put(record)));

  for (const record of records) {
    assert.deepEqual(store.get(record.threadId), record);
  }
  const onDisk = JSON.parse(await readFile(path, "utf8")) as TaskRecord[];
  assert.equal(onDisk.length, total, "final file has every record, none lost to a torn write");
  assert.deepEqual(await tmpLeftovers(dir), [], "no .tmp file left on disk");
});

function goodTask(): TaskRecord {
  return {
    threadId: "thread-1",
    ownerId: "owner",
    workspace: "/tmp/ws",
    model: "sonnet",
    createdAt: new Date().toISOString(),
  };
}

await check("a stray .tmp left behind by a crashed write is ignored on load", async () => {
  const dir = await tempDir();
  const path = join(dir, "sessions.json");
  const good = goodTask();
  await writeFile(path, `${JSON.stringify([good], null, 2)}\n`, "utf8");

  // The half-written tmp a crash between writeFile() and rename() would
  // leave behind: load() reads this.path only, so it is neither loaded nor
  // mistaken for a corrupt state file.
  await writeFile(`${path}.tmp`, `[{"threadId":"half-writ`, "utf8");

  const store = new TaskStore(path);
  await store.load();

  assert.deepEqual(store.get("thread-1"), good, "the last good file, not the stray tmp, is what loads");
  assert.equal(await corruptSibling(dir, "sessions.json"), undefined, "a stray .tmp is not treated as corruption");
});

await check("a write interrupted before rename leaves the previous good file intact", async () => {
  const dir = await tempDir();
  const path = join(dir, "sessions.json");
  const good = goodTask();
  const goodBytes = `${JSON.stringify([good], null, 2)}\n`;
  await writeFile(path, goodBytes, "utf8");

  const store = new TaskStore(path);
  await store.load();

  // Wedges the real write path open at exactly the crash window: a directory
  // sitting at the tmp path makes writeFile(tmpPath) fail before rename() can
  // run. A write that targeted this.path directly would already have
  // truncated the good file by this point.
  await mkdir(`${path}.tmp`);

  await assert.rejects(
    () => store.put({ ...good, threadId: "thread-2" }),
    "a write that never reached rename() surfaces as a rejection, not a silent success",
  );

  assert.equal(await readFile(path, "utf8"), goodBytes, "the previous good file is byte-for-byte untouched");
  const reloaded = new TaskStore(path);
  await captureErrors(() => reloaded.load());
  assert.deepEqual(reloaded.get("thread-1"), good, "and it still loads as valid state");
  assert.equal(reloaded.get("thread-2"), undefined, "the record whose write failed never reached disk");
  assert.equal(await corruptSibling(dir, "sessions.json"), undefined, "nothing was quarantined");
});

console.log("\nScheduleStore — corrupted state files");

function scheduleRecord(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "s1",
    ownerId: "owner",
    channelId: "chan",
    threadId: "thread",
    prompt: "do the thing",
    workspace: "/tmp/ws",
    model: "sonnet",
    recurrence: { kind: "interval", everyMs: 30 * 60_000 },
    browserGrant: false,
    paused: false,
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
    nextRunAt: new Date().toISOString(),
    ...overrides,
  };
}

await check("a missing file loads silently as empty state (ENOENT stays quiet)", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  const store = new ScheduleStore(path);

  const logs = await captureErrors(() => store.load());

  assert.deepEqual(logs, []);
  assert.deepEqual(store.all(), []);
  assert.equal(await corruptSibling(dir, "schedules.json"), undefined);
});

await check("a truncated JSON file is quarantined, not thrown", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  const truncated = `[{"id":"x"`;
  await writeFile(path, truncated, "utf8");
  const store = new ScheduleStore(path);

  const logs = await captureErrors(() => store.load());

  assert.deepEqual(store.all(), []);
  const sibling = await corruptSibling(dir, "schedules.json");
  assert.ok(sibling, "a quarantine file was created");
  const quarantined = await readFile(join(dir, sibling!), "utf8");
  assert.equal(quarantined, truncated, "original bytes preserved verbatim, not lost");
  await assert.rejects(
    () => readFile(path, "utf8"),
    /ENOENT/,
    "original path no longer holds the corrupt content — it was moved, not copied",
  );
  assert.ok(
    logs.some((line) => line.includes(sibling!)),
    "operator-facing log names the quarantine file",
  );
});

await check("an empty file is quarantined the same way", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  await writeFile(path, "", "utf8");
  const store = new ScheduleStore(path);

  await captureErrors(() => store.load());

  assert.deepEqual(store.all(), []);
  assert.ok(await corruptSibling(dir, "schedules.json"), "a quarantine file was created for the empty file too");
});

await check("valid JSON that isn't an array counts as corrupt too", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  await writeFile(path, "{}", "utf8");
  const store = new ScheduleStore(path);

  await captureErrors(() => store.load());

  assert.deepEqual(store.all(), []);
  assert.ok(await corruptSibling(dir, "schedules.json"));
});

await check("a JSON array that throws partway through still starts fully empty", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  // The first element would populate the map before the second (not a real
  // record) throws while iterating — state must still end up fully empty,
  // matching what the quarantine log tells the Operator, not one dangling
  // record from before the throw.
  await writeFile(path, JSON.stringify([{ id: "a" }, null]), "utf8");
  const store = new ScheduleStore(path);

  await captureErrors(() => store.load());

  assert.equal(store.get("a"), undefined, "no partial record survives a mid-array failure");
  assert.deepEqual(store.all(), []);
  assert.ok(await corruptSibling(dir, "schedules.json"));
});

await check("after quarantine the store is fully usable again", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  await writeFile(path, "{}", "utf8");
  const store = new ScheduleStore(path);
  await captureErrors(() => store.load());

  const record = scheduleRecord();
  await store.put(record);

  assert.deepEqual(store.get(record.id), record);
  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(onDisk, [record]);
});

console.log("\nScheduleStore — atomic + queued writes");

await check("many concurrent put()s all land without racing, and no .tmp is left behind", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  const store = new ScheduleStore(path);
  await store.load();

  const filler = "x".repeat(4000);
  const total = 50;
  const records = Array.from({ length: total }, (_, i) => scheduleRecord({ id: `s-${i}`, prompt: filler }));

  await Promise.all(records.map((record) => store.put(record)));

  const onDisk = JSON.parse(await readFile(path, "utf8")) as ScheduleRecord[];
  assert.equal(onDisk.length, total, "final file has every record, none lost to a torn write");
  const ids = new Set(onDisk.map((r) => r.id));
  for (const record of records) {
    assert.ok(ids.has(record.id), `${record.id} present on disk`);
  }
  assert.deepEqual(await tmpLeftovers(dir), [], "no .tmp file left on disk");
});

await check("put()s and a delete() queue in call order instead of racing", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  const store = new ScheduleStore(path);
  await store.load();

  const a = scheduleRecord({ id: "a" });
  const b = scheduleRecord({ id: "b" });
  // Call order is: put(a), put(b), delete(a) — each records its mutation to
  // the in-memory map synchronously before its own flush is queued, so the
  // outcome is deterministic even though none of these are awaited yet.
  await Promise.all([store.put(a), store.put(b), store.delete("a")]);

  assert.equal(store.get("a"), undefined);
  assert.deepEqual(store.get("b"), b);
  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(onDisk, [b]);
  assert.deepEqual(await tmpLeftovers(dir), []);
});

await check("a stray .tmp left behind by a crashed write is ignored on load", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  const good = scheduleRecord();
  await writeFile(path, `${JSON.stringify([good], null, 2)}\n`, "utf8");

  // The half-written tmp a crash between writeFile() and rename() would
  // leave behind: load() reads this.path only, so it is neither loaded nor
  // mistaken for a corrupt state file.
  await writeFile(`${path}.tmp`, `[{"id":"half-writ`, "utf8");

  const store = new ScheduleStore(path);
  await store.load();

  assert.deepEqual(store.get(good.id), good, "the last good file, not the stray tmp, is what loads");
  assert.equal(await corruptSibling(dir, "schedules.json"), undefined, "a stray .tmp is not treated as corruption");
});

await check("a write interrupted before rename leaves the previous good file intact", async () => {
  const dir = await tempDir();
  const path = join(dir, "schedules.json");
  const good = scheduleRecord();
  const goodBytes = `${JSON.stringify([good], null, 2)}\n`;
  await writeFile(path, goodBytes, "utf8");

  const store = new ScheduleStore(path);
  await store.load();

  // Wedges the real write path open at exactly the crash window: a directory
  // sitting at the tmp path makes writeFile(tmpPath) fail before rename() can
  // run. A write that targeted this.path directly would already have
  // truncated the good file by this point.
  await mkdir(`${path}.tmp`);

  await assert.rejects(
    () => store.put(scheduleRecord({ id: "s2" })),
    "a write that never reached rename() surfaces as a rejection, not a silent success",
  );

  assert.equal(await readFile(path, "utf8"), goodBytes, "the previous good file is byte-for-byte untouched");
  const reloaded = new ScheduleStore(path);
  await captureErrors(() => reloaded.load());
  assert.deepEqual(reloaded.all(), [good], "and it still loads as valid state, without the failed write's record");
  assert.equal(await corruptSibling(dir, "schedules.json"), undefined, "nothing was quarantined");
});

if (failures > 0) {
  console.error(`\n${failures} store test(s) failed`);
  process.exit(1);
}
console.log("\nall store tests passed");
