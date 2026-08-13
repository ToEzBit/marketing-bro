/**
 * Run with: npx tsx office/app/state.test.js
 * ครอบ state.js: applySnapshot เกิด/ย้าย/หาย, glide ต่อเนื่องเมื่อเปลี่ยนโซนกลางทาง (ไม่กระตุก),
 * meta ถูกแช่แข็งตอน despawn, ตัดชื่อที่ 24 ตัวอักษร — ตามที่ ticket #20 ระบุ
 * เพิ่มเทสต์นาฬิกาถอยหลัง/นับขึ้นของ getClockInfo (render.js) เพราะ bug ที่เจอระหว่างพัฒนา:
 * Run ที่รอคิว Browser เคยนับขึ้นแทนที่จะนับถอยหลัง (deadlineAt ของ Character ต้องเป็น null เสมอ
 * ตาม spec §4.1 ข้อ 2 — ต้องอ่านจาก browserQueue.waiting[].deadlineAt เท่านั้น)
 */
import assert from "node:assert/strict";
import { buildZones, worldPos, DOOR_SLOT } from "./layout.js";
import { createRoomState, truncateName, DESPAWN_MS } from "./state.js";
import { getClockInfo } from "./render.js";

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

const zones = buildZones();
const NOW = 1_700_000_000_000;

function baseChar(overrides = {}) {
  return {
    id: "t1",
    kind: "task",
    state: "idle",
    detail: null,
    name: "งานทดสอบ",
    headline: null,
    threadId: "t1",
    threadUrl: "https://discord.com/channels/1/t1",
    since: NOW - 1000,
    deadlineAt: null,
    workspace: "/tmp/ws",
    model: "sonnet",
    approvals: [],
    outcome: null,
    ...overrides,
  };
}

function snapshotOf(chars, browserQueue = { holder: null, waiting: [] }, now = NOW) {
  return { v: 1, now, sessions: chars, scheduleRuns: [], outcomeFeed: [], browserQueue, autoPausedSchedules: [] };
}

console.log("truncateName (ป้ายชื่อ ~24 ตัวอักษร, spec §5.1/§5.4)");

check("ชื่อสั้นกว่า/เท่ากับ 24 ตัวอักษร ไม่ถูกตัด", () => {
  assert.equal(truncateName("สั้น ๆ"), "สั้น ๆ");
  assert.equal(truncateName("a".repeat(24)), "a".repeat(24));
});

check("ชื่อยาวกว่า 24 ตัวอักษรถูกตัดเหลือ 24 ตัวอักษร (รวม …) ", () => {
  const long = "a".repeat(40);
  const truncated = truncateName(long);
  assert.equal(truncated.length, 24);
  assert.ok(truncated.endsWith("…"));
  assert.equal(truncated, "a".repeat(23) + "…");
});

check("ชื่อว่าง/undefined ไม่พัง", () => {
  assert.equal(truncateName(""), "");
  assert.equal(truncateName(undefined), "");
});

console.log("\napplySnapshot — เกิด (spawn)");

check("ตัวละครใหม่เกิดจากประตู (DOOR_SLOT) ไม่ใช่ fade-in อยู่กับที่", () => {
  const room = createRoomState(zones);
  room.applySnapshot(snapshotOf([baseChar({ id: "new-1", state: "idle" })]), NOW);
  const cache = room._posCache.get("new-1");
  assert.ok(cache, "ต้องมี entry ใน position cache");
  const doorPos = worldPos(DOOR_SLOT);
  assert.equal(cache.from.x, doorPos.x);
  assert.equal(cache.from.y, doorPos.y);
  assert.equal(cache.spawning, true);
});

console.log("\napplySnapshot — ย้าย (glide เมื่อเปลี่ยนโซน)");

check("ตัวละครที่ยังอยู่แต่เปลี่ยนโซน (idle → working) เริ่ม glide ไปที่ desks", () => {
  const room = createRoomState(zones);
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "idle" })]), NOW);
  const before = room._posCache.get("t1").to;

  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "working" })]), NOW + 2000);
  const after = room._posCache.get("t1");
  assert.notEqual(after.to.x, before.x, "ตำแหน่งปลายทางต้องเปลี่ยนไปโซน desks");
  assert.ok(after.dur > 0, "ต้องมี glide duration ใหม่");
});

