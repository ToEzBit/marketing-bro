import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type TaskRecord = {
  threadId: string;
  /** Discord user who started the task; may approve its tool requests. */
  ownerId: string;
  workspace: string;
  model: string;
  /** Claude Code session id, used to resume context after a bot restart. */
  sessionId?: string;
  /**
   * Id of the thread's current "⚙️ กำลังใช้…" status message, if one exists
   * right now — set the moment ThreadReporter creates one, cleared the
   * moment it's removed. Lets a startup sweep find and fix one stranded by a
   * crash instead of lying in the thread forever (issue #5).
   */
  statusMessageId?: string;
  createdAt: string;
};

/**
 * Thread-to-session mapping on disk, so a restarted bot can resume the
 * conversation in a thread instead of starting over.
 */
export class TaskStore {
  private records = new Map<string, TaskRecord>();
  /** Serializes writes — concurrent Tasks may flush at the same time. */
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
      for (const record of parsed as TaskRecord[]) {
        this.records.set(record.threadId, record);
      }
    } catch (error) {
      await this.quarantine(raw, error);
    }
  }

  get(threadId: string): TaskRecord | undefined {
    return this.records.get(threadId);
  }

  all(): TaskRecord[] {
    return [...this.records.values()];
  }

  async put(record: TaskRecord): Promise<void> {
    this.records.set(record.threadId, record);
    await this.flush();
  }

  async setSessionId(threadId: string, sessionId: string): Promise<void> {
    const record = this.records.get(threadId);
    if (!record || record.sessionId === sessionId) return;
    record.sessionId = sessionId;
    await this.flush();
  }

  /** Mirrors setSessionId: no record, or already this value, is a silent no-op. */
  async setStatusMessageId(threadId: string, statusMessageId: string | undefined): Promise<void> {
    const record = this.records.get(threadId);
    if (!record || record.statusMessageId === statusMessageId) return;
    record.statusMessageId = statusMessageId;
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
        `[task-store] ${this.path} เสียหายหรือ parse ไม่ได้ — ย้ายไฟล์เดิมไปที่ ${quarantinePath} แล้วเริ่มด้วย state ว่าง (เธรดจะขาดการเชื่อมโยง session เดิม) ตรวจไฟล์กักกันเพื่อกู้ข้อมูลเอง:`,
        error,
      );
    } else {
      console.error(
        `[task-store] ${this.path} เสียหายหรือ parse ไม่ได้ และกักกันไฟล์เดิมไม่สำเร็จ — เริ่มด้วย state ว่าง (ไฟล์เดิมอาจยังค้างอยู่ที่เดิม ยังไม่ถูกย้าย/สำรอง):`,
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

/** Filesystem-safe timestamp for a quarantined file's suffix, e.g. 2026-08-05T12-00-00-000Z. */
function timestampSuffix(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
