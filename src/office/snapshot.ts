/**
 * Snapshot assembler ของ Office UI (spec §5.2 ตาราง precedence, ticket #18) — หัวใจของ
 * logic ทั้งระบบ: ตัวตัดสินว่าตัวละครแต่ละตัวอยู่โซนไหน
 *
 * เป็น **ฟังก์ชัน pure ตัวเดียว** โดยตั้งใจ: รับ live object เข้าไป คืน {@link OfficeSnapshot}
 * ออกมา ไม่มี state ของตัวเอง ไม่แตะ Discord ไม่อ้าง `Bot` และ **ไม่เรียก `Date.now()`**
 * (`now` ถูกส่งเข้ามาทาง input เสมอ) เพื่อให้ทดสอบ precedence ทั้งตารางได้ด้วยตัวเลขล้วน
 *
 * กติกาที่ห้ามละเมิด (ทั้งหมดมาจาก spec §3.4 / §4.1 และมีเทสต์คุมใน `snapshot.test.ts`):
 *  1. **ห้ามใส่ฟิลด์ที่ derive จากเวลาปัจจุบัน** ลง snapshot (`elapsedMs`, `remainingMs`,
 *     `idleForMs` ฯลฯ) — มีได้แต่ timestamp คงที่ ไม่งั้น poll-and-diff (spec §3.4) จะเห็นค่า
 *     ต่างกันทุกวินาทีแล้ว broadcast รัวตลอดเวลา ผลที่ตามมาคือ `now` ห้ามโผล่ในค่าใด ๆ นอกจาก
 *     ฟิลด์ `now` ของ snapshot เอง — รวมทั้งห้ามใช้เป็น fallback ของ `since` (ดู {@link sinceOf})
 *  2. **ห้าม mutate input** — ทุกครั้งที่ต้อง sort ให้ copy ก่อน (`[...xs].sort(...)`)
 *  3. ห้ามมี state ของ Browser ต่อตัวละคร — ไม่มีค่า state แบบ `browser_holder`/`browser_wait`
 *     และไม่มีฟิลด์ตำแหน่งคิวบน `Character` (โซน Browser ฝั่งเว็บ derive จาก `browserQueue` ล้วน)
 *  4. `kind: "run"` **ไม่มีทาง** ได้ `state: "approval"` (ADR 0004 — approval ใน Run ถูก deny เสมอ)
 */
import { describeTool, truncate } from "../discord/render.js";
import { MAX_CONSECUTIVE_FAILURES } from "../scheduler.js";
import type { OutcomeEntry } from "./feed.js";
import {
  FAILED_LINGER_MS,
  FAILED_ZONE_CAP,
  SNAPSHOT_VERSION,
  STOPPED_LINGER_MS,
  type AutoPausedScheduleView,
  type BrowserWaiterView,
  type Character,
  type CharacterOutcome,
  type CharacterState,
  type OfficeSnapshot,
  type PendingApprovalView,
} from "./types.js";

/**
 * คำนำหน้า requester/character id ของ Run (spec §5.3) — `BrowserQueue` ใช้รูปแบบนี้แยก Task
 * (threadId ตัวเลขล้วน) ออกจาก Run อยู่แล้ว snapshot จึงยึดรูปแบบเดียวกันทั้งระบบ
 */
const RUN_ID_PREFIX = "schedule:";

/**
 * คีย์ของตัวละคร Run จาก schedule id ล้วน — **T6 ต้องใช้ฟังก์ชันนี้ตอนเขียน `OutcomeEntry.id`
 * ของ Run ด้วย** ไม่งั้น dedupe (ตัวสดชนะผี) จะเงียบ ๆ ไม่ทำงานเพราะคีย์คนละแบบ
 */
export function runCharacterId(scheduleId: string): string {
  return `${RUN_ID_PREFIX}${scheduleId}`;
}

/** requester ใน `BrowserQueue` ที่เป็น Run — ใช้ตัดสินว่ามีเส้นตายได้ไหม (ADR 0006) */
function isRunRequester(requester: string): boolean {
  return requester.startsWith(RUN_ID_PREFIX);
}

