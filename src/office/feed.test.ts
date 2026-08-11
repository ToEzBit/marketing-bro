/**
 * Run with: npx tsx src/office/feed.test.ts
 * Asserts the outcome feed's agreed behaviour (Office UI spec §5.5, ticket #17):
 * a bounded ring buffer (cap 50) with per-status TTL, "ok" clears a ghost,
 * re-recording the same id replaces it instead of piling up, and everything
 * is driven by numbers passed in — no `Date.now()`, no timers, no disk.
 */
import assert from "node:assert/strict";
import { OutcomeFeed, type OutcomeEntry } from "./feed.js";

let failures = 0;

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** สร้าง OutcomeEntry เต็มโครง เติมเฉพาะฟิลด์ที่แต่ละเทสต์สนใจ */
function entry(overrides: Partial<OutcomeEntry> & Pick<OutcomeEntry, "id">): OutcomeEntry {
  return {
    kind: "task",
    name: "งานทดสอบ",
    workspace: "/workspace/demo",
    model: "sonnet",
    status: "failed",
    endedAt: 0,
    ...overrides,
  };
}

console.log("cap 50 entries");

await check("เกิน 50 entry แล้วตัวเก่าสุดหลุดออกจากคิว", async () => {
  const feed = new OutcomeFeed();
  for (let i = 0; i < 51; i += 1) {
    feed.record(entry({ id: `t${i}`, endedAt: i * 1_000 }));
  }
  const ids = feed.entries(60_000).map((e) => e.id);
  assert.equal(ids.length, 50, "เก็บได้สูงสุด 50 entry");
  assert.ok(!ids.includes("t0"), "ตัวแรกสุด (เก่าสุด) ต้องหลุดไปแล้ว");
  assert.ok(ids.includes("t50"), "ตัวล่าสุดต้องยังอยู่");
});

console.log("\nTTL ตามสถานะ");

await check("failed หมดอายุที่ 15 นาที ไม่ใช่ก่อนหน้านั้น", async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t1", status: "failed", endedAt: 0 }));

  assert.equal(feed.entries(15 * 60_000 - 1).length, 1, "ยังไม่ถึง 15 นาที ต้องยังอยู่");
  assert.equal(feed.entries(15 * 60_000).length, 0, "ครบ 15 นาทีแล้วต้องหมดอายุ");
});

await check("interrupted หมดอายุที่ 2 นาที ไม่ใช่ก่อนหน้านั้น", async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t1", status: "interrupted", endedAt: 0 }));

  assert.equal(feed.entries(2 * 60_000 - 1).length, 1, "ยังไม่ถึง 2 นาที ต้องยังอยู่");
  assert.equal(feed.entries(2 * 60_000).length, 0, "ครบ 2 นาทีแล้วต้องหมดอายุ");
});

await check("entries() prune ตัวที่หมดอายุทิ้งจริง ไม่ใช่แค่กรองตอนคืนค่า", async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t1", status: "interrupted", endedAt: 0 }));
  assert.equal(feed.entries(2 * 60_000).length, 0, "หมดอายุแล้ว");

  // ย้อนเวลากลับมาก่อนหมดอายุไม่ทำให้ผีฟื้น เพราะถูก prune ทิ้งไปแล้วตอนเรียกรอบก่อน
  assert.equal(feed.entries(0).length, 0, "ถูก prune ทิ้งไปแล้ว ไม่ฟื้นคืน");
});

console.log("\nrecord กับ id เดิม");

await check('record ด้วย status "ok" ล้างผีของ id เดิมทิ้ง', async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t1", status: "failed", endedAt: 0 }));
  assert.equal(feed.entries(0).length, 1);

  feed.record(entry({ id: "t1", status: "ok", endedAt: 100 }));
  assert.equal(feed.entries(100).length, 0, "ตัวเดิมกลับมาทำงานได้แล้ว ผีต้องหาย");
});

await check('record ด้วย "ok" กับ id ที่ไม่เคยมีผีอยู่ก่อนเป็น no-op', async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t1", status: "ok", endedAt: 0 }));
  assert.equal(feed.entries(0).length, 0);
});

await check("record ซ้ำ id เดิมแทนที่ของเก่า ไม่เพิ่มตัวใหม่", async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t1", status: "failed", name: "รอบแรก", endedAt: 1_000 }));
  feed.record(entry({ id: "t1", status: "interrupted", name: "รอบสอง", endedAt: 2_000 }));

  const entries = feed.entries(2_000);
  assert.equal(entries.length, 1, "ยังมีแค่ 1 entry ต่อ id");
  assert.equal(entries[0]?.name, "รอบสอง", "ค่าล่าสุดต้องชนะ");
  assert.equal(entries[0]?.status, "interrupted");
});

console.log("\nลำดับที่คืนจาก entries()");

await check("entries() เรียงใหม่สุดก่อนเสมอ ไม่ใช่ตามลำดับที่ record เข้ามา", async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t-old", endedAt: 1_000 }));
  feed.record(entry({ id: "t-newest", endedAt: 3_000 }));
  feed.record(entry({ id: "t-middle", endedAt: 2_000 }));

  const ids = feed.entries(3_000).map((e) => e.id);
  assert.deepEqual(ids, ["t-newest", "t-middle", "t-old"]);
});

console.log("\nclear(id)");

await check("clear(id) ลบ entry ของ id นั้นออกจาก feed", async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t1", endedAt: 0 }));
  feed.record(entry({ id: "t2", endedAt: 0 }));

  feed.clear("t1");
  const ids = feed.entries(0).map((e) => e.id);
  assert.deepEqual(ids, ["t2"]);
});

await check("clear(id) กับ id ที่ไม่มีอยู่จริงเป็น no-op ไม่ throw", async () => {
  const feed = new OutcomeFeed();
  feed.record(entry({ id: "t1", endedAt: 0 }));
  feed.clear("ไม่เคยมีอยู่");
  assert.equal(feed.entries(0).length, 1);
});

if (failures > 0) {
  console.error(`\n${failures} office/feed test(s) failed`);
  process.exit(1);
}
console.log("\nall office/feed tests passed");
