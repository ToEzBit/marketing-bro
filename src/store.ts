import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type TaskRecord = {
  threadId: string;
  /** Discord user who started the task; may approve its tool requests. */
  ownerId: string;
  workspace: string;
  model: string;
  /** Claude Code session id, used to resume context after a bot restart. */
  sessionId?: string;
  createdAt: string;
};

/**
 * Thread-to-session mapping on disk, so a restarted bot can resume the
 * conversation in a thread instead of starting over.
 */
export class TaskStore {
  private records = new Map<string, TaskRecord>();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as TaskRecord[];
      for (const record of parsed) {
        this.records.set(record.threadId, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  get(threadId: string): TaskRecord | undefined {
    return this.records.get(threadId);
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

  private async flush(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      `${JSON.stringify([...this.records.values()], null, 2)}\n`,
      "utf8",
    );
  }
}
