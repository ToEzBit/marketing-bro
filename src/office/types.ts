/**
 * รูปร่าง (shape) ของ Office UI payload — แหล่งความจริงเดียวของ snapshot ที่บอทเสิร์ฟให้หน้าเว็บ
 * (spec §4). ไฟล์นี้มีแต่ type + ค่าคงที่ที่ ticket อื่นใช้ร่วมกัน **ไม่มี logic ใด ๆ**
 * เพื่อไม่ให้ต้องแย่งแก้ไฟล์เดียวกันข้าม ticket
 *
 * กติกาที่ต้องยึดทั้งไฟล์ (spec §4.1 — ตัดสินแล้ว ห้ามละเมิดตอน implement assembler):
 *  1. ห้ามมี state ของ Browser ต่อตัวละคร — ห้ามมีค่าอย่าง "browser_holder" ใน {@link CharacterState}
 *     และห้ามมีฟิลด์ "อยู่คิวที่เท่าไร" บน {@link Character} เด็ดขาด ตำแหน่งโซน Browser derive จาก
 *     {@link BrowserQueueView}.holder / .waiting แหล่งเดียวเท่านั้น (กัน state สองที่ drift กัน)
 *  2. `deadlineAt` มีได้เฉพาะเส้นตายที่บอท arm ไว้จริง (ไม่ใช่ค่าที่คำนวณสด) — ดูรายละเอียดที่ฟิลด์
 *  3. ห้ามส่งข้อมูลดิบที่ไม่จำเป็น (ไม่ใช่ input ของ tool ดิบ ๆ, ไม่ใช่ prompt, ไม่ใช่ stack trace)
 *  4. ห้ามมีฟิลด์ที่ derive จากเวลาปัจจุบัน (เช่น elapsedMs/remainingMs) — มีแต่ timestamp คงที่
 *     (`since`, `deadlineAt`, `endedAt`, `heldSince`, `nextRunAt`) ให้ฝั่งเว็บนับเอง ไม่งั้น
 *     poll-and-diff (spec §3.4) จะเห็นค่าต่างทุกวินาทีและ broadcast รัวตลอด
 */

/** เวอร์ชันของ snapshot ปัจจุบัน — เปลี่ยนโครง payload เมื่อไรให้ขึ้นเลขนี้ เพื่อให้หน้าเว็บเก่าที่ค้างอยู่รู้ตัว */
export const SNAPSHOT_VERSION = 1;

/** โซน 5 (ล้มเหลว) ค้างให้เห็น 15 นาที หรือจนตัวเดิมเริ่ม turn ใหม่ แล้วแต่อันไหนถึงก่อน (spec §5.4) */
export const FAILED_LINGER_MS = 15 * 60_000;

/** โซน 6 (ถูกสั่งหยุด จากผลจบ) ค้างให้เห็น 2 นาที (spec §5.4) */
export const STOPPED_LINGER_MS = 2 * 60_000;

/** จำนวนตัวละครสูงสุดในโซน 5 นับรวมทั้งตัวสดที่ `state === "failed"` และผีจาก outcome feed (spec §5.5) */
export const FAILED_ZONE_CAP = 20;

/** ขนาดสูงสุดของ outcome feed (ring buffer) — เกินนี้ตัดตัวเก่าสุดออก (spec §5.5) */
export const OUTCOME_FEED_CAP = 50;

/** ความถี่ที่บอท poll `snapshot()` เพื่อเทียบ diff ก่อน broadcast ผ่าน SSE (spec §3.4) */
export const POLL_INTERVAL_MS = 1_000;

/** Task = Agent Session ของเธรด, Run = รอบที่กำลังวิ่งของ Schedule (spec §5.1) — แยกกันแค่ป้ายชื่อ หน้าตาเหมือนกันทุกอย่าง */
export type CharacterKind = "task" | "run";

/**
 * สถานะที่ assembler ฝั่งบอทตัดสิน (P1, P2, P5–P9 ของตาราง precedence spec §5.2)
 * **P3/P4 (โต๊ะผู้ถือ / คิว Browser) ไม่อยู่ในลิสต์นี้โดยตั้งใจ** — ฝั่งเว็บ derive เอาเองจาก
 * {@link BrowserQueueView} ล้วน ๆ (spec §7.3 `zoneAndRoleFor`) ตัวละครที่ถือ/รอ Browser ยังคงมีค่า
 * `state: "working"` เหมือนเดิม (คง P6) ไม่มีค่า state แยกสำหรับ Browser
 */