check("ตัวละครที่อยู่โซนเดิม (idle→idle) ไม่ถูกสั่ง glide ซ้ำโดยไม่มีเหตุผล", () => {
  const room = createRoomState(zones);
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "idle" })]), NOW);
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "idle" })]), NOW + 5000);
  const cache = room._posCache.get("t1");
  // ยังอยู่ที่นั่งเดิมของโซนเดิม (assignSlots คงตำแหน่งเดิมถ้ายังอยู่โซนเดิม) — to ไม่ควรขยับ
  const drawn = room.getDrawList(NOW + 5000);
  assert.equal(drawn.length, 1);
});

console.log("\nglide กลางทาง: เปลี่ยนโซนอีกครั้งก่อนเดินถึงที่เดิม ต้องไม่กระตุก (spec §7.4)");

check("เริ่ม glide ใหม่จากตำแหน่งบนจอ ณ ขณะนั้น ไม่ใช่จากปลายทางเดิมที่ยังไปไม่ถึง", () => {
  const room = createRoomState(zones);
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "idle" })]), NOW);
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "working" })]), NOW + 100); // เริ่มเดินไป desks
  const midCache = room._posCache.get("t1");
  const halfway = midCache.t0 + midCache.dur / 2;
  const posBeforeRedirect = room.getDrawList(halfway).find((d) => d.id === "t1");
  assert.ok(posBeforeRedirect, "ต้องยังวาดได้อยู่กลางทาง");

  // สั่งย้ายอีกรอบกลางทาง (working → failed → bug) ก่อนถึง desks
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "failed" })]), halfway);
  const redirected = room._posCache.get("t1");
  // จุดเริ่ม leg ใหม่ (from) ต้องใกล้เคียงตำแหน่งบนจอ ณ ตอนสั่งย้าย ไม่ใช่ตำแหน่ง desks ปลายทางเดิมที่ยังไปไม่ถึง
  const distFromOldTarget = Math.hypot(
    redirected.from.x - midCache.to.x,
    redirected.from.y - midCache.to.y,
  );
  const distFromMidpoint = Math.hypot(
    redirected.from.x - posBeforeRedirect.x,
    redirected.from.y - posBeforeRedirect.y,
  );
  assert.ok(
    distFromMidpoint < distFromOldTarget,
    `from ใหม่ต้องใกล้ตำแหน่งกลางทางจริง (${distFromMidpoint}) มากกว่าใกล้ปลายทางเดิมที่ยังไปไม่ถึง (${distFromOldTarget})`,
  );
});

console.log("\nsetTilePx — ห้องขยาย/หดตามหน้าต่าง (#20)");

check("ตัวละครไปโผล่ที่นั่งเดิมของห้องขนาดใหม่ทันที ไม่ glide ไม่เดินเข้าประตูใหม่", () => {
  const room = createRoomState(zones, { tilePx: 32 });
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "working" })]), NOW);
  const settled = NOW + 60_000; // เดินถึงที่นั่งเรียบร้อยแล้ว
  room.getDrawList(settled);
  const before = { ...room._posCache.get("t1").cur };

  room.setTilePx(64);
  const cache = room._posCache.get("t1");
  assert.deepEqual(cache.cur, { x: before.x * 2, y: before.y * 2 }, "พิกัดบนจอต้องคูณสองพร้อมห้อง");
  // ที่นั่งเดิมในห้องใหญ่ = ปลายทางใหม่พอดี ⇒ applySnapshot รอบถัดไปต้องไม่สั่ง glide (ไม่มีอะไรขยับจริง)
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "working" })]), settled + 1);
  assert.equal(room._posCache.get("t1").dur, 0, "ต้องไม่มี glide เกิดขึ้นจากการเปลี่ยนขนาดห้อง");
  assert.equal(room.getDrawList(settled + 1).length, 1, "ห้ามหายไปแล้วเดินเข้าประตูใหม่");
});

