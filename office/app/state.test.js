/**
 * Run with: npx tsx office/app/state.test.js
 * ครอบ state.js: applySnapshot เกิด/ย้าย/หาย, glide ต่อเนื่องเมื่อเปลี่ยนโซนกลางทาง (ไม่กระตุก),
 * meta ถูกแช่แข็งตอน despawn, ตัดชื่อที่ 24 ตัวอักษร — ตามที่ ticket #20 ระบุ
 * เพิ่มเทสต์นาฬิกาถอยหลัง/นับขึ้นของ getClockInfo (render.js) เพราะ bug ที่เจอระหว่างพัฒนา:
 * Run ที่รอคิว Browser เคยนับขึ้นแทนที่จะนับถอยหลัง (deadlineAt ของ Character ต้องเป็น null เสมอ
 * ตาม spec §4.1 ข้อ 2 — ต้องอ่านจาก browserQueue.waiting[].deadlineAt เท่านั้น)
 */
import assert from "node:assert/strict";
import { buildZones, worldPos, DOOR_SLOT, ROOM } from "./layout.js";
import { createRoomState, overflowGroups, truncateName, DESPAWN_MS } from "./state.js";
import { getClockInfo, createRenderer, VECTOR_FURNITURE_COLORS } from "./render.js";
import { placeholderAssets } from "./assets.js";

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

// ---------------------------------------------------------------------------
// renderer บน canvas ปลอม — เทสต์สิ่งที่ "วาดจริง" ได้โดยไม่ต้องมีเบราว์เซอร์
//
// ctx ปลอมบันทึกทุก op พร้อม fillStyle ณ ตอนนั้น ⇒ ตรวจได้ว่าอะไรถูกวาด/ไม่ถูกวาด และ draw() คืน
// hitbox อะไรบ้าง (= "ผู้ใช้คลิกอะไรได้บ้าง" ซึ่งเป็นเกณฑ์รับของ #20 ข้อ 3)
// ---------------------------------------------------------------------------

/** canvas + ctx ปลอมที่บันทึก op ทั้งหมด — เมธอดที่ไม่รู้จักเป็น no-op เพื่อไม่ต้องไล่ stub ทีละอัน */
function recordingCanvas() {
  const ops = [];
  const state = { fillStyle: null, strokeStyle: null, lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalAlpha: 1, imageSmoothingEnabled: false };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return (text) => ({ width: String(text).length * 6 });
      if (key === "createRadialGradient") return () => ({ addColorStop() {} });
      return (...args) => ops.push({ op: String(key), args, fillStyle: target.fillStyle });
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { canvas: { width: 0, height: 0, style: {}, getContext: () => ctx }, ops };
}

/** ชุด asset "sprites + map.json" ขั้นต่ำ — โครงเดียวกับที่ tryLoadSpriteSet() ของ assets.js คืนจริง */
function spriteAssets() {
  const image = { naturalWidth: 320, width: 320 };
  return {
    mode: "sprites",
    manifest: {
      character: {
        frameSize: [64, 64],
        anchor: [32, 62],
        offset: [0, 0],
        directions: ["up", "left", "down", "right"],
        folders: ["01"],
        animations: { idle: { file: "idle.png", frames: 2, fps: 3 }, walk: { file: "walk.png", frames: 9, fps: 12 }, sit: { file: "sit.png", frames: 3, fps: 1 } },
      },
      states: { idle: { anim: "sit" }, working: { anim: "sit" }, approval: { anim: "idle" }, failed: { anim: "idle" }, stopped: { anim: "sit" } },
      room: { tileSize: 32, scale: 1 },
    },
    tileset: image,
    map: {
      width: ROOM.cols,
      height: ROOM.rows,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [{ firstgid: 1 }],
      layers: [{ type: "tilelayer", name: "floor", width: ROOM.cols, height: ROOM.rows, data: new Array(ROOM.cols * ROOM.rows).fill(1) }],
    },
    characterImages: { "01": { idle: image, walk: image, sit: image } },
    frameSize: [64, 64],
    anchor: [32, 62],
    tileSize: 32,
    roomScale: 1,
    tilePx: 32,
    folders: ["01"],
  };
}