/**
 * บรรทัด internal diagnostic ของ SDK (`[ede_diagnostic] result_type=user …`) ที่บอกอะไรกับคนอ่านไม่ได้
 * **สำเนาของ `INTERNAL_DIAGNOSTIC` ใน `bot.ts`** (ของเดิมเป็น const ระดับโมดูล ไม่ได้ export และ
 * import `bot.ts` เข้ามาที่นี่จะลาก discord.js ทั้งก้อนตามมา) — แก้ที่หนึ่งต้องแก้อีกที่ด้วย
 */
const INTERNAL_DIAGNOSTIC = /^\s*\[[a-z0-9_]+\]/i;

/** ความยาวสูงสุดของ `outcome.reason` ที่ส่งออกไป (spec §4.1 ข้อ 3) */
const REASON_LIMIT = 200;

// ————————————————————————————————————————————————————————————————
// View types — interface แคบ ๆ ที่ประกาศไว้เองเพื่อไม่ผูกกับคลาสจริง
// (structural typing ทำให้ `AgentSession`/`ThreadReporter`/`ScheduleRecord` ของจริงส่งเข้ามาได้ตรง ๆ
// และเทสต์เขียน fake เป็น object literal สั้น ๆ ได้โดยไม่ต้องสร้าง session จริง)
// ————————————————————————————————————————————————————————————————

/** ผลจบของ turn เท่าที่ assembler ต้องรู้ — subset ของ `TurnSummary` ใน `agent-session.ts` */
export type TurnSummaryView = {
  readonly status: "ok" | "failed" | "interrupted";
  readonly errors?: readonly string[];
};

/** getter ของ `AgentSession` เท่าที่ assembler อ่าน (spec §6.2 — read-only ล้วน) */
export type AgentSessionView = {
  readonly isBusy: boolean;
  /** `busy && stopRequested` — ทั้งสองครึ่งสำคัญ ดู P1 ใน {@link stateOf} */
  readonly isStopping: boolean;
  readonly isClosed: boolean;
  readonly startedAt: number;
  readonly turnStartedAt?: number;
  readonly stopRequestedAt?: number;
  readonly lastTurn?: { readonly summary: TurnSummaryView; readonly endedAt: number };
  readonly pendingApprovals: readonly {
    readonly toolName: string;
    readonly input: Record<string, unknown>;
    readonly since: number;
  }[];
};

/** getter ของ `ThreadReporter` เท่าที่ assembler อ่าน (spec §6.5) */
export type ReporterView = {
  readonly threadName: string;
  readonly threadUrl?: string;
  /** headline สดล่าสุด — **ใช้โชว์เท่านั้น ห้ามใช้ตัดสิน state** (ถูกทับด้วย "กำลังคิด" หลังกดอนุมัติ) */
  readonly currentHeadline: string;
};

/** ส่วนของ `TaskRecord` ที่ตัวละครต้องใช้ (`AgentSession` ไม่มี getter สองตัวนี้ และไม่ต้องมี) */
export type TaskRecordView = {
  readonly workspace: string;
  readonly model: string;
};

/** slot ที่ติดตั้งเสร็จแล้วในทะเบียน session — ตรงกับ `LiveSession` ใน `bot.ts` */
export type LiveSessionView = {
  readonly session: AgentSessionView;
  readonly reporter: ReporterView;
  readonly record: TaskRecordView;
};

/** ส่วนของ `ScheduleRecord` ที่ snapshot ต้องใช้ */
export type ScheduleRecordView = {
  readonly id: string;
  readonly threadId: string;
  readonly workspace: string;
  readonly model: string;
  readonly paused: boolean;
  readonly consecutiveFailures: number;
  /** ISO string เหมือน `ScheduleRecord.nextRunAt` (assembler แปลงเป็น epoch ms ให้เอง) */
  readonly nextRunAt: string;
};