export type CharacterState = "idle" | "working" | "approval" | "failed" | "stopped";

/**
 * คำขอ Approval หนึ่งรายการที่ยังค้างอยู่บนตัวละคร (parallel tool call ทำให้มีได้มากกว่า 1)
 */
export type PendingApprovalView = {
  /** ชื่อ tool ที่ขอสิทธิ์ เช่น `"Bash"` */
  tool: string;
  /** สรุปสั้น ๆ ของคำขอ — มาจาก `describeTool(toolName, input)` (`src/discord/render.ts`) ของเดิม
   *  ใช้ซ้ำเสมอ ห้ามส่ง `input` ดิบของ tool ตรง ๆ (กติกาข้อ 3) */
  summary: string;
  /** เวลาที่คำขอนี้ค้างเข้ามา (epoch ms) — timestamp คงที่ ฝั่งเว็บนับขึ้นเอง */
  since: number;
  /** เส้นตายจริงที่ `requestApproval` arm ไว้ = `since + config.approvalTimeoutMs` (spec §4.1 ข้อ 2) */
  deadlineAt: number;
};

/**
 * ผลจบของตัวละครที่อยู่โซน 5 (ล้มเหลว) หรือโซน 6 (ถูกสั่งหยุด) จาก "ผลจบ" — ไม่ใช่จากถูกสั่งหยุดสด ๆ
 * (P7/P8 เท่านั้น ไม่ใช่ P1) มีค่าเฉพาะตอนที่ตัวละครอยู่ในโซนเหล่านี้เพราะผลจบจริง ไม่มีค่าเมื่อ Task/Run
 * ยังทำงานปกติหรือถูกสั่งหยุดสด ๆ (ดู {@link Character.outcome})
 */
export type CharacterOutcome = {
  /** `"ok"` ไม่ปรากฏที่นี่ — ตัวละครที่จบแบบ ok ไม่มีวันติดโซน 5/6 (ผีของมันถูกล้างออกจาก feed แล้ว) */
  status: "failed" | "interrupted";
  /** เหตุผลสั้น ๆ — กรองบรรทัด internal diagnostic (regex `INTERNAL_DIAGNOSTIC` ใน `bot.ts`) แล้ว
   *  `truncate(…, 200)` แล้วเสมอ (กติกาข้อ 3) ไม่ใช่ stack trace ดิบ */
  reason: string;
  /** เวลาที่จบ (epoch ms) — timestamp คงที่ ใช้เทียบ linger (`FAILED_LINGER_MS`/`STOPPED_LINGER_MS`) */
  endedAt: number;
};

/**
 * ตัวละครหนึ่งตัวในห้อง — โครงเดียวกันทั้ง Task, Run และ "ผี" จาก outcome feed (spec §4)
 * รวมกันอยู่ใน `sessions[]` / `scheduleRuns[]` / `outcomeFeed[]` ของ {@link OfficeSnapshot}
 */