check("leg ที่กำลังเดินอยู่ยังถูกต้อง — ระยะทางวัดเป็น tile จึงไม่เปลี่ยนตามสเกล", () => {
  const room = createRoomState(zones, { tilePx: 32 });
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "idle" })]), NOW);
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "working" })]), NOW + 60_000);
  const before = room._posCache.get("t1");
  const dur = before.dur;
  const from = { ...before.from };
  const to = { ...before.to };

  room.setTilePx(48);
  const after = room._posCache.get("t1");
  assert.equal(after.dur, dur, "ระยะเวลาเดินต้องเท่าเดิม (ระยะทางเป็น tile ไม่ใช่ px)");
  assert.deepEqual(after.from, { x: from.x * 1.5, y: from.y * 1.5 });
  assert.deepEqual(after.to, { x: to.x * 1.5, y: to.y * 1.5 });
});

check("ค่าที่ไม่ถูกต้อง/ค่าเดิม ไม่แตะแคชเลย (กันพิกัดกลายเป็น NaN ทั้งห้อง)", () => {
  const room = createRoomState(zones, { tilePx: 32 });
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "working" })]), NOW);
  const snapshotPos = { ...room._posCache.get("t1").to };
  for (const bad of [0, -32, NaN, undefined, null, "x", 32]) {
    room.setTilePx(bad);
    assert.deepEqual(room._posCache.get("t1").to, snapshotPos, `setTilePx(${String(bad)}) ต้องไม่ทำอะไร`);
  }
});

console.log("\napplySnapshot — หาย (despawn)");

check("id ที่หายไปจาก snapshot ถูกสั่งเดินออกประตูแล้วค่อยลบออกจาก cache จริง (ไม่ใช่หายทันที)", () => {
  const room = createRoomState(zones);
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "idle" })]), NOW);
  room.applySnapshot(snapshotOf([]), NOW + 1000); // t1 หายไปจาก snapshot

  const cache = room._posCache.get("t1");
  assert.ok(cache, "ยังต้องอยู่ใน cache ระหว่างเดินออก");
  assert.equal(cache.despawning, true);
  const doorPos = worldPos(DOOR_SLOT);
  assert.equal(cache.to.x, doorPos.x);
  assert.equal(cache.to.y, doorPos.y);

  // ยังไม่ถึงเวลาจางหายหมด — ยังวาดอยู่ (alpha < 1)
  const midDraw = room.getDrawList(NOW + 1000 + DESPAWN_MS / 2).find((d) => d.id === "t1");
  assert.ok(midDraw, "ต้องยังวาดอยู่ระหว่างจางหาย");
  assert.ok(midDraw.alpha < 1 && midDraw.alpha > 0);

  // เลยเวลาจางหายหมดแล้ว — ต้องหายจาก drawList และถูกลบออกจาก cache จริง
  const afterDraw = room.getDrawList(NOW + 1000 + DESPAWN_MS + 500);
  assert.equal(afterDraw.find((d) => d.id === "t1"), undefined);
  assert.equal(room._posCache.has("t1"), false);
});

check("meta ถูกแช่แข็งตอนเริ่ม despawn — ยังวาดชื่อ/สถานะเดิมถูกต้องระหว่างเดินออก แม้ backend ไม่ส่ง entry นี้มาอีกแล้ว", () => {
  const room = createRoomState(zones);
  room.applySnapshot(
    snapshotOf([baseChar({ id: "t1", state: "working", name: "งานก่อนตาย", headline: "กำลังใช้ Bash" })]),
    NOW,
  );
  room.applySnapshot(snapshotOf([]), NOW + 500); // t1 หายจาก snapshot กลางทาง

  const frozen = room.getDrawList(NOW + 600).find((d) => d.id === "t1");
  assert.ok(frozen, "ต้องยังวาดได้ระหว่าง despawn");
  assert.equal(frozen.meta.name, "งานก่อนตาย");
  assert.equal(frozen.meta.headline, "กำลังใช้ Bash");
  assert.equal(frozen.meta.state, "working");

  // ต่อให้เวลาผ่านไปอีก meta ต้องยังเป็นค่าเดิมที่แช่แข็งไว้ (ไม่มีใครมาสั่ง applySnapshot ทับ id นี้อีก)
  const laterFrozen = room.getDrawList(NOW + 700).find((d) => d.id === "t1");
  assert.equal(laterFrozen.meta.name, "งานก่อนตาย");
});