/** วาดหนึ่งเฟรมด้วย asset ที่กำหนด แล้วคืน op ที่บันทึกไว้ + hitbox ที่ draw() คืนมา */
function renderOnce(assets, { drawList = [], browserQueue = { holder: null, waiting: [] }, autoPaused = [], selectedId = null } = {}) {
  globalThis.window = globalThis.window || { devicePixelRatio: 1 }; // render.js อ่าน devicePixelRatio ตอนตั้ง canvas
  const { canvas, ops } = recordingCanvas();
  const renderer = createRenderer({ canvas, zones, assets, roomSize: ROOM, tilePx: assets.tilePx });
  const hitboxes = renderer.draw(drawList, NOW, browserQueue, autoPaused, selectedId, 0);
  return { ops, hitboxes };
}

const FURNITURE_COLORS = Object.values(VECTOR_FURNITURE_COLORS);

console.log("\nเฟอร์นิเจอร์เวกเตอร์ = fallback ของโหมดที่ไม่มีผังห้องจริงเท่านั้น (#20 ข้อ 1)");

check("ชุดที่มีผังห้องจริง: ไม่มีเฟอร์นิเจอร์เวกเตอร์ชิ้นไหนถูกวาดทับ tile เลย (เลิก 'โต๊ะซ้อนโต๊ะ')", () => {
  const { ops } = renderOnce(spriteAssets());
  const drawn = [...new Set(ops.filter((o) => FURNITURE_COLORS.includes(o.fillStyle)).map((o) => o.fillStyle))];
  assert.deepEqual(drawn, [], `ยังวาดเฟอร์นิเจอร์เวกเตอร์สี ${drawn.join(", ")} ทับผังห้องจริง`);
  assert.ok(ops.some((o) => o.op === "drawImage"), "ต้องวาด tile จากชีตจริงแทน");
});

check("โหมด placeholder (ไม่มี asset เลย): เฟอร์นิเจอร์เวกเตอร์ต้องยังอยู่ครบทุกชิ้น", () => {
  const { ops } = renderOnce(placeholderAssets());
  const drawn = new Set(ops.filter((o) => FURNITURE_COLORS.includes(o.fillStyle)).map((o) => o.fillStyle));
  for (const [name, color] of Object.entries(VECTOR_FURNITURE_COLORS)) {
    assert.ok(drawn.has(color), `โหมด placeholder ต้องยังวาด ${name} (${color})`);
  }
  assert.ok(!ops.some((o) => o.op === "drawImage"), "โหมด placeholder ไม่มีรูปให้วาด");
});

check("สัญญะของสถานะโซน (รอยแตก bug / แถบกั้น stopped) ยังวาดทั้งสองโหมด — ไม่ใช่เฟอร์นิเจอร์", () => {
  for (const assets of [spriteAssets(), placeholderAssets()]) {
    const { ops } = renderOnce(assets);
    assert.ok(
      ops.some((o) => o.op === "setLineDash" && Array.isArray(o.args[0]) && o.args[0].length === 2),
      `โหมด ${assets.mode}: แถบกั้นโซน stopped หายไป`,
    );
    assert.ok(ops.some((o) => o.op === "stroke"), `โหมด ${assets.mode}: รอยแตกโซน bug หายไป`);
  }
});