/** ชื่อ + ลิงก์ของเธรดจาก cache ของ discord.js — T6 เป็นคนส่งเข้ามา (assembler ห้ามแตะ Discord เอง) */
export type DescribeThread = (threadId: string) => { name?: string; url?: string };

export type SnapshotInput = {
  /** เวลาของ Host ณ ตอนประกอบ snapshot — ใช้เทียบ linger เท่านั้น ห้ามรั่วลงฟิลด์อื่น */
  now: number;
  /** `config.approvalTimeoutMs` — เส้นตายของ approval ที่ `requestApproval` arm ไว้จริง */
  approvalTimeoutMs: number;
  /** ผลของ `SessionRegistry.entries()` — รวม slot ที่ยังสร้างไม่เสร็จ (`pending`) ด้วย */
  sessions: {
    threadId: string;
    state: "live" | "pending";
    entry?: LiveSessionView;
    since: number;
  }[];
  /** Run ที่กำลังวิ่ง — `id` คือ schedule id ล้วน (`Scheduler.runningIds()`), `since` คือ `runningSince(id)` */
  runs: {
    id: string;
    since: number;
    record: ScheduleRecordView;
    /** ยังไม่มีในช่วงแรกของรอบ (ก่อน `AgentSession` ถูกสร้าง) */
    session?: AgentSessionView;
  }[];
  /** สถานะคิว Browser ดิบจาก `BrowserQueue` (`holder` / `heldSince` / `waitingDetail()`) */
  browserQueue: {
    holder?: string;
    heldSince?: number;
    waiting: { requester: string; since: number; deadlineAt?: number }[];
  };
  /** ผลของ `OutcomeFeed.entries(now)` — ผีที่ยังไม่หมดอายุ ใหม่สุดก่อน */
  feed: OutcomeEntry[];
  /** ทุก `ScheduleRecord` ที่มีอยู่ — ใช้หาตัวที่ auto-pause เท่านั้น */
  schedules: ScheduleRecordView[];
  describeThread: DescribeThread;
};

// ————————————————————————————————————————————————————————————————
// ตัวช่วยเล็ก ๆ
// ————————————————————————————————————————————————————————————————

/**
 * เหตุผลที่คนอ่านรู้เรื่อง: ตัดบรรทัด internal diagnostic ทิ้งแล้ว `truncate(…, 200)`
 * (spec §4.1 ข้อ 3 — ห้ามส่ง stack trace ดิบออกไป)
 */
function cleanReason(lines: readonly string[]): string {
  const kept = lines
    .flatMap((line) => line.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !INTERNAL_DIAGNOSTIC.test(line));
  return truncate(kept.join("; "), REASON_LIMIT);
}

/** `""` ของ headline/ชื่อ = "ไม่มี" ตามสัญญาของ `Character` ที่ใช้ `null` */
function orNull(text: string | undefined): string | null {
  return text ? text : null;
}

/** ผี/ตัวสดที่หมดเวลา linger แล้ว — เกณฑ์เดียวกับ `ttlMsFor` ใน `feed.ts` เป๊ะ ๆ (`>=` ไม่ใช่ `>`) */
function lingerMsFor(status: "failed" | "interrupted"): number {
  return status === "failed" ? FAILED_LINGER_MS : STOPPED_LINGER_MS;
}

function isExpired(now: number, endedAt: number, status: "failed" | "interrupted"): boolean {
  return now - endedAt >= lingerMsFor(status);
}

/** approval ที่ค้างอยู่ เรียงเก่าสุดก่อน (ตัวเก่าสุดคือตัวที่เส้นตายถึงก่อน) — copy ก่อน sort เสมอ */
function approvalsOf(session: AgentSessionView, approvalTimeoutMs: number): PendingApprovalView[] {
  return [...session.pendingApprovals]
    .sort((a, b) => a.since - b.since)
    .map((approval) => ({
      tool: approval.toolName,
      summary: describeTool(approval.toolName, approval.input),
      since: approval.since,
      deadlineAt: approval.since + approvalTimeoutMs,
    }));
}