check("ตัวเดิมกลับมาก่อนจางหายหมด (ยังอยู่ใน snapshot รอบถัดไป) → เลิก despawn ไม่ต้องเกิดใหม่", () => {
  const room = createRoomState(zones);
  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "idle" })]), NOW);
  room.applySnapshot(snapshotOf([]), NOW + 200); // เริ่มหาย
  assert.equal(room._posCache.get("t1").despawning, true);

  room.applySnapshot(snapshotOf([baseChar({ id: "t1", state: "idle" })]), NOW + 400); // กลับมาแล้ว
  assert.equal(room._posCache.get("t1").despawning, false);
});

console.log("\ndedupe (§5.4 — sessions/scheduleRuns/outcomeFeed รวมกันโดยไม่ให้ id ซ้ำพัง)");

check("id ซ้ำกันข้าม sessions/outcomeFeed ใช้ตัวแรกที่เจอ ไม่ throw ไม่วาดซ้อนสองตัว", () => {
  const room = createRoomState(zones);
  const snap = {
    v: 1,
    now: NOW,
    sessions: [baseChar({ id: "dup", state: "working" })],
    scheduleRuns: [],
    outcomeFeed: [baseChar({ id: "dup", state: "failed", name: "ผีซ้ำ" })],
    browserQueue: { holder: null, waiting: [] },
    autoPausedSchedules: [],
  };
  room.applySnapshot(snap, NOW);
  const drawn = room.getDrawList(NOW);
  assert.equal(drawn.filter((d) => d.id === "dup").length, 1);
});

console.log("\nโซนล้น (§7.2) — ตัวที่ไม่เหลือที่นั่งถูกทำเครื่องหมาย overflow เพื่อไม่ให้ยัดป้ายจนล้นห้อง");

check("ตัวละครเท่ากับจำนวนที่นั่งพอดี ไม่มีใครเป็น overflow", () => {
  const room = createRoomState(zones);
  const chars = Array.from({ length: zones.lounge.slots.length }, (_, i) =>
    baseChar({ id: `idle-${i}`, state: "idle" }),
  );
  room.applySnapshot(snapshotOf(chars), NOW);
  const drawn = room.getDrawList(NOW);
  assert.equal(drawn.length, chars.length);
  assert.equal(drawn.filter((d) => d.meta.overflow).length, 0);
});

check("ตัวละครมากกว่าที่นั่ง: ส่วนเกินเป็น overflow ทุกตัว ที่เหลือได้ที่นั่งของตัวเองครบ", () => {
  const room = createRoomState(zones);
  const seats = zones.lounge.slots.length;
  const extra = 7;
  const chars = Array.from({ length: seats + extra }, (_, i) => baseChar({ id: `idle-${i}`, state: "idle" }));
  room.applySnapshot(snapshotOf(chars), NOW);
  // ดูหลังเดินเข้าห้องเสร็จแล้ว (ตอน NOW ทุกตัวยังยืนซ้อนกันอยู่ที่ประตู)
  const drawn = room.getDrawList(NOW + 3000);
  assert.equal(drawn.filter((d) => d.meta.overflow).length, extra, "จำนวน overflow ต้องเท่ากับส่วนที่ล้นจริง");
  const seated = drawn.filter((d) => !d.meta.overflow);
  assert.equal(seated.length, seats);
  // ตัวที่ได้ที่นั่งต้องอยู่กันคนละที่จริง ๆ (ไม่ใช่ยัดที่นั่งสุดท้ายรวมกันเหมือนพฤติกรรมเดิม)
  assert.equal(new Set(seated.map((d) => `${d.x},${d.y}`)).size, seats);
});

