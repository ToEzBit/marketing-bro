/**
 * The schedule engine (ADR 0004). Decides *when* things happen and keeps the
 * agreed discipline — skip instead of pile up, never back-fill, auto-pause
 * after repeated failures — while everything Discord- or agent-shaped comes in
 * through hooks, so this stays testable with a fake clock.
 */
import { nextFireAt } from "./recurrence.js";
import type { ScheduleRecord, ScheduleStore } from "./schedule-store.js";

export type RunOutcome = "success" | "failure";

export type SchedulerHooks = {
  /** Executes one Run to completion. Never rejects in normal operation. */
  run(record: ScheduleRecord): Promise<RunOutcome>;
  /** A due slot was not run; the reason is posted to the schedule's thread. */
  onSkip(record: ScheduleRecord, reason: string): void | Promise<void>;
  /** The schedule just paused itself after too many consecutive failures. */
  onAutoPause(record: ScheduleRecord): void | Promise<void>;
};

export const MAX_CONSECUTIVE_FAILURES = 3;
const TICK_INTERVAL_MS = 30_000;

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly running = new Set<string>();

  constructor(
    private readonly store: ScheduleStore,
    private readonly hooks: SchedulerHooks,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Reports the rounds that came due while the bot was down — they are skipped,
   * never back-filled; a human reruns manually if it matters — then ticks.
   */
  start(): void {
    for (const record of this.store.all()) {
      if (this.dueAt(record) > this.now().getTime()) continue;
      if (!record.paused) {
        const missed = new Date(record.nextRunAt).toLocaleString("th-TH");
        void this.hooks.onSkip(record, `พลาดรอบ ${missed} เพราะบอทไม่ได้รันอยู่ตอนนั้น`);
      }
      void this.advance(record).catch(this.logError);
    }
    this.timer = setInterval(() => void this.tick().catch(this.logError), TICK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** Fires every due schedule. Runs detach so one slow Run can't delay the rest. */
  async tick(): Promise<void> {
    const now = this.now().getTime();
    for (const record of this.store.all()) {
      if (record.paused) continue;
      if (this.dueAt(record) > now) continue;

      // Advance the grid before anything else, so a slow or failed round can
      // never make the same slot fire twice.
      await this.advance(record);

      if (this.running.has(record.id)) {
        void this.hooks.onSkip(record, "ข้ามรอบนี้เพราะรอบก่อนยังทำไม่เสร็จ");
        continue;
      }
      void this.execute(record).catch(this.logError);
    }
  }

  /** Manual fire (`/schedule run`, rerun button). Works while paused — an
   *  explicit human action outranks the pause — but still refuses to overlap. */
  async fireNow(id: string): Promise<{ started: boolean; reason?: string }> {
    const record = this.store.get(id);
    if (!record) return { started: false, reason: `ไม่พบ schedule \`${id}\`` };
    if (this.running.has(id)) {
      return { started: false, reason: "รอบก่อนยังทำไม่เสร็จ" };
    }
    void this.execute(record).catch(this.logError);
    return { started: true };
  }

  private readonly logError = (error: unknown): void => {
    console.error("[scheduler]", error);
  };

  private dueAt(record: ScheduleRecord): number {
    return new Date(record.nextRunAt).getTime();
  }

  private async advance(record: ScheduleRecord): Promise<void> {
    record.nextRunAt = nextFireAt(
      record.recurrence,
      this.now(),
      new Date(record.createdAt),
    ).toISOString();
    await this.persist(record);
  }

  /** A schedule deleted mid-flight must not be resurrected by bookkeeping. */
  private async persist(record: ScheduleRecord): Promise<void> {
    if (!this.store.get(record.id)) return;
    await this.store.put(record);
  }

  private async execute(record: ScheduleRecord): Promise<void> {
    this.running.add(record.id);
    record.lastFiredAt = this.now().toISOString();
    await this.persist(record);

    let outcome: RunOutcome;
    try {
      outcome = await this.hooks.run(record);
    } catch (error) {
      console.error(`[scheduler] run of ${record.id} threw:`, error);
      outcome = "failure";
    } finally {
      this.running.delete(record.id);
    }

    if (outcome === "success") {
      record.consecutiveFailures = 0;
    } else {
      record.consecutiveFailures += 1;
      if (record.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !record.paused) {
        record.paused = true;
        void this.hooks.onAutoPause(record);
      }
    }
    await this.persist(record);
  }
}