export type Character = {
  /** threadId (Task) หรือ `"schedule:<id>"` (Run) — คีย์ของตัวละคร ไม่ซ้ำกันทั้ง snapshot (spec §4.1 ข้อ 5) */
  id: string;
  kind: CharacterKind;
  /** ดู {@link CharacterState} — **ไม่มีค่า Browser ในนี้เด็ดขาด** (กติกาข้อ 1) */
  state: CharacterState;
  /** ซับไตเติลสั้น ๆ ใต้ป้ายชื่อ (เช่น `"กำลังเข้ามา"`, `"กำลังหยุด"`) หรือ `null` เมื่อไม่มี */
  detail: string | null;
  /** ชื่อเธรดเต็ม (หรือ schedule id เมื่อไม่รู้ชื่อ) — ส่งเต็มความยาวเสมอ ฝั่งเว็บเป็นคนตัดเหลือ ~24
   *  ตัวอักษรตอนวาดป้าย และโชว์เต็มในการ์ดข้อมูล (spec §4.1 ข้อ 4) ห้ามตัดฝั่งบอท */
  name: string;
  /** headline สดล่าสุดจาก `ThreadReporter.currentHeadline` (`src/discord/render.ts`) หรือ `null` เมื่อไม่มี
   *  — ใช้โชว์เท่านั้น ห้ามใช้ตัดสิน state (headline ถูกทับด้วย "กำลังคิด" หลังกดอนุมัติ) */
  headline: string | null;
  /** threadId ของ Discord หรือ `null` (Run ที่หาเธรดไม่เจอ) */
  threadId: string | null;
  /** `https://discord.com/channels/<guildId>/<threadId>` หรือ `null` เมื่อไม่รู้ guild/หาเธรดไม่เจอ */
  threadUrl: string | null;
  /** เข้าสถานะปัจจุบันเมื่อไร (epoch ms) — timestamp คงที่ ฝั่งเว็บนับ "นับขึ้น" จากค่านี้เสมอ ยกเว้นตอนที่
   *  มี `deadlineAt` (spec §5.6) */
  since: number;
  /**
   * เส้นตายจริงของสถานะปัจจุบัน หรือ `null` (spec §4.1 ข้อ 2 — ห้ามฝ่าฝืน):
   *  - Approval: `since + config.approvalTimeoutMs` (ค่าเดียวกับที่ `requestApproval` arm จริง)
   *  - Run ที่รอคิว Browser: **ไม่ใช่ที่นี่** — อยู่ที่ `browserQueue.waiting[].deadlineAt` ที่เดียว
   *    (ห้าม derive เองจาก `nextRunAt` เพราะค่านั้นเลื่อนได้ทุก tick และ `/schedule edit` เขียนทับได้)
   *  - Task ที่รอคิว Browser: ต้องเป็น `null` เสมอ (ADR 0006 — Task รอได้ไม่จำกัด ไม่มีเส้นตาย)
   *  - กรณีอื่นทั้งหมด (idle, working ปกติ, failed, stopped): `null`
   */
  deadlineAt: number | null;
  /** เส้นทาง workspace ที่ Task/Run นี้ทำงานอยู่ */
  workspace: string;
  /** ชื่อโมเดลที่ใช้ */
  model: string;
  /** คำขอ Approval ที่ยังค้าง — `[]` เมื่อไม่มี (parallel tool call ทำให้มีได้มากกว่า 1 พร้อมกัน) */
  approvals: PendingApprovalView[];
  /** ผลจบ เมื่อไม่ได้อยู่โซน 5/6 จากผลจบจริง (P8/P7) เป็น `null` — ดู {@link CharacterOutcome} */
  outcome: CharacterOutcome | null;
};

/** ผู้รอคิว Browser หนึ่งราย (spec §4, §4.1 ข้อ 2) */
export type BrowserWaiterView = {
  /** requester id ตามรูปแบบของ `BrowserQueue`: ตัวเลขล้วน = threadId (Task), `schedule:<id>` = Run */
  id: string;
  /** เวลาที่เริ่มรอ (epoch ms) — timestamp คงที่ */
  since: number;
  /**
   * เส้นตายที่ `BrowserQueue` arm ไว้จริง (`nextRunAt - 90s` ตอนเริ่มรอ ไม่ใช่ค่าคำนวณสด) หรือ `null`
   * เมื่อผู้รอเป็น Task (ADR 0006 — Task รอได้ไม่จำกัด ไม่มีเส้นตาย) **ห้ามให้ UI คำนวณเองจาก `nextRunAt`**
   */
  deadlineAt: number | null;
};

/**
 * สถานะคิว Browser ล้วน ๆ (ADR 0006) — แหล่งความจริงเดียวที่ใช้ derive โซน "รอคิว–ถือ Browser"
 * ของทุกตัวละคร (spec §4.1 ข้อ 1) ไม่มีตัวละครใดถือฟิลด์ตำแหน่งคิวของตัวเองเลย
 */