/** ผลของตาราง precedence หนึ่งแถว */
type Decision = {
  state: CharacterState;
  detail: string | null;
  since: number;
  deadlineAt: number | null;
  outcome: CharacterOutcome | null;
};

/**
 * ตาราง precedence ของ spec §5.2 — **ประเมินบนลงล่าง เจอก่อนใช้ก่อน** (P3/P4 ไม่อยู่ที่นี่
 * โดยตั้งใจ: ฝั่งเว็บ derive โซน Browser จาก `browserQueue` แหล่งเดียว ตัวละครที่ถือ/รอ Browser
 * ยังคงเป็น `working` ตาม P6)
 *
 * `fallbackSince` คือเวลาที่ตัวละครตัวนี้ปรากฏในห้อง (slot ถูกจอง / รอบเริ่มวิ่ง) ใช้เป็นที่พึ่ง
 * สุดท้ายของ `since` — **ห้ามใช้ `now` เป็น fallback เด็ดขาด** เพราะค่านั้นขยับทุก poll แล้ว
 * diff จะไม่มีวันเท่ากัน (spec §3.4)
 */
function decide(args: {
  now: number;
  session: AgentSessionView | undefined;
  approvals: PendingApprovalView[];
  /** Run เข้าโซน 3 ไม่ได้โดยนิยาม (ADR 0004) */
  canApprove: boolean;
  /** ซับไตเติลของช่วง "เพิ่งเกิด" — Task: "กำลังเข้ามา", Run: "กำลังเริ่มรอบ" (spec §5.4) */
  arrivingDetail: string;
  fallbackSince: number;
}): Decision {
  const { now, session, approvals, canApprove, arrivingDetail, fallbackSince } = args;
  const idle: Decision = { state: "idle", detail: null, since: fallbackSince, deadlineAt: null, outcome: null };

  // P5 — ยังไม่มี session จริง (slot เพิ่งถูกจอง / รอบเพิ่งเริ่ม) แต่คนพิมพ์ไปแล้ว ห้องต้องขยับทันที
  if (!session) {
    return { ...idle, state: "working", detail: arrivingDetail };
  }

  // P1 — สั่งหยุดระหว่างเทิร์นกำลังวิ่ง ชนะ P2 เสมอ: approval ที่กำลังถูก abort จะถูก deny ทิ้งอยู่แล้ว
  // โชว์โซน 3 ต่อ = หลอกให้คนไปกดปุ่มเปล่า (spec §5.2) — สังเกตว่าเงื่อนไขคือ `isBusy && stopRequested`
  // (`isStopping`) ไม่ใช่ `stopRequested` ล้วน: `/stop` ตอนไม่ busy ทิ้งธงค้างไว้จนเทิร์นหน้า
  // แต่ session นั้นก็แค่ว่าง ไม่มีอะไรกำลังถูกหยุด
  if (session.isStopping) {
    return {
      ...idle,
      state: "stopped",
      detail: "กำลังหยุด",
      since: session.stopRequestedAt ?? session.turnStartedAt ?? session.startedAt,
    };
  }

  // P2 — มีคำขออนุมัติค้าง (โซนที่ต้องเด่นที่สุดในห้อง)
  if (canApprove && approvals.length > 0) {
    const first = approvals[0];
    if (first) {
      return { ...idle, state: "approval", since: first.since, deadlineAt: first.deadlineAt };
    }
  }

  // P6 — เทิร์นกำลังวิ่ง (ผู้ถือ/ผู้รอคิว Browser ก็ตกอยู่ในข้อนี้ แล้วฝั่งเว็บย้ายไปโซน 4 เอง)
  if (session.isBusy) {
    return { ...idle, state: "working", since: session.turnStartedAt ?? fallbackSince };
  }

  const last = session.lastTurn;

  // P7 — เทิร์นล่าสุดถูกสั่งหยุด ยังไม่พ้น linger 2 นาที
  if (last?.summary.status === "interrupted" && !isExpired(now, last.endedAt, "interrupted")) {
    return {
      ...idle,
      state: "stopped",
      since: last.endedAt,
      outcome: {
        status: "interrupted",
        reason: cleanReason(last.summary.errors ?? []),
        endedAt: last.endedAt,
      },
    };
  }

  // P8 — เทิร์นล่าสุดล้มเหลว ยังไม่พ้น linger 15 นาที
  if (last?.summary.status === "failed" && !isExpired(now, last.endedAt, "failed")) {
    const reason = cleanReason(last.summary.errors ?? []);
    return {
      ...idle,
      state: "failed",
      detail: orNull(reason),
      since: last.endedAt,
      outcome: { status: "failed", reason, endedAt: last.endedAt },
    };
  }

  // P9 — ยังอยู่แต่ไม่เข้าข้อไหน
  return { ...idle, since: last?.endedAt ?? session.startedAt };
}

