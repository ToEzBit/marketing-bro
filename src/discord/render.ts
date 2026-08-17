import {
  AttachmentBuilder,
  type Message,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { findDestructive, type DestructiveFinding } from "../policy.js";

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

// ---------------------------------------------------------------------------
// Plain-language explanation for the approval prompt.
//
// The person holding the button may not read shell. `explainTool` turns the
// pending call into one sentence about what happens to THEIR machine.
//
// The bot derives this from the command text itself — deliberately never from
// anything the agent wrote. The agent is the party asking for permission, so
// letting it author the sentence that persuades the human is how `rm -rf ~`
// gets approved under the label "ล้างไฟล์ชั่วคราว". Claude Code's own wording
// still appears in the embed, but labelled as coming from the agent.
//
// An explanation that is confidently wrong is worse than none: anything not
// recognised says so and points at the raw command instead of guessing.
// ---------------------------------------------------------------------------

/** Formats the files a command names, for inlining into a sentence. */
function targetList(targets: string[]): string {
  const shown = targets.slice(0, 3).map((target) => `\`${target}\``);
  const rest = targets.length - shown.length;
  return shown.join(", ") + (rest > 0 ? ` และอีก ${rest} รายการ` : "");
}

/** `<verb> <targets>` when the command names any, a generic phrase when not. */
function withTargets(verb: string, targets: string[], fallback: string): string {
  return targets.length > 0 ? `${verb} ${targetList(targets)}` : fallback;
}

function explainDestructive(finding: DestructiveFinding): string {
  const { kind, targets, segment } = finding;
  const recursive = /(^|\s)-[a-zA-Z]*[rR]|--recursive/.test(segment);

  switch (kind) {
    case "rm":
      return recursive
        ? `${withTargets("ลบ", targets, "ลบไฟล์")} **ทั้งโฟลเดอร์รวมทุกอย่างข้างใน** — ไม่ได้เข้าถังขยะ กู้คืนไม่ได้`
        : `${withTargets("ลบ", targets, "ลบไฟล์")} ทิ้งถาวร — ไม่ได้เข้าถังขยะ กู้คืนไม่ได้`;
    case "rmdir":
      return `${withTargets("ลบโฟลเดอร์", targets, "ลบโฟลเดอร์")} ทิ้ง (เฉพาะโฟลเดอร์ที่ว่างอยู่แล้ว)`;
    case "unlink":
      return `${withTargets("ลบไฟล์", targets, "ลบไฟล์")} ทิ้งถาวร`;
    case "shred":
      return `${withTargets("เขียนทับ", targets, "เขียนทับไฟล์")} ด้วยข้อมูลขยะแล้วลบทิ้ง — ตั้งใจให้กู้คืนไม่ได้เลย`;
    case "truncate":
      return `${withTargets("ล้างเนื้อหาข้างใน", targets, "ล้างเนื้อหาไฟล์")} ให้ว่างเปล่า — ตัวไฟล์ยังอยู่แต่ข้อมูลข้างในหายหมด`;
    case "git-clean":
      return "ลบไฟล์ที่ยังไม่เคยบันทึกเข้าประวัติโปรเจกต์ทิ้งทั้งหมด — ไฟล์ใหม่ที่เพิ่งสร้างจะหายไปด้วย";
    case "git-rm":
      return `${withTargets("ลบ", targets, "ลบไฟล์")} ออกจากโปรเจกต์และจากเครื่อง`;
    case "git-reset-hard":
      return "ย้อนโปรเจกต์กลับไปสถานะก่อนหน้า แล้ว**ทิ้งงานที่แก้ไว้แต่ยังไม่ได้บันทึก**ทั้งหมด";
    case "git-checkout-path":
      return `${withTargets("ดึงไฟล์", targets, "ดึงไฟล์")} เวอร์ชันที่บันทึกไว้กลับมาทับของปัจจุบัน — สิ่งที่แก้ค้างไว้จะหาย`;
    case "git-restore":
      return "คืนไฟล์กลับเป็นเวอร์ชันล่าสุดที่บันทึกไว้ — การแก้ที่ยังไม่ได้บันทึกจะหาย";
    case "git-stash-drop":
      return "ทิ้งงานที่พักไว้ชั่วคราว (stash) — เอากลับมาไม่ได้";
    case "find-delete":
      return "ค้นหาไฟล์ตามเงื่อนไข แล้วลบทุกไฟล์ที่เจอ — จำนวนขึ้นอยู่กับว่าค้นเจอกี่ไฟล์";
    case "find-exec":
      return "ค้นหาไฟล์ แล้วสั่งรันคำสั่งอื่นกับทุกไฟล์ที่เจอ — บอทตรวจไม่ได้ว่าคำสั่งนั้นทำอะไร";
    case "rsync-delete":
      return "คัดลอกไฟล์ไปโฟลเดอร์ปลายทาง แล้ว**ลบไฟล์ในปลายทางที่ต้นทางไม่มี**ทิ้ง";
    case "dd-overwrite":
      return "เขียนทับไฟล์หรือดิสก์ทั้งก้อน — ข้อมูลเดิมตรงนั้นหาย";
  }
}

/** Non-destructive commands worth glossing, keyed by `<command>` or `<cmd> <sub>`. */
const COMMAND_NOTES: Record<string, string> = {
  "npm install": "ดาวน์โหลดไลบรารีจากอินเทอร์เน็ตมาติดตั้งในโปรเจกต์",
  "npm i": "ดาวน์โหลดไลบรารีจากอินเทอร์เน็ตมาติดตั้งในโปรเจกต์",
  "npm ci": "ลบโฟลเดอร์ไลบรารีเดิมทิ้งแล้วติดตั้งใหม่ทั้งชุดจากอินเทอร์เน็ต",
  "npm run": "รันสคริปต์ที่โปรเจกต์ตั้งไว้ — บอทตรวจไม่ได้ว่าสคริปต์นั้นทำอะไร",
  "npm publish": "**เผยแพร่แพ็กเกจนี้ออกสู่สาธารณะ** บน npm — คนทั้งโลกเห็น",
  "git commit": "บันทึกงานที่แก้ไว้เข้าประวัติโปรเจกต์ (ยังอยู่บนเครื่องนี้ ยังไม่ส่งออก)",
  "git push": "ส่งงานจากเครื่องนี้ขึ้นเซิร์ฟเวอร์ (เช่น GitHub) ให้คนอื่นเห็น",
  "git merge": "รวมงานจากอีกสายหนึ่งเข้ากับสายปัจจุบัน",
  "git rebase": "เรียงประวัติงานใหม่ — ระหว่างทางไฟล์ถูกสลับไปมา",
  "git add": "ทำเครื่องหมายว่าจะเอาไฟล์ไหนเข้าการบันทึกครั้งถัดไป (ยังไม่แก้ไฟล์)",
  chmod: "เปลี่ยนสิทธิ์ของไฟล์ว่าใครอ่าน/เขียน/รันได้",
  chown: "เปลี่ยนเจ้าของไฟล์",
  mkdir: "สร้างโฟลเดอร์ใหม่",
  touch: "สร้างไฟล์เปล่า หรืออัปเดตเวลาแก้ไขล่าสุดของไฟล์",
  cp: "คัดลอกไฟล์ — ถ้าปลายทางมีไฟล์ชื่อเดียวกันอยู่ ไฟล์นั้นจะถูกเขียนทับ",
  mv: "ย้ายหรือเปลี่ยนชื่อไฟล์ — ถ้าปลายทางมีไฟล์ชื่อเดียวกันอยู่ ไฟล์นั้นจะถูกเขียนทับ",
  ln: "สร้างทางลัดชี้ไปยังไฟล์อื่น",
  kill: "สั่งปิดโปรแกรมที่กำลังทำงานอยู่บนเครื่อง",
  pkill: "สั่งปิดโปรแกรมที่กำลังทำงานอยู่บนเครื่อง (ค้นจากชื่อ)",
  killall: "สั่งปิดโปรแกรมที่กำลังทำงานอยู่บนเครื่อง (ทุกตัวที่ชื่อตรงกัน)",
  curl: "ดาวน์โหลดข้อมูลจากอินเทอร์เน็ต",
  wget: "ดาวน์โหลดไฟล์จากอินเทอร์เน็ต",
  ssh: "เชื่อมต่อเข้าไปสั่งงานเครื่องอื่นผ่านเน็ต",
  scp: "ส่งไฟล์ข้ามเครื่องผ่านเน็ต — ไฟล์จะออกจากเครื่องนี้",
  brew: "ติดตั้งหรือแก้ไขโปรแกรมระดับเครื่อง (Homebrew)",
  apt: "ติดตั้งหรือแก้ไขโปรแกรมระดับเครื่อง",
  "apt-get": "ติดตั้งหรือแก้ไขโปรแกรมระดับเครื่อง",
  pip: "ติดตั้งไลบรารี Python จากอินเทอร์เน็ต",
  pip3: "ติดตั้งไลบรารี Python จากอินเทอร์เน็ต",
  docker: "สั่งงาน Docker — สร้าง/รัน/ลบคอนเทนเนอร์บนเครื่องนี้",
  open: "เปิดไฟล์หรือแอปขึ้นมาบนเครื่อง",
  make: "รันชุดคำสั่งที่โปรเจกต์ตั้งไว้ — บอทตรวจไม่ได้ว่าข้างในทำอะไร",
  python: "รันสคริปต์ Python — บอทตรวจไม่ได้ว่าโค้ดข้างในทำอะไร",
  python3: "รันสคริปต์ Python — บอทตรวจไม่ได้ว่าโค้ดข้างในทำอะไร",
  node: "รันสคริปต์ JavaScript — บอทตรวจไม่ได้ว่าโค้ดข้างในทำอะไร",
  bash: "รันสคริปต์เชลล์ — บอทตรวจไม่ได้ว่าข้างในทำอะไร",
  sh: "รันสคริปต์เชลล์ — บอทตรวจไม่ได้ว่าข้างในทำอะไร",
  zsh: "รันสคริปต์เชลล์ — บอทตรวจไม่ได้ว่าข้างในทำอะไร",
};

const UNKNOWN_COMMAND =
  "บอทไม่รู้จักคำสั่งนี้ จึงอธิบายให้ไม่ได้ — อ่านคำสั่งข้างล่างก่อนกด ถ้าไม่แน่ใจให้ปฏิเสธไว้ก่อน";

/** Downloading a script and piping it straight into a shell. */
const PIPE_TO_SHELL = /\|\s*(sudo\s+)?(ba|z)?sh\b/;

function explainBash(command: string): string {
  const finding = findDestructive(command);
  if (finding) return explainDestructive(finding);

  if (PIPE_TO_SHELL.test(command)) {
    return "ดาวน์โหลดสคริปต์จากอินเทอร์เน็ตแล้ว**รันบนเครื่องนี้ทันที** — บอทตรวจไม่ได้เลยว่าข้างในทำอะไร";
  }

  const tokens = command.trim().split(/\s+/);
  const head = tokens[0] ?? "";
  const note = COMMAND_NOTES[`${head} ${tokens[1] ?? ""}`] ?? COMMAND_NOTES[head];
  if (!note) return UNKNOWN_COMMAND;

  return /\$\(|`/.test(command)
    ? `${note} · ⚠️ ในคำสั่งมีส่วนที่ให้ผลลัพธ์ของอีกคำสั่งมาเติมเอง บอทจึงไม่เห็นคำสั่งที่รันจริงทั้งหมด`
    : note;
}

/**
 * One plain-language sentence about what this tool call does to the host,
 * derived from the call itself. See the note above on why the agent's own
 * description is never used here.
 */
export function explainTool(name: string, input: Record<string, unknown>): string {
  const str = (key: string): string | undefined =>
    typeof input[key] === "string" ? (input[key] as string) : undefined;
  const path = str("file_path") ?? str("notebook_path");

  switch (name) {
    case "Bash":
      return explainBash(str("command") ?? "");
    case "Write":
      return `สร้างหรือเขียนทับไฟล์ ${path ? `\`${path}\`` : ""} — ถ้าไฟล์นั้นมีอยู่แล้ว เนื้อหาเดิมจะถูกแทนที่ทั้งหมด`;
    case "Edit":
      return `แก้ข้อความบางส่วนในไฟล์ ${path ? `\`${path}\`` : ""} (ส่วนอื่นของไฟล์คงเดิม)`;
    case "NotebookEdit":
      return `แก้เนื้อหาใน notebook ${path ? `\`${path}\`` : ""}`;
    case "WebFetch":
      return `เปิดอ่านหน้าเว็บ ${str("url") ? `\`${truncate(str("url")!, 100)}\`` : ""} แล้วเอาเนื้อหามาใช้ต่อ`;
    default:
      if (name.endsWith("browser_file_upload")) {
        return "อัปโหลดไฟล์จากเครื่องนี้ขึ้นเว็บ — **ไฟล์จะออกจากเครื่องคุณ** ไปอยู่บนเว็บนั้น";
      }
      if (name.endsWith("browser_run_code_unsafe")) {
        return "รันโค้ดบนเครื่องคุณผ่านช่องทางเบราว์เซอร์ — บอทตรวจไม่ได้ว่าโค้ดทำอะไร **ลบไฟล์ก็ได้**";
      }
      if (name.startsWith("mcp__browser__")) {
        return "สั่งงานเบราว์เซอร์ที่ล็อกอินบัญชีของคุณค้างไว้ — เว็บจะเห็นว่าเป็นคุณเองที่ทำ";
      }
      return UNKNOWN_COMMAND;
  }
}

/**
 * Reports the status message's id the moment one is actually created, and
 * undefined the moment it's actually gone — so a caller (never this class)
 * can persist the id and later find/fix a message stranded by a crash
 * (issue #5). Always fires from inside the same enqueued work that really
 * creates/removes the message, never eagerly off the caller's intent, so the
 * last value the hook reported is always still true.
 */
export type StatusMessageHook = (messageId: string | undefined) => void;

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

  constructor(
    private readonly thread: Postable,
    private readonly onStatusMessage?: StatusMessageHook,
  ) {}

  /** The name of the thread (or channel) this reporter posts into. */
  get threadName(): string {
    return this.thread.name;
  }

  /** Deep link to that thread, when the channel knows which guild it is in. */
  get threadUrl(): string | undefined {
    const guildId = this.thread.guildId;
    return guildId ? `https://discord.com/channels/${guildId}/${this.thread.id}` : undefined;
  }

  /**
   * The headline last handed to {@link setHeadline} ("" when there is none).
   * Something to *show*, never something to decide state by: it is overwritten
   * with "กำลังคิด" the moment an approval is answered, so a session waiting on
   * a human and one thinking are indistinguishable through this.
   */
  get currentHeadline(): string {
    return this.headline;
  }

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
    this.onStatusMessage?.(undefined);
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
        this.onStatusMessage?.(this.statusMessage.id);
      }
    });
  }
}
