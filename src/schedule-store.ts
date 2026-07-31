import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { Recurrence } from "./recurrence.js";

export type ScheduleRecord = {
  id: string;
  /** Member who created the schedule; may resume/delete/run it (pause is everyone's). */
  ownerId: string;
  /** Channel the schedule was created in — the thread is recreated here if lost. */
  channelId: string;
  /** Permanent thread every Run posts into. */
  threadId: string;
  prompt: string;
  workspace: string;
  model: string;
  recurrence: Recurrence;
  /** ADR 0004: whether the creator granted browser access at creation time. */
  browserGrant: boolean;
  paused: boolean;
  consecutiveFailures: number;
  /** Anchor for interval/every-N-days grids. */
  createdAt: string;
  /** Next planned fire, kept current by the Scheduler. */
  nextRunAt: string;
  lastFiredAt?: string;
};

/** Schedules on disk, so they survive bot restarts. Same shape as TaskStore. */
export class ScheduleStore {
  private records = new Map<string, ScheduleRecord>();
  /** Serializes writes — detached Runs and ticks may flush concurrently. */
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as ScheduleRecord[];
      for (const record of parsed) {
        this.records.set(record.id, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  all(): ScheduleRecord[] {
    return [...this.records.values()];
  }

  get(id: string): ScheduleRecord | undefined {
    return this.records.get(id);
  }

  newId(): string {
    let id: string;
    do {
      id = randomUUID().slice(0, 8);
    } while (this.records.has(id));
    return id;
  }

  async put(record: ScheduleRecord): Promise<void> {
    this.records.set(record.id, record);
    await this.flush();
  }

  async delete(id: string): Promise<void> {
    if (!this.records.delete(id)) return;
    await this.flush();
  }

  private flush(): Promise<void> {
    this.tail = this.tail.catch(() => undefined).then(() => this.write());
    return this.tail;
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      `${JSON.stringify([...this.records.values()], null, 2)}\n`,
      "utf8",
    );
  }
}
