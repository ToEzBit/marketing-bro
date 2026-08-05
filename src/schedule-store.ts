import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error("state file does not contain a JSON array");
      for (const record of parsed as ScheduleRecord[]) {
        this.records.set(record.id, record);
      }
    } catch (error) {
      await this.quarantine(raw, error);
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

  /**
   * A state file that can't be parsed must never block startup. Move it
   * aside (never delete it — an Operator may want to recover it by hand)
   * and log loudly, then carry on with empty state. Baseline b269ed3 let
   * this throw out of load() straight into main(), which exits the process.
   */
  private async quarantine(raw: string, error: unknown): Promise<void> {
    const quarantinePath = `${this.path}.corrupt-${timestampSuffix(new Date())}`;
    try {
      await rename(this.path, quarantinePath);
    } catch {
      // Original path is gone or unreadable by the time we got here (e.g. a
      // cross-device state dir) — fall back to persisting what we already
      // read, so the bytes are not lost even though the source stays put.
      await writeFile(quarantinePath, raw, "utf8").catch(() => undefined);
    }
    console.error(
      `[schedule-store] ${this.path} เสียหายหรือ parse ไม่ได้ — ย้ายไฟล์เดิมไปที่ ${quarantinePath} แล้วเริ่มด้วย state ว่าง (ตาราง Schedule จะหายไปจนกว่าจะกู้เอง) ตรวจไฟล์กักกันเพื่อกู้ข้อมูลเอง:`,
      error,
    );
  }

  private flush(): Promise<void> {
    this.tail = this.tail.catch(() => undefined).then(() => this.write());
    return this.tail;
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const data = `${JSON.stringify([...this.records.values()], null, 2)}\n`;
    const tmpPath = `${this.path}.tmp`;
    await writeFile(tmpPath, data, "utf8");
    await rename(tmpPath, this.path);
  }
}

/** Filesystem-safe timestamp for a quarantined file's suffix, e.g. 2026-08-05T12-00-00-000Z. */
function timestampSuffix(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