// ————————————————————————————————————————————————————————————————
// ประกอบตัวละครแต่ละชนิด
// ————————————————————————————————————————————————————————————————

function taskCharacter(
  slot: SnapshotInput["sessions"][number],
  input: SnapshotInput,
): Character | undefined {
  const live = slot.state === "live" ? slot.entry : undefined;
  const session = live?.session;

  // session ที่ตายแล้วไม่ใช่ตัวละครในห้องอีกต่อไป — ถ้าปล่อยให้ค้างเป็น `idle` มันจะ dedupe ผีของ
  // ตัวเองทิ้ง แล้วความล้มเหลวจะหายไปจากห้องเลย (ปกติ `bot.ts` ถอดออกจากทะเบียนทันทีอยู่แล้ว
  // อันนี้กันจังหวะคาบเกี่ยว) — เคส `wasResuming` ก็ออกทางนี้: หายไปเงียบ ๆ ไม่มีผี เพราะ
  // `bot.ts` ไม่เขียน feed ให้มันตั้งแต่แรก (spec §5.3, §5.5 จุดที่ 2)
  if (session?.isClosed) return undefined;

  const fromCache = input.describeThread(slot.threadId);
  const approvals = session ? approvalsOf(session, input.approvalTimeoutMs) : [];
  const decision = decide({
    now: input.now,
    session,
    approvals,
    canApprove: true,
    arrivingDetail: "กำลังเข้ามา",
    fallbackSince: slot.since,
  });

  return {
    id: slot.threadId,
    kind: "task",
    state: decision.state,
    detail: decision.detail,
    name: live?.reporter.threadName || fromCache.name || slot.threadId,
    headline: live ? orNull(live.reporter.currentHeadline) : null,
    threadId: slot.threadId,
    threadUrl: live?.reporter.threadUrl ?? fromCache.url ?? null,
    since: decision.since,
    deadlineAt: decision.deadlineAt,
    // slot ที่ยังจองอยู่ยังไม่มี `TaskRecord` ให้อ่าน — ช่วงนี้สั้นมาก (ไม่ถึงวินาที) และ
    // ค่าจริงจะโผล่เองตอน slot กลายเป็น live จึงไม่คุ้มที่จะลาก store ทั้งก้อนเข้ามาใน input
    workspace: live?.record.workspace ?? "",
    model: live?.record.model ?? "",
    approvals,
    outcome: decision.outcome,
  };
}