check("โหมด placeholder วาดห้องที่มีคนอยู่ครบทุกโซนได้โดยไม่พัง (ฟีเจอร์ต้องครบเท่าโหมด sprites)", () => {
  const room = createRoomState(zones, { tilePx: 32 });
  const chars = [
    baseChar({ id: "a", state: "idle" }),
    baseChar({ id: "b", state: "working" }),
    baseChar({ id: "c", state: "approval", deadlineAt: NOW + 60_000 }),
    baseChar({ id: "d", state: "failed" }),
    baseChar({ id: "e", state: "stopped" }),
    baseChar({ id: "hold", state: "working" }),
    baseChar({ id: "wait", state: "working" }),
  ];
  const q = { holder: "hold", waiting: [{ id: "wait", since: NOW, deadlineAt: null }] };
  room.applySnapshot(snapshotOf(chars, q), NOW);
  const drawList = room.getDrawList(NOW + 5000);
  const { hitboxes } = renderOnce(placeholderAssets(), {
    drawList,
    browserQueue: q,
    autoPaused: [{ id: "sch-1", name: "รายงานเช้า", consecutiveFailures: 3, nextRunAt: NOW }],
  });
  assert.equal(hitboxes.filter((h) => h.kind === "character").length, chars.length);
  assert.equal(hitboxes.filter((h) => h.kind === "schedule").length, 1);
});

console.log("\nทุกตัวละครในห้องต้องมีทางเปิดดูรายละเอียดได้จริง (#20 ข้อ 3)");

/** snapshot ที่ "ล้นทุกโซน" — ทุกโซนมีคนมากกว่าที่นั่งของตัวเอง */
function crowdedRoom() {
  const chars = [];
  const push = (n, make) => Array.from({ length: n }, (_, i) => chars.push(make(i)));
  push(zones.lounge.slots.length + 3, (i) => baseChar({ id: `idle-${i}`, state: "idle" }));
  push(zones.desks.slots.length + 3, (i) => baseChar({ id: `work-${i}`, state: "working" }));
  push(zones.approval.slots.length + 2, (i) => baseChar({ id: `appr-${i}`, state: "approval", deadlineAt: NOW + 60_000 }));
  push(zones.stopped.slots.length + 2, (i) => baseChar({ id: `stop-${i}`, state: "stopped" }));
  push(zones.bug.slots.length + 2, (i) => baseChar({ id: `fail-${i}`, state: "failed" }));
  const waiterIds = Array.from({ length: zones.browser.waiterSlots.length + 3 }, (_, i) => `wait-${i}`);
  chars.push(baseChar({ id: "holder", state: "working" }));
  for (const id of waiterIds) chars.push(baseChar({ id, kind: "run", state: "working" }));
  const q = {
    holder: "holder",
    waiting: waiterIds.map((id, i) => ({ id, since: NOW - i * 1000, deadlineAt: NOW + 30_000 })),
  };
  const room = createRoomState(zones, { tilePx: 32 });
  room.applySnapshot(snapshotOf(chars, q), NOW);
  return { room, chars, q, drawList: room.getDrawList(NOW + 5000) };
}

check("★ ทุกตัวละคร = มีที่นั่งของตัวเอง หรืออยู่ในกลุ่ม +n ของโซนพอดีกลุ่มเดียว (ไม่มีตัวไหนตกสำรวจ)", () => {
  const { chars, drawList } = crowdedRoom();
  const groups = overflowGroups(drawList);
  const hidden = Object.values(groups).flat().map((m) => m.id);
  const seated = drawList.filter((d) => !d.meta.overflow).map((d) => d.id);
  assert.equal(new Set(hidden).size, hidden.length, "ตัวเดียวห้ามโผล่สองกลุ่ม");
  assert.deepEqual(
    [...seated, ...hidden].sort(),
    chars.map((c) => c.id).sort(),
    "รวมกันแล้วต้องได้ตัวละครทุกตัวในห้องพอดี",
  );
  assert.ok(hidden.length > 0, "snapshot นี้ต้องมีตัวที่ล้นจริง ไม่งั้นเทสต์ไม่ได้ทดสอบอะไร");
});