export type BrowserQueueView = {
  /** requester id ของผู้ถือปัจจุบัน หรือ `null` เมื่อ Browser ว่าง */
  holder: string | null;
  /** เวลาที่ผู้ถือปัจจุบันได้คิว (epoch ms) หรือ `null` เมื่อไม่มีผู้ถือ */
  heldSince: number | null;
  /** แถวคิว FIFO จริง — ลำดับ index ในอาเรย์นี้คือลำดับคิว (index+1 = หมายเลขที่แสดง) */
  waiting: BrowserWaiterView[];
};

/**
 * ป้าย/marker ของ Schedule ที่ถูก auto-pause (ล้มติดกันครบ `MAX_CONSECUTIVE_FAILURES`) แสดงในโซน 5
 * เท่านั้น ไม่ใช่ตัวละคร ไม่ใช่ roster บนผนัง — schedule ที่ Operator กด pause เอง **ไม่โผล่ที่นี่**
 * (spec §5.4) ข้อมูลมาจาก `ScheduleRecord.paused === true && consecutiveFailures >= 3` ล้วน ๆ
 */
export type AutoPausedScheduleView = {
  /** schedule id */
  id: string;
  /** ชื่อ schedule ตามที่ผู้ใช้ตั้ง */
  name: string;
  /** threadId ของเธรดที่ schedule นี้โพสต์อยู่ หรือ `null` เมื่อหาเธรดไม่เจอ */
  threadId: string | null;
  /** `https://discord.com/channels/<guildId>/<threadId>` หรือ `null` เมื่อไม่รู้ guild/หาเธรดไม่เจอ */
  threadUrl: string | null;
  /** จำนวนรอบที่ล้มติดต่อกัน ณ ตอนนี้ */
  consecutiveFailures: number;
  /** รอบถัดไปที่กำหนดไว้ (epoch ms) — timestamp คงที่ ไม่ใช่ countdown ที่คำนวณสด */
  nextRunAt: number;
};

/**
 * Snapshot ก้อนเดียวที่บอทส่งให้หน้าเว็บทั้งทาง `GET /state` และ SSE `event: snapshot` (spec §4)
 * เต็มก้อนเสมอ ไม่มี delta ฝั่งเว็บวาดใหม่จากก้อนนี้ล้วน ๆ ทุกครั้ง (spec §3.4)
 */
export type OfficeSnapshot = {
  /** เวอร์ชันโครง payload — ดู {@link SNAPSHOT_VERSION} */
  v: typeof SNAPSHOT_VERSION;
  /**
   * เวลาของ Host ตอน serialize (epoch ms) — ประทับ**ตอน serialize เท่านั้น** และ**ตัดออกก่อนเทียบ diff**
   * เสมอ (spec §3.4) ฝั่งเว็บใช้คำนวณ clock skew ครั้งเดียวต่อ snapshot แล้วเดินนาฬิกาเอง ไม่ใช่ฟิลด์ที่
   * derive จากเวลาปัจจุบันของ "สถานะ" ใด ๆ ในห้อง (ข้อยกเว้นเดียวของกติกาข้อ 4 เพราะถูกกันออกจาก diff แล้ว)
   */
  now: number;
  /** Agent Session ของ Task — 1 ตัวต่อ threadId */
  sessions: Character[];
  /** Run ที่กำลังวิ่งของ Schedule — 1 ตัวต่อ schedule id */
  scheduleRuns: Character[];
  /** ตัวละคร "ผี" ที่ยังค้างให้เห็นแม้ session/run ตายไปแล้ว (จาก `OutcomeFeed` หลัง dedupe กับตัวสดแล้ว) */
  outcomeFeed: Character[];
  /** สถานะคิว Browser แหล่งเดียว — ดู {@link BrowserQueueView} */
  browserQueue: BrowserQueueView;
  /** ป้าย Schedule ที่ auto-pause — ดู {@link AutoPausedScheduleView} */
  autoPausedSchedules: AutoPausedScheduleView[];
};

/** handle ของ Office UI server ที่เปิดอยู่ — คืนจาก `startOfficeUi()` (`src/office/server.ts`, spec §3.1) */
export type OfficeServerHandle = {
  /** พอร์ตที่ผูกอยู่จริง */
  port: number;
  /** ปิด server: หยุด poll timer + keepalive, ปิด SSE ทุกเส้น, `server.close()` (spec §3.5) */
  close(): Promise<void>;
};