function runCharacter(run: SnapshotInput["runs"][number], input: SnapshotInput): Character {
  const record = run.record;
  const fromCache = input.describeThread(record.threadId);
  // approval ของ Run ถูก deny เสมอ (ADR 0004) รายการนี้จึงว่างเปล่าในทางปฏิบัติ — ส่งไปตามจริง
  // เพื่อให้การ์ดข้อมูลบอกความจริงได้ถ้าเกิดขึ้น แต่ `canApprove: false` กันไม่ให้มันเลื่อนโซน
  const approvals = run.session ? approvalsOf(run.session, input.approvalTimeoutMs) : [];
  const decision = decide({
    now: input.now,
    session: run.session,
    approvals,
    canApprove: false,
    arrivingDetail: "กำลังเริ่มรอบ",
    fallbackSince: run.since,
  });

  return {
    // ใช้ `record.id` เป็นแหล่งเดียวของ schedule id — `run.id` กับ `record.id` คือค่าเดียวกัน
    // แต่ยึดอันที่มีนิยามชัดว่าไม่มี prefix ไว้ กัน `schedule:schedule:x`
    id: runCharacterId(record.id),
    kind: "run",
    state: decision.state,
    detail: decision.detail,
    name: fromCache.name || record.id,
    // Run ไม่มี `ThreadReporter` ให้อ่าน — `bot.ts` สร้างมันไว้ในสโคปของ `runScheduledOnce` เท่านั้น
    headline: null,
    threadId: record.threadId || null,
    threadUrl: fromCache.url ?? null,
    since: decision.since,
    deadlineAt: decision.deadlineAt,
    workspace: record.workspace,
    model: record.model,
    approvals,
    outcome: decision.outcome,
  };
}

/** ผีจาก outcome feed — ตัวละครที่ยังต้องเห็นแม้ session/run ตายไปแล้ว (spec §5.5) */
function ghostCharacter(entry: OutcomeEntry, input: SnapshotInput): Character | undefined {
  // "ok" ไม่ใช่ผี มันคือสัญญาณล้างผีทิ้ง (`OutcomeFeed.record`) ไม่ควรหลุดมาถึงตรงนี้
  if (entry.status === "ok") return undefined;
  if (isExpired(input.now, entry.endedAt, entry.status)) return undefined;

  const reason = cleanReason(entry.reason ? [entry.reason] : []);
  const failed = entry.status === "failed";
  const fromCache = entry.threadId ? input.describeThread(entry.threadId) : {};

  return {
    id: entry.id,
    kind: entry.kind,
    state: failed ? "failed" : "stopped",
    detail: failed ? orNull(reason) : null,
    name: entry.name || entry.id,
    headline: null,
    threadId: entry.threadId ?? null,
    threadUrl: entry.threadUrl ?? fromCache.url ?? null,
    since: entry.endedAt,
    deadlineAt: null,
    workspace: entry.workspace,
    model: entry.model,
    approvals: [],
    outcome: { status: entry.status, reason, endedAt: entry.endedAt },
  };
}

function browserWaiter(waiter: SnapshotInput["browserQueue"]["waiting"][number]): BrowserWaiterView {
  return {
    id: waiter.requester,
    since: waiter.since,
    // Task รอได้ไม่จำกัด ไม่มีเส้นตาย (ADR 0006) — assembler เป็นเจ้าของกติกานี้ ไม่ใช่ส่งต่อค่าดิบ
    deadlineAt: isRunRequester(waiter.requester) ? (waiter.deadlineAt ?? null) : null,
  };
}

function autoPaused(record: ScheduleRecordView, input: SnapshotInput): AutoPausedScheduleView {
  const fromCache = input.describeThread(record.threadId);
  const nextRunAt = Date.parse(record.nextRunAt);
  return {
    id: record.id,
    name: fromCache.name || record.id,
    threadId: record.threadId || null,
    threadUrl: fromCache.url ?? null,
    consecutiveFailures: record.consecutiveFailures,
    // `nextRunAt` ที่พังจะกลายเป็น NaN ซึ่ง `JSON.stringify` เขียนเป็น `null` แล้วผิดสัญญา type
    nextRunAt: Number.isFinite(nextRunAt) ? nextRunAt : 0,
  };
}

// ————————————————————————————————————————————————————————————————
// ตัวประกอบหลัก
// ————————————————————————————————————————————————————————————————

/**
 * ประกอบ snapshot ก้อนเดียวที่บอทเสิร์ฟให้หน้าเว็บ — pure ล้วน เรียกซ้ำด้วย input เดิมกับ `now`
 * เดิมได้ผลเท่ากันทุกไบต์ และ (ยกเว้นฟิลด์ `now` ที่ T3 ตัดออกก่อนเทียบ) ผลจะเปลี่ยนก็ต่อเมื่อ
 * สถานะจริงในห้องเปลี่ยนเท่านั้น
 *
 * ลำดับงานสำคัญ: **dedupe → หมดอายุ → รวมเรียง → ตัดที่ 20** ถ้าตัดก่อน dedupe ผีของตัวสดที่
 * โดนตัดจะฟื้นกลับมาซ้อนกันเอง
 */
