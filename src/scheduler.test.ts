/**
 * Run with: npx tsx src/scheduler.test.ts
 * Asserts the schedule engine's agreed behaviour (ADR 0004): fire when due,
 * skip instead of pile up, never back-fill, auto-pause after repeated failures.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScheduleStore, type ScheduleRecord } from "./schedule-store.js";
import {
  MAX_CONSECUTIVE_FAILURES,
  Scheduler,
  type RunOutcome,
  type SchedulerHooks,
} from "./scheduler.js";

let failures = 0;
let caseId = 0;

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

/**
 * Runs detach from tick/fireNow and persist through real file I/O, so
 * positive expectations poll until they hold (or time out and fail)…
 */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** …while negative expectations ("nothing else happened") get a settle window. */
function settle(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Harness = {
  store: ScheduleStore;
  scheduler: Scheduler;
  record: ScheduleRecord;
  runs: ScheduleRecord[];
  skips: { record: ScheduleRecord; reason: string }[];
  autoPauses: ScheduleRecord[];
  setNow: (date: Date) => void;
  setOutcome: (outcome: RunOutcome | "hang") => void;
};

const T0 = new Date(2026, 6, 31, 10, 0, 0, 0);
const MIN = 60_000;

async function harness(overrides: Partial<ScheduleRecord> = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "sched-test-"));
  const store = new ScheduleStore(join(dir, "schedules.json"));
  await store.load();

  caseId += 1;
  const record: ScheduleRecord = {
    id: `s${caseId}`,
    ownerId: "owner",
    channelId: "chan",
    threadId: "thread",
    prompt: "do the thing",
    workspace: "/tmp/ws",
    model: "sonnet",
    recurrence: { kind: "interval", everyMs: 30 * MIN },
    browserGrant: false,
    paused: false,
    consecutiveFailures: 0,
    createdAt: T0.toISOString(),
    nextRunAt: new Date(T0.getTime() + 30 * MIN).toISOString(),
    ...overrides,
  };
  await store.put(record);

  let now = T0;
  let outcome: RunOutcome | "hang" = "success";
  const state: Harness = {
    store,
    record,
    runs: [],
    skips: [],
    autoPauses: [],
    setNow: (date) => {
      now = date;
    },
    setOutcome: (value) => {
      outcome = value;
    },
    scheduler: undefined as unknown as Scheduler,
  };

  const hooks: SchedulerHooks = {
    run: (target) => {
      state.runs.push({ ...target });
      if (outcome === "hang") return new Promise<RunOutcome>(() => undefined);
      return Promise.resolve(outcome);
    },
    onSkip: (target, reason) => {
      state.skips.push({ record: { ...target }, reason });
    },
    onAutoPause: (target) => {
      state.autoPauses.push({ ...target });
    },
  };

  state.scheduler = new Scheduler(store, hooks, () => now);
  return state;
}

console.log("firing");

await check("a due schedule runs once and its next fire moves to the future", async () => {
  const h = await harness();
  h.setNow(new Date(T0.getTime() + 31 * MIN));
  await h.scheduler.tick();
  await until(() => h.runs.length === 1);
  assert.equal(h.skips.length, 0);
  const stored = h.store.get(h.record.id)!;
  // Grid from creation: fired the 10:30 slot at 10:31 → next is 11:00.
  assert.equal(stored.nextRunAt, new Date(T0.getTime() + 60 * MIN).toISOString());
  assert.equal(stored.lastFiredAt, new Date(T0.getTime() + 31 * MIN).toISOString());
});

await check("a schedule that is not due yet does not run", async () => {
  const h = await harness();
  h.setNow(new Date(T0.getTime() + 29 * MIN));
  await h.scheduler.tick();
  await settle();
  assert.equal(h.runs.length, 0);
});

await check("a paused schedule never fires", async () => {
  const h = await harness({ paused: true });
  h.setNow(new Date(T0.getTime() + 31 * MIN));
  await h.scheduler.tick();
  await settle();
  assert.equal(h.runs.length, 0);
  assert.equal(h.skips.length, 0);
});

console.log("\nskipping instead of piling up");

await check("while the previous run is still going, the next slot is skipped", async () => {
  const h = await harness();
  h.setOutcome("hang");
  h.setNow(new Date(T0.getTime() + 30 * MIN));
  await h.scheduler.tick();
  await until(() => h.runs.length === 1);

  h.setNow(new Date(T0.getTime() + 60 * MIN));
  await h.scheduler.tick();
  await settle();
  assert.equal(h.runs.length, 1, "no second concurrent run");
  assert.equal(h.skips.length, 1);
  assert.match(h.skips[0]!.reason, /รอบก่อน/);
  // The grid still advanced past the skipped slot.
  const stored = h.store.get(h.record.id)!;
  assert.equal(stored.nextRunAt, new Date(T0.getTime() + 90 * MIN).toISOString());
});

