import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import {
  describeRecurrence,
  nextFireAt,
  normalizeRecurrence,
  type Recurrence,
} from "./recurrence.js";
import { unbakeSkill } from "./skills.js";

export type ScheduleRecord = {
  id: string;
  /** Member who created the schedule; may resume/delete/run it (pause is everyone's). */
  ownerId: string;
  /** Channel the schedule was created in — the thread is recreated here if lost. */
  channelId: string;
  /** Permanent thread every Run posts into. */
  threadId: string;
  /** What the Member typed, with no skill instruction baked in — see `skill`. */
  prompt: string;
  /**
   * Skill this schedule runs under (ADR 0005), applied to `prompt` at run time
   * rather than stored folded into it, so `/schedule edit` can change one
   * without disturbing the other. Records written before this field existed
   * are normalised on load.
   */
  skill?: string;
  workspace: string;
  model: string;
  recurrence: Recurrence;
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
        this.records.set(record.id, normalizeSkill(normalizeClock(record)));
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
    // A parse failure partway through the array (e.g. a null element) may
    // have already set a few records before throwing — state must start
    // fully empty, matching what the log below tells the Operator.
    this.records.clear();

    const quarantinePath = `${this.path}.corrupt-${timestampSuffix(new Date())}`;
    let quarantined = true;
    try {
      await rename(this.path, quarantinePath);
    } catch {
      // Original path is gone or unreadable by the time we got here (e.g. a
      // cross-device state dir) — fall back to persisting what we already
      // read, so the bytes are not lost even though the source stays put.
      quarantined = await writeFile(quarantinePath, raw, "utf8")
        .then(() => true)
        .catch(() => false);
    }

    if (quarantined) {
      console.error(
        `[schedule-store] ${this.path} เสียหายหรือ parse ไม่ได้ — ย้ายไฟล์เดิมไปที่ ${quarantinePath} แล้วเริ่มด้วย state ว่าง (ตาราง Schedule จะหายไปจนกว่าจะกู้เอง) ตรวจไฟล์กักกันเพื่อกู้ข้อมูลเอง:`,
        error,
      );
    } else {
      console.error(
        `[schedule-store] ${this.path} เสียหายหรือ parse ไม่ได้ และกักกันไฟล์เดิมไม่สำเร็จ — เริ่มด้วย state ว่าง (ไฟล์เดิมอาจยังค้างอยู่ที่เดิม ยังไม่ถูกย้าย/สำรอง):`,
        error,
      );
    }
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

/**
 * Lifts a legacy record's single `hour`/`minute` clock into the list of times
 * a clock recurrence now holds (ADR 0011). Records already in the new shape
 * pass through untouched.
 */
function normalizeClock(record: ScheduleRecord): ScheduleRecord {
  const recurrence = normalizeRecurrence(record.recurrence);
  return recurrence === record.recurrence ? record : { ...record, recurrence };
}

/**
 * Splits a legacy record's baked-in skill instruction back out into `skill`.
 * Only records that predate the field are touched: once `skill` is set, the
 * prompt is already raw and unbaking it again would eat real prompt text.
 */
function normalizeSkill(record: ScheduleRecord): ScheduleRecord {
  if (record.skill !== undefined) return record;
  const { prompt, skill } = unbakeSkill(record.prompt);
  if (skill === undefined) return record;
  return { ...record, prompt, skill };
}

/**
 * The fields `/schedule edit` can change. Every one is optional and absence
 * means "leave it alone" — never "reset to the default", which is what
 * creation means by the same absence. `skill: null` is the one way to say
 * "remove it", since absence is already taken.
 */
export type ScheduleEdit = {
  prompt?: string;
  recurrence?: Recurrence;
  workspace?: string;
  model?: string;
  skill?: string | null;
};

/**
 * Applies an edit onto a record in place and returns a Thai line per field
 * that actually changed — an empty array means every value handed in matched
 * what was already there. A new recurrence recomputes `nextRunAt` off the
 * original `createdAt` anchor (ADR 0004: the grid is anchored at creation, and
 * an edit redraws the grid rather than moving its origin). `paused` and
 * `consecutiveFailures` are deliberately untouched: waking a schedule up and
 * forgiving its failures belong to `/schedule resume`, so editing a paused
 * schedule leaves it paused.
 */
export function applyScheduleEdit(
  record: ScheduleRecord,
  edit: ScheduleEdit,
  now: Date,
): string[] {
  const changes: string[] = [];

  if (edit.prompt !== undefined && edit.prompt !== record.prompt) {
    record.prompt = edit.prompt;
    // The new text, not just "the prompt changed": every other line below
    // reports its new value, and a thread that cannot show what the schedule
    // now does is not the audit trail ADR 0004 leans on.
    changes.push(`📝 prompt ใหม่: ${preview(edit.prompt)}`);
  }

  if (edit.skill !== undefined) {
    const skill = edit.skill ?? undefined;
    if (skill !== record.skill) {
      record.skill = skill;
      changes.push(skill ? `🧩 ใช้สกิล \`${skill}\`` : "🧩 เอาสกิลออก");
    }
  }

  if (
    edit.recurrence !== undefined &&
    describeRecurrence(edit.recurrence) !== describeRecurrence(record.recurrence)
  ) {
    record.recurrence = edit.recurrence;
    record.nextRunAt = nextFireAt(
      edit.recurrence,
      now,
      new Date(record.createdAt),
    ).toISOString();
    changes.push(`🔁 ${describeRecurrence(edit.recurrence)}`);
  }

  if (edit.workspace !== undefined && edit.workspace !== record.workspace) {
    record.workspace = edit.workspace;
    changes.push(`📂 \`${edit.workspace}\``);
  }

  if (edit.model !== undefined && edit.model !== record.model) {
    record.model = edit.model;
    changes.push(`🧠 \`${edit.model}\``);
  }

  return changes;
}

/**
 * A prompt flattened to one line for the change summary. Kept here rather than
 * reusing the renderer's truncate, so the store stays free of Discord imports.
 */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
}

/** Filesystem-safe timestamp for a quarantined file's suffix, e.g. 2026-08-05T12-00-00-000Z. */
function timestampSuffix(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