export function assembleSnapshot(input: SnapshotInput): OfficeSnapshot {
  // ลำดับของ `sessions`/`scheduleRuns` ยึดตามลำดับที่รับเข้ามาเป๊ะ ๆ ห้ามจัดเรียงใหม่:
  // ฝั่งเว็บแจกที่นั่งตาม index ในอาเรย์ ถ้าเรียงใหม่ตาม id ตัวใหม่ที่ id น้อยกว่าจะแทรกกลาง
  // แล้วทุกตัวหลังจากนั้นย้ายที่นั่งพร้อมกันทั้งห้อง
  const sessions = input.sessions
    .map((slot) => taskCharacter(slot, input))
    .filter((character): character is Character => character !== undefined);
  const scheduleRuns = input.runs.map((run) => runCharacter(run, input));

  // dedupe: ตัวสดชนะผีที่ id เดียวกันเสมอ — นี่คือกลไก "จนตัวเดิมเริ่ม turn ใหม่" ของ linger (spec §5.5)
  const liveIds = new Set([...sessions, ...scheduleRuns].map((character) => character.id));
  const outcomeFeed = input.feed
    .filter((entry) => !liveIds.has(entry.id))
    .map((entry) => ghostCharacter(entry, input))
    .filter((character): character is Character => character !== undefined)
    .sort((a, b) => b.since - a.since); // `.map()` คืนอาเรย์ใหม่แล้ว sort ตรงนี้ไม่แตะ input

  // cap 20 ของโซน 5: นับรวมทั้งตัวสดที่ `failed` และผี เรียงใหม่สุดก่อน เกินนั้นตัดทิ้ง
  // (ตัวสดที่โดนตัดหายจากห้องไปด้วย — ตัวที่ `failed` ปล่อย Browser ไปแล้วเสมอ จึงไม่มีทางเป็น
  //  holder/ผู้รอคิวที่ค้างอยู่ให้ขัดกัน)
  const dropped = failedZoneOverflow([...sessions, ...scheduleRuns, ...outcomeFeed]);
  const keep = (character: Character): boolean => !dropped.has(character.id);

  return {
    v: SNAPSHOT_VERSION,
    now: input.now,
    sessions: sessions.filter(keep),
    scheduleRuns: scheduleRuns.filter(keep),
    outcomeFeed: outcomeFeed.filter(keep),
    browserQueue: {
      holder: input.browserQueue.holder ?? null,
      heldSince: input.browserQueue.holder ? (input.browserQueue.heldSince ?? null) : null,
      waiting: input.browserQueue.waiting.map(browserWaiter),
    },
    autoPausedSchedules: input.schedules
      .filter((record) => record.paused && record.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES)
      .map((record) => autoPaused(record, input)),
  };
}

/**
 * id ของตัวละครโซน 5 ที่เกินโควตา — เรียงตามเวลาจบใหม่สุดก่อน ตัวที่เกิน {@link FAILED_ZONE_CAP}
 * ถูกคืนมาเป็นชุดที่ต้องตัดทิ้ง (sort ของ JS เสถียร ตัวสดจึงชนะผีเมื่อ `endedAt` เท่ากัน
 * เพราะถูกใส่เข้าอาเรย์ก่อน)
 */
function failedZoneOverflow(all: Character[]): Set<string> {
  const failed = all.filter((character) => character.state === "failed");
  if (failed.length <= FAILED_ZONE_CAP) return new Set();
  return new Set(
    [...failed]
      .sort((a, b) => (b.outcome?.endedAt ?? b.since) - (a.outcome?.endedAt ?? a.since))
      .slice(FAILED_ZONE_CAP)
      .map((character) => character.id),
  );
}