check("คิว Browser ที่ยาวเกินช่องคิว: ตัวที่เกินเป็น overflow ส่วนผู้ถือไม่มีวันเป็น overflow", () => {
  const room = createRoomState(zones);
  const waiterCount = zones.browser.waiterSlots.length;
  const ids = Array.from({ length: waiterCount + 2 }, (_, i) => `w-${i}`);
  const q = {
    holder: "holder-1",
    waiting: ids.map((id, i) => ({ id, since: NOW - i * 1000, deadlineAt: null })),
  };
  const chars = [baseChar({ id: "holder-1", state: "working" }), ...ids.map((id) => baseChar({ id, state: "working" }))];
  room.applySnapshot(snapshotOf(chars, q), NOW);
  const drawn = room.getDrawList(NOW);
  assert.equal(drawn.find((d) => d.id === "holder-1").meta.overflow, false);
  assert.equal(drawn.filter((d) => d.meta.overflow).length, 2);
  for (let i = 0; i < waiterCount; i++) {
    assert.equal(drawn.find((d) => d.id === `w-${i}`).meta.overflow, false, `คิวที่ ${i + 1} ต้องได้ช่องของตัวเอง`);
  }
});

console.log("\nนาฬิกา (spec §5.6) — countdown เฉพาะ approval และ Run ที่รอคิว Browser เท่านั้น");

check("approval มี deadlineAt จริง → countdown", () => {
  const meta = { state: "approval", kind: "task", since: NOW - 1000, deadlineAt: NOW + 60_000 };
  const clock = getClockInfo(meta, NOW);
  assert.equal(clock.countdown, true);
});

check("Run ที่รอคิว Browser ใช้ browserDeadlineAt (มาจาก browserQueue) ไม่ใช่ deadlineAt ดิบ ซึ่งต้องเป็น null เสมอ", () => {
  const metaFromQueue = {
    state: "working",
    kind: "run",
    zone: "browser",
    role: "waiter",
    since: NOW - 1000,
    deadlineAt: null, // ตามสัญญา spec §4.1 ข้อ 2 — Character.deadlineAt ต้องเป็น null เสมอตรงนี้
    browserDeadlineAt: NOW + 30_000,
  };
  const clock = getClockInfo(metaFromQueue, NOW);
  assert.equal(clock.countdown, true, "ต้องนับถอยหลังจาก browserDeadlineAt ทั้งที่ deadlineAt ดิบเป็น null");
  assert.equal(clock.text, "00:30");
});

check("Task ที่รอคิว Browser ไม่มีเส้นตาย (ADR 0006) → นับขึ้นเสมอ แม้อยู่โซน browser role waiter", () => {
  const meta = {
    state: "working",
    kind: "task",
    zone: "browser",
    role: "waiter",
    since: NOW - 45_000,
    deadlineAt: null,
    browserDeadlineAt: null,
  };
  const clock = getClockInfo(meta, NOW);
  assert.equal(clock.countdown, false);
  assert.equal(clock.text, "00:45");
});

check("ตัวละครที่ createRoomState ประกอบ meta ให้ (ผ่าน applySnapshot จริง) มี browserDeadlineAt ติดมาด้วยสำหรับ Run waiter", () => {
  const room = createRoomState(zones);
  const runWaiter = baseChar({ id: "schedule:s1", kind: "run", state: "working", since: NOW - 5000, deadlineAt: null });
  const q = { holder: "someone-else", waiting: [{ id: "schedule:s1", since: NOW - 5000, deadlineAt: NOW + 20_000 }] };
  room.applySnapshot(snapshotOf([runWaiter], q), NOW);
  const item = room.getDrawList(NOW).find((d) => d.id === "schedule:s1");
  assert.equal(item.meta.deadlineAt, null, "deadlineAt ดิบต้องเป็น null เสมอ (จาก char.deadlineAt)");
  assert.equal(item.meta.browserDeadlineAt, NOW + 20_000, "browserDeadlineAt ต้อง derive มาจาก browserQueue.waiting[]");
  const clock = getClockInfo(item.meta, NOW);
  assert.equal(clock.countdown, true);
});

if (failures > 0) {
  console.error(`\n${failures} state test(s) failed`);
  process.exit(1);
}
console.log("\nall state tests passed");
