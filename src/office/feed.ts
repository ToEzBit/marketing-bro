/**
 * Outcome feed สำหรับ Office UI (spec ของ effort "Office UI" §5.5) — ring buffer
 * แบบ in-memory ล้วน เก็บ "ผลจบล่าสุด" ของ Task/Run ไว้ให้ห้องเห็นแม้ session
 * ตายไปแล้ว เพราะสัญญาณเดิมของบอทเป็นเหตุการณ์ชั่วขณะที่ถูกทิ้งทันที: คำขออนุมัติเป็นแค่
 * string ยิงเข้า Discord, `TurnSummary` ส่งเข้า hook แล้วหาย, session ที่ตายถูกถอดจาก
 * ทะเบียนทันที — ไม่มีที่ไหนเก็บผลจบไว้ให้ Office UI อ่านนอกจาก feed นี้
 *
 * กติกา (ตามเกณฑ์รับของ ticket): ห้าม persist ลงดิสก์, ห้ามตั้ง timer, ห้ามเรียก
 * `Date.now()` ภายใน — ทุกจุดที่ต้องรู้เวลารับ `now`/`endedAt` เป็นพารามิเตอร์จากผู้เรียก
 * เสมอ เพื่อให้ทดสอบได้ด้วยตัวเลขล้วน และห้าม import จาก `bot.ts`/discord.js
 */

/** "ok" ไม่ได้ถูกเก็บเป็น entry จริง — ใน record() มันคือสัญญาณล้างผีของ id นั้นทิ้ง */
export type OutcomeStatus = "ok" | "failed" | "interrupted";

export type OutcomeEntry = {
  /** threadId (Task) หรือ "schedule:<id>" (Run) — คีย์เดียวกับ Character.id ของ snapshot */
  id: string;
  kind: "task" | "run";
  name: string;
  threadId?: string;
  threadUrl?: string;
  workspace: string;
  model: string;
  status: OutcomeStatus;
  reason?: string;
  /** epoch ms ตอนจบ — ใช้ทั้งเรียงลำดับ (ใหม่สุดก่อน) และคำนวณ TTL */
  endedAt: number;
};

/** จำนวน entry สูงสุดที่ feed เก็บพร้อมกัน — เกินนี้ตัวที่เก่าสุด (แทรกไว้ก่อนสุด) หลุด */
const MAX_ENTRIES = 50;

/** TTL ตาม linger ของแต่ละโซน (§5.4 ของสเปก): โซน 5 (failed) 15 นาที, โซน 6 (interrupted) 2 นาที */
function ttlMsFor(status: OutcomeStatus): number {
  switch (status) {
    case "failed":
      return 15 * 60_000;
    case "interrupted":
      return 2 * 60_000;
    case "ok":
      // ไม่มีทางถึงบรรทัดนี้จริง — record() ล้าง entry ทิ้งตอนเจอ "ok" ไม่เคยเก็บมันไว้
      return 0;
  }
}

export class OutcomeFeed {
  private readonly byId = new Map<string, OutcomeEntry>();

  /**
   * บันทึกผลจบของ id นี้ — `status: "ok"` ล้างผีของ id นั้นทิ้ง (ตัวเดิมกลับมาทำงานได้แล้ว)
   * บันทึกซ้ำ id เดิมแทนที่ของเก่าเสมอ ไม่เพิ่มตัวใหม่ (สูงสุด 1 entry ต่อ id)
   */
  record(entry: OutcomeEntry): void {
    if (entry.status === "ok") {
      this.byId.delete(entry.id);
      return;
    }
    // ลบก่อนตั้งใหม่เสมอ ให้ id ที่ถูกบันทึกซ้ำนับเป็น "ใหม่สุด" ในลำดับ ring buffer ด้วย
    // ไม่ใช่แค่แทนที่ค่าตรง ๆ (ซึ่งจะคงตำแหน่งเดิมไว้และหลุดคิวผิดจังหวะ)
    this.byId.delete(entry.id);
    this.byId.set(entry.id, entry);
    while (this.byId.size > MAX_ENTRIES) {
      const oldestId: string | undefined = this.byId.keys().next().value;
      if (oldestId === undefined) break;
      this.byId.delete(oldestId);
    }
  }

  /** entry ที่ยังไม่หมดอายุ ณ เวลา `now` เรียงใหม่สุดก่อน — prune ตัวที่หมดอายุทิ้งในตัว */
  entries(now: number): OutcomeEntry[] {
    for (const [id, entry] of this.byId) {
      if (now - entry.endedAt >= ttlMsFor(entry.status)) {
        this.byId.delete(id);
      }
    }
    return [...this.byId.values()].sort((a, b) => b.endedAt - a.endedAt);
  }

  /** ลบ entry ของ id นี้ทิ้ง (ใช้ตอน `/task` replace หรือ session ใหม่เริ่ม) */
  clear(id: string): void {
    this.byId.delete(id);
  }
}
