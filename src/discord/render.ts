import {
  AttachmentBuilder,
  type Message,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";

/** Any guild channel the bot posts into — a task thread or a plain text channel. */
export type Postable = TextChannel | NewsChannel | ThreadChannel;

const MAX_MESSAGE_LENGTH = 1900;
/** Past this length, prose is easier to read as an attached file. */
const ATTACH_THRESHOLD = 6000;
const STATUS_EDIT_INTERVAL_MS = 1500;
const STATUS_LINES = 6;

/** Splits text into Discord-sized chunks, preferring paragraph then line breaks. */
export function chunk(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  const chunks: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" "),
    );
    const cut = breakAt > limit * 0.5 ? breakAt : limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** One-line summary of a tool call, for the status message. */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const str = (key: string): string | undefined =>
    typeof input[key] === "string" ? (input[key] as string) : undefined;

  switch (name) {
    case "Bash":
      return `\`${truncate(str("command") ?? "", 120)}\``;
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return str("file_path") ?? "";
    case "Glob":
    case "Grep":
      return `${str("pattern") ?? ""}${str("path") ? ` in ${str("path")}` : ""}`;
    case "WebFetch":
      return str("url") ?? "";
    case "WebSearch":
      return str("query") ?? "";
    case "Task":
      return truncate(str("description") ?? "", 120);
    default: {
      const first = Object.values(input).find((value) => typeof value === "string");
      return typeof first === "string" ? truncate(first, 120) : "";
    }
  }
}

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * Posts agent output into a Discord thread: prose as messages, tool activity as
 * a single status message that gets edited in place so long runs don't spam.
 */
export class ThreadReporter {
  private statusMessage: Message | undefined;
  private activity: string[] = [];
  private headline = "";
  private lastEditAt = 0;
  private pendingEdit: NodeJS.Timeout | undefined;
  /** Serializes sends so messages land in the order they were produced. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly thread: Postable) {}

  /** Queues work on the send chain; failures are logged, never thrown at callers. */
  private enqueue(work: () => Promise<unknown>): Promise<void> {
    this.tail = this.tail.then(work).catch((error: unknown) => {
      console.error("[discord] failed to post to thread:", error);
    });
    return this.tail as Promise<void>;
  }

  async say(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    await this.enqueue(async () => {
      if (trimmed.length > ATTACH_THRESHOLD) {
        const file = new AttachmentBuilder(Buffer.from(trimmed, "utf8"), {
          name: "response.md",
        });
        await this.thread.send({
          content: "คำตอบยาวเกินขอบเขตข้อความ Discord — แนบเป็นไฟล์แทน",
          files: [file],
        });
        return;
      }
      for (const part of chunk(trimmed)) {
        await this.thread.send(part);
      }
    });
  }

  async attach(buffer: Buffer, name: string, note?: string): Promise<void> {
    await this.enqueue(() =>
      this.thread.send({
        ...(note ? { content: note } : {}),
        files: [new AttachmentBuilder(buffer, { name })],
      }),
    );
  }

  /** Sets the status headline, e.g. "กำลังคิด" or "รออนุมัติ". */
  setHeadline(headline: string): void {
    this.headline = headline;
    this.scheduleStatusUpdate();
  }

  addActivity(line: string): void {
    this.activity.push(line);
    if (this.activity.length > STATUS_LINES * 4) {
      this.activity = this.activity.slice(-STATUS_LINES);
    }
    this.scheduleStatusUpdate();
  }

  /** Removes the status message; call once the turn is finished. */
  async clearStatus(): Promise<void> {
    if (this.pendingEdit) {
      clearTimeout(this.pendingEdit);
      this.pendingEdit = undefined;
    }
    const message = this.statusMessage;
    this.statusMessage = undefined;
    this.activity = [];
    this.headline = "";
    if (!message) return;
    await this.enqueue(async () => {
      await message.delete().catch(() => undefined);
    });
  }

  private renderStatus(): string {
    const recent = this.activity.slice(-STATUS_LINES);
    const lines = [`⚙️ ${this.headline || "กำลังทำงาน"}`];
    if (recent.length > 0) {
      lines.push(...recent.map((entry) => `-# ${truncate(entry, 180)}`));
    }
    return lines.join("\n");
  }

  /** Coalesces rapid updates into at most one edit per interval. */
  private scheduleStatusUpdate(): void {
    if (this.pendingEdit) return;
    const elapsed = Date.now() - this.lastEditAt;
    const delay = Math.max(0, STATUS_EDIT_INTERVAL_MS - elapsed);
    this.pendingEdit = setTimeout(() => {
      this.pendingEdit = undefined;
      this.lastEditAt = Date.now();
      void this.flushStatus();
    }, delay);
  }

  private async flushStatus(): Promise<void> {
    // clearStatus may have run while this update was queued; don't resurrect it.
    if (!this.headline && this.activity.length === 0) return;
    const content = this.renderStatus();
    await this.enqueue(async () => {
      if (this.statusMessage) {
        await this.statusMessage.edit(content);
      } else {
        this.statusMessage = await this.thread.send(content);
      }
    });
  }
}