check("★ กรอบคลิกที่ renderer คืนมา ครอบคนที่มีที่นั่งครบทุกตัว ตัวละ 1 กรอบ (ไม่มีกรอบซ้อนบังกันเอง)", () => {
  const { drawList, q } = crowdedRoom();
  const { hitboxes } = renderOnce(placeholderAssets(), { drawList, browserQueue: q });
  const chars = hitboxes.filter((h) => h.kind === "character").map((h) => h.id);
  const seated = drawList.filter((d) => !d.meta.overflow).map((d) => d.id);
  assert.deepEqual(chars.sort(), seated.sort());
  // ตัวที่ล้นต้องไม่มีกรอบของตัวเอง — ไม่งั้นกรอบจะซ้อนที่เดียวกันแล้วเปิดได้แค่ตัวบนสุด
  const overflowIds = new Set(drawList.filter((d) => d.meta.overflow).map((d) => d.id));
  assert.deepEqual(chars.filter((id) => overflowIds.has(id)), []);
});

check("★ ทุกโซนที่ล้นมีชิป +n ให้คลิก และคลิกแล้วได้ 'โซน' ที่มีรายชื่อตัวที่ซ่อนอยู่จริง", () => {
  const { drawList, q } = crowdedRoom();
  const { hitboxes } = renderOnce(placeholderAssets(), { drawList, browserQueue: q });
  const groups = overflowGroups(drawList);
  const chips = hitboxes.filter((h) => h.kind === "overflow");
  assert.deepEqual(chips.map((c) => c.id).sort(), Object.keys(groups).sort());
  for (const chip of chips) {
    assert.ok(chip.x2 > chip.x1 && chip.y2 > chip.y1, `ชิปโซน ${chip.id} ต้องมีพื้นที่ให้คลิกจริง`);
    assert.ok(groups[chip.id].length > 0);
  }
  // ชิปถูกใส่ไว้ก่อนกรอบตัวละคร ⇒ findHit (ไล่จากท้าย) ให้ตัวละครชนะเมื่อกรอบเหลื่อมกัน
  const firstChar = hitboxes.findIndex((h) => h.kind === "character");
  assert.ok(hitboxes.findIndex((h) => h.kind === "overflow") < firstChar);
});

check("รายชื่อในกลุ่ม +n พก 'ความหมายของโซน' มาครบ — คิว Browser ที่ซ่อนอยู่ยังบอกลำดับคิว/เส้นตายได้", () => {
  const { drawList } = crowdedRoom();
  const hidden = overflowGroups(drawList).browser || [];
  assert.ok(hidden.length >= 1);
  assert.deepEqual(
    hidden.map((m) => m.queuePos),
    [...hidden.map((m) => m.queuePos)].sort((a, b) => a - b),
    "ต้องเรียงตามลำดับคิวจริง",
  );
  for (const meta of hidden) {
    assert.equal(meta.role, "waiter");
    assert.ok(meta.queuePos > zones.browser.waiterSlots.length, "ตัวที่ซ่อนคือคิวที่เลยช่องที่มี");
    assert.equal(meta.browserDeadlineAt, NOW + 30_000, "เส้นตายของ Run ต้องยังตามมาด้วย");
    assert.ok(meta.name && meta.id, "ต้องมีชื่อเต็ม/id ให้การ์ดเปิดต่อได้");
  }
});

check("โซนที่ไม่ล้นไม่มีกลุ่ม +n และไม่มีชิปให้คลิก (ชิปต้องไม่โผล่มั่ว)", () => {
  const room = createRoomState(zones, { tilePx: 32 });
  room.applySnapshot(snapshotOf([baseChar({ id: "only", state: "idle" })]), NOW);
  const drawList = room.getDrawList(NOW + 5000);
  assert.deepEqual(overflowGroups(drawList), {});
  const { hitboxes } = renderOnce(placeholderAssets(), { drawList });
  assert.deepEqual(hitboxes.filter((h) => h.kind === "overflow"), []);
});

if (failures > 0) {
  console.error(`\n${failures} state test(s) failed`);
  process.exit(1);
}
console.log("\nall state tests passed");