await check("start() reports rounds missed while the bot was down, without running them", async () => {
  const h = await harness();
  // Bot wakes up 65 minutes late: the 10:30 and 11:00 slots are gone.
  h.setNow(new Date(T0.getTime() + 65 * MIN));
  h.scheduler.start();
  h.scheduler.stop();
  await until(() => {
    const stored = h.store.get(h.record.id)!;
    return stored.nextRunAt === new Date(T0.getTime() + 90 * MIN).toISOString();
  });
  assert.equal(h.runs.length, 0);
  assert.equal(h.skips.length, 1);
  assert.match(h.skips[0]!.reason, /บอท/);
});

console.log("\nfailure handling");

await check("failures accumulate and auto-pause at the limit, notifying once", async () => {
  const h = await harness();
  h.setOutcome("failure");
  for (let round = 1; round <= MAX_CONSECUTIVE_FAILURES; round += 1) {
    h.setNow(new Date(T0.getTime() + round * 30 * MIN));
    await h.scheduler.tick();
    await until(() => h.store.get(h.record.id)!.consecutiveFailures === round);
  }
  assert.equal(h.runs.length, MAX_CONSECUTIVE_FAILURES);
  const stored = h.store.get(h.record.id)!;
  assert.equal(stored.paused, true);
  assert.equal(h.autoPauses.length, 1);

  // Paused now — the next due slot does nothing.
  h.setNow(new Date(T0.getTime() + 10 * 30 * MIN));
  await h.scheduler.tick();
  await settle();
  assert.equal(h.runs.length, MAX_CONSECUTIVE_FAILURES);
});

await check("a success resets the failure count", async () => {
  const h = await harness({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 });
  h.setNow(new Date(T0.getTime() + 30 * MIN));
  await h.scheduler.tick();
  await until(() => h.store.get(h.record.id)!.consecutiveFailures === 0);
  assert.equal(h.store.get(h.record.id)!.paused, false);
});

await check("a run that throws counts as a failure", async () => {
  const h = await harness();
  const throwing = new Scheduler(
    h.store,
    {
      run: () => Promise.reject(new Error("boom")),
      onSkip: () => undefined,
      onAutoPause: () => undefined,
    },
    () => new Date(T0.getTime() + 30 * MIN),
  );
  await throwing.tick();
  await until(() => h.store.get(h.record.id)!.consecutiveFailures === 1);
});

await check("skips do not count toward auto-pause", async () => {
  const h = await harness({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 });
  h.setOutcome("hang");
  h.setNow(new Date(T0.getTime() + 30 * MIN));
  await h.scheduler.tick();
  await until(() => h.runs.length === 1);

  // The next slot is skipped because the previous round is still going.
  h.setNow(new Date(T0.getTime() + 60 * MIN));
  await h.scheduler.tick();
  await settle();
  assert.equal(h.skips.length, 1);
  const stored = h.store.get(h.record.id)!;
  assert.equal(stored.consecutiveFailures, MAX_CONSECUTIVE_FAILURES - 1);
  assert.equal(stored.paused, false);
});

console.log("\nmanual fire (/schedule run and the rerun button)");

await check("fireNow runs immediately, even while paused", async () => {
  const h = await harness({ paused: true });
  const result = await h.scheduler.fireNow(h.record.id);
  assert.equal(result.started, true);
  await until(() => h.runs.length === 1);
});

await check("fireNow refuses to overlap a running round", async () => {
  const h = await harness();
  h.setOutcome("hang");
  await h.scheduler.fireNow(h.record.id);
  await until(() => h.runs.length === 1);
  const second = await h.scheduler.fireNow(h.record.id);
  assert.equal(second.started, false);
  assert.equal(h.runs.length, 1);
});

await check("deleting a schedule mid-run does not resurrect it", async () => {
  const h = await harness();
  let release: (outcome: RunOutcome) => void = () => undefined;
  const pending = new Promise<RunOutcome>((resolve) => {
    release = resolve;
  });
  const scheduler = new Scheduler(
    h.store,
    {
      run: () => pending,
      onSkip: () => undefined,
      onAutoPause: () => undefined,
    },
    () => new Date(T0.getTime() + 30 * MIN),
  );
  await scheduler.tick();
  await until(() => scheduler.isRunning(h.record.id));
  await h.store.delete(h.record.id);
  release("success");
  await until(() => !scheduler.isRunning(h.record.id));
  await settle();
  assert.equal(h.store.get(h.record.id), undefined);
});

await check("fireNow reports an unknown id", async () => {
  const h = await harness();
  const result = await h.scheduler.fireNow("nope");
  assert.equal(result.started, false);
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall scheduler tests passed");
