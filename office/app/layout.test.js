/**
 * Run with: npx tsx office/app/layout.test.js
 * ครอบ layout.js: โซนไม่ซ้อนกัน, จำนวนที่นั่งต่อโซนตาม spec §7.2, zoneAndRoleFor() ครบทุกสาขา
 * (P1–P9 ของ spec §5.2 / §7.3) และ hash ของ sprite นิ่งข้ามการรัน — ตามที่ ticket #20 ระบุ
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildZones,
  findOverlappingZones,
  zoneAndRoleFor,
  fnv1aHash,
  pickCharacterFolder,
  zoneRectsFromMap,
  roomSizeFromMap,
  tileLayersOf,
  doorSlotFor,
  directionFromVector,
  animationFrameIndex,
  boxesOverlap,
  resolveLabelShift,
  DEFAULT_ZONE_RECTS,
  ZONE_IDS,
  DOOR_SLOT,
  ROOM,
} from "./layout.js";
import { tilePxOf, PLACEHOLDER_TILE_SIZE } from "./assets.js";

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

console.log("โซน rect (§7.2)");

check("6 โซนตามค่าเริ่มต้นไม่ซ้อนกันเลย", () => {
  assert.deepEqual(findOverlappingZones(zones), []);
});

check("ทั้ง 6 โซนของ spec §7.2 มีครบใน ZONE_IDS", () => {
  assert.deepEqual(
    [...ZONE_IDS].sort(),
    ["approval", "bug", "browser", "desks", "lounge", "stopped"].sort(),
  );
});

check("rect เริ่มต้นตรงกับตาราง spec §7.2 ทุกโซน", () => {
  assert.deepEqual(DEFAULT_ZONE_RECTS.lounge, [1, 1, 6, 6]);
  assert.deepEqual(DEFAULT_ZONE_RECTS.stopped, [1, 8, 6, 6]);
  assert.deepEqual(DEFAULT_ZONE_RECTS.approval, [8, 1, 8, 13]);
  assert.deepEqual(DEFAULT_ZONE_RECTS.desks, [17, 1, 6, 13]);
  assert.deepEqual(DEFAULT_ZONE_RECTS.browser, [24, 1, 6, 6]);
  assert.deepEqual(DEFAULT_ZONE_RECTS.bug, [24, 8, 6, 6]);
});

console.log("\nrectOverrides จาก map.json object layer `zones`");

check("rectOverrides แทนที่ค่าเริ่มต้นเฉพาะโซนที่ระบุ ที่เหลือคงเดิม", () => {
  const overridden = buildZones({ lounge: [0, 0, 4, 4] });
  assert.deepEqual(overridden.lounge.rect, [0, 0, 4, 4]);
  assert.deepEqual(overridden.desks.rect, DEFAULT_ZONE_RECTS.desks);
});

check("rectOverrides ที่ทำให้โซนซ้อนกันถูกตรวจจับได้ (self-check)", () => {
  const overlapping = buildZones({ stopped: DEFAULT_ZONE_RECTS.lounge });
  const pairs = findOverlappingZones(overlapping);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].sort(), ["lounge", "stopped"].sort());
});

check("map.json ของชุด default ให้ rect ตรงกับค่า default ในโค้ดทุกโซน (สัญญาที่ commit ไว้จริง)", () => {
  // อ่านไฟล์ที่ ship จริง ไม่ใช่ fixture — กันกรณีแก้ผังห้องแล้วลืมว่ามันเปลี่ยนตำแหน่งโซนไปด้วย
  const map = JSON.parse(readFileSync(new URL("../assets/default/room/map.json", import.meta.url), "utf8"));
  const rects = zoneRectsFromMap(map);
  assert.deepEqual([...Object.keys(rects)].sort(), [...ZONE_IDS].sort());
  for (const id of ZONE_IDS) {
    assert.deepEqual(rects[id], DEFAULT_ZONE_RECTS[id], `โซน ${id} ใน map.json ไม่ตรงกับค่า default`);
  }
  assert.deepEqual(roomSizeFromMap(map), { cols: 32, rows: 16 });
  assert.deepEqual(
    tileLayersOf(map).map((l) => l.name),
    ["floor", "walls", "props"], // object layer `zones` ต้องไม่หลุดมาเป็น tile layer
  );
});

check("zoneRectsFromMap แปลง px เป็นหน่วย tile ด้วย tilewidth/tileheight ของ map (ชีต 16px ก็ต้องถูก)", () => {
  const map = {
    width: 20,
    height: 10,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      {
        type: "objectgroup",
        name: "zones",
        objects: [
          { name: "lounge", x: 16, y: 32, width: 128, height: 96 },
          { name: "desks", x: 160, y: 16, width: 96, height: 128 },
        ],
      },
    ],
  };
  assert.deepEqual(zoneRectsFromMap(map), { lounge: [1, 2, 8, 6], desks: [10, 1, 6, 8] });
  assert.deepEqual(roomSizeFromMap(map), { cols: 20, rows: 10 });
});

check("zoneRectsFromMap ข้ามชื่อโซนที่ไม่รู้จักและ object ที่ไม่มีขนาด (point object ของ Tiled)", () => {
  const map = {
    tilewidth: 32,
    tileheight: 32,
    layers: [
      {
        type: "objectgroup",
        name: "zones",
        objects: [
          { name: "lounge", x: 32, y: 32, width: 192, height: 192 },
          { name: "ห้องน้ำ", x: 0, y: 0, width: 64, height: 64 }, // ไม่ใช่ zone id → ข้าม
          { name: "desks", x: 0, y: 0, width: 0, height: 0 }, // point object → ข้าม
        ],
      },
    ],
  };
  assert.deepEqual(zoneRectsFromMap(map), { lounge: [1, 1, 6, 6] });
});

check("ไม่มี map / map พัง → rect ว่าง + ขนาดห้องค่าเริ่มต้น (degrade อย่างสุภาพ ไม่ throw)", () => {
  for (const bad of [null, undefined, {}, { layers: "nope" }, { tilewidth: 0, layers: [] }]) {
    assert.deepEqual(zoneRectsFromMap(bad), {});
    assert.deepEqual(roomSizeFromMap(bad), { cols: ROOM.cols, rows: ROOM.rows });
    assert.deepEqual(tileLayersOf(bad), []);
  }
});

check("buildZones ใช้ rect จาก map จริงแล้วที่นั่งขยับตาม (ที่นั่งคำนวณจาก rect ไม่ใช่ hard-code)", () => {
  const moved = buildZones({ lounge: [0, 0, 10, 8] });
  assert.deepEqual(moved.lounge.rect, [0, 0, 10, 8]);
  assert.equal(moved.lounge.slots.length, 4); // ยังเป็น grid 2x2 เหมือนเดิม
  const base = buildZones();
  assert.notDeepEqual(moved.lounge.slots[0], base.lounge.slots[0]); // แต่พิกัดต้องขยับจริง
  for (const s of moved.lounge.slots) {
    assert.ok(s.x >= 0 && s.x <= 10 && s.y >= 0 && s.y <= 8, "ที่นั่งต้องอยู่ใน rect ใหม่");
  }
});

check("doorSlotFor คำนวณประตูจากขนาดห้องจริง และห้อง 32x16 ต้องได้ค่าเดิมเป๊ะ", () => {
  assert.deepEqual(doorSlotFor(32, 16), DOOR_SLOT);
  assert.deepEqual(doorSlotFor(40, 20), { x: 20, y: 19.4, dir: "up" });
});

console.log("\ntileSize / scale จาก manifest (§8.2 — โค้ดห้าม assume ขนาด)");

check("tilePxOf = tileSize x scale (ชีต 16px + scale 2 ได้ 32px เท่าชุด default)", () => {
  assert.equal(tilePxOf(32, 1), 32);
  assert.equal(tilePxOf(16, 2), 32);
  assert.equal(tilePxOf(16, 1), 16);
  assert.equal(tilePxOf(48, 1), 48);
});

check("tilePxOf ปัดเป็นจำนวนเต็ม (กันรอยต่อ tile เป็นเส้นบาง ๆ ตอนวาด) และกันค่าพัง", () => {
  assert.equal(tilePxOf(16, 1.5), 24);
  assert.equal(tilePxOf(15, 1.03), 15); // 15.45 → 15
  for (const bad of [0, -8, undefined, null, NaN, "x"]) {
    assert.equal(tilePxOf(bad, 1), PLACEHOLDER_TILE_SIZE, `tileSize=${bad} ต้องตกกลับไปค่าปลอดภัย`);
  }
  assert.equal(tilePxOf(32, 0), 32); // scale 0/หายไป = 1 ไม่ใช่ห้องกว้าง 0
});

console.log("\nเลือกแถวสไปรต์จากเวกเตอร์การเคลื่อนที่ (§7.4)");

check("แกนที่ขยับเยอะกว่าเป็นตัวตัดสิน และ y ที่เพิ่มขึ้นคือเดินลง (จอเป็น y ลง)", () => {
  assert.equal(directionFromVector(100, 10), "right");
  assert.equal(directionFromVector(-100, 10), "left");
  assert.equal(directionFromVector(10, 100), "down");
  assert.equal(directionFromVector(10, -100), "up");
  assert.equal(directionFromVector(-3, -50), "up");
});

check("เดินทแยงพอดี ๆ (|dx| = |dy|) ตกไปที่แกนตั้ง — ขอแค่ผลนิ่ง ไม่สลับไปมา", () => {
  assert.equal(directionFromVector(50, 50), "down");
  assert.equal(directionFromVector(-50, -50), "up");
  assert.equal(directionFromVector(50, 50), directionFromVector(50, 50));
});

check("ไม่ขยับเลย → null เพื่อให้ผู้เรียกคงทิศเดิมของที่นั่งไว้ (ไม่ใช่หันมั่ว)", () => {
  assert.equal(directionFromVector(0, 0), null);
});

check("ชีตที่ประกาศลำดับแถวไม่ครบ 4 ทิศ ต้องไม่คืนทิศที่ชีตไม่มี", () => {
  const onlyTwo = ["down", "up"];
  assert.equal(directionFromVector(100, 0, onlyTwo), "down"); // ไม่มี right → ใช้แถวแรกที่ประกาศไว้
  assert.equal(directionFromVector(0, 100, onlyTwo), "down");
  assert.equal(directionFromVector(0, -100, onlyTwo), "up");
});

check("animationFrameIndex วนลูปตาม frames/fps ของ manifest", () => {
  assert.equal(animationFrameIndex(0, 9, 12), 0);
  assert.equal(animationFrameIndex(84, 9, 12), 1); // 1/12 วินาที = เฟรมที่ 1
  assert.equal(animationFrameIndex(750, 9, 12), 0); // ครบ 9 เฟรมพอดี → วนกลับ 0
  assert.equal(animationFrameIndex(800, 9, 12), 0);
  assert.equal(animationFrameIndex(340, 2, 3), 1); // idle 2 เฟรมที่ 3fps
  assert.equal(animationFrameIndex(667, 2, 3), 0); // ครบ 2 เฟรม → วนกลับ 0
  assert.equal(animationFrameIndex(1000, 2, 3), 1); // 3 เฟรมผ่านไป → 3 % 2
});

check("animationFrameIndex คืน 0 อย่างปลอดภัยเมื่อ manifest ไม่ได้บอก frames/fps มา", () => {
  for (const [frames, fps] of [[1, 12], [0, 12], [undefined, 12], [9, 0], [9, undefined], [9, -3]]) {
    assert.equal(animationFrameIndex(500, frames, fps), 0, `frames=${frames} fps=${fps}`);
  }
  assert.equal(animationFrameIndex(NaN, 9, 12), 0);
  assert.equal(animationFrameIndex(-500, 9, 12), 0);
});

console.log("\nกันป้ายชื่อทับกัน (§7.2)");

const box = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });

check("boxesOverlap ตรวจชนแบบ AABB และนับ 'เฉียดกัน' ในระยะ gap ว่าชน", () => {
  assert.equal(boxesOverlap(box(0, 0, 10, 10), box(5, 5, 15, 15)), true);
  assert.equal(boxesOverlap(box(0, 0, 10, 10), box(20, 0, 30, 10)), false);
  assert.equal(boxesOverlap(box(0, 0, 10, 10), box(11, 0, 20, 10)), false);
  assert.equal(boxesOverlap(box(0, 0, 10, 10), box(11, 0, 20, 10), 2), true); // ห่าง 1px < gap 2
});

check("ป้ายที่ไม่ชนใคร ไม่ถูกขยับ", () => {
  assert.equal(resolveLabelShift(box(0, 0, 100, 30), []), 0);
  assert.equal(resolveLabelShift(box(0, 0, 100, 30), [box(200, 0, 300, 30)]), 0);
});

check("ป้ายที่ชน ถูกดันลงไปใต้ตัวที่ชน ไม่ใช่ขยับทีละก้าวคงที่ (ก้าวสั้นกว่าป้ายสองบรรทัดจะทับซ้ำ)", () => {
  const mine = box(0, 100, 100, 129); // ป้ายสองบรรทัด สูง 29px
  const blocker = box(50, 100, 150, 129);
  const shift = resolveLabelShift(mine, [blocker], { gap: 2 });
  assert.ok(shift > 0, "ต้องถูกดันลง");
  const moved = { ...mine, y1: mine.y1 + shift, y2: mine.y2 + shift };
  assert.equal(boxesOverlap(moved, blocker, 2), false, "ดันแล้วต้องพ้นจริง ไม่ใช่แค่ขยับ");
  assert.ok(moved.y1 > blocker.y2, "ขอบบนต้องต่ำกว่าขอบล่างของตัวที่ชน");
});

check("โซน grid 3 คอลัมน์ที่ป้ายกว้างกว่าระยะห่างที่นั่ง: ทั้ง 3 ป้ายไม่ทับกันเลย (เกณฑ์รับข้อ E)", () => {
  // ระยะห่างที่นั่งจริงของ stopped/bug = 1.7 tile = 54.4px แต่ป้าย "ชื่อ + นาฬิกา" กว้าง ~110px
  const placed = [];
  for (const cx of [73.6, 128, 182.4]) {
    const start = box(cx - 55, 200, cx + 55, 229);
    const shift = resolveLabelShift(start, placed, { gap: 2 });
    placed.push({ ...start, y1: start.y1 + shift, y2: start.y2 + shift });
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.equal(boxesOverlap(placed[i], placed[j], 2), false, `ป้าย ${i} กับ ${j} ยังทับกัน`);
    }
  }
});

check("ป้าย 6 อันซ้อนที่เดียวกันหมด (คิว Browser ล้นช่อง) ก็ยังแยกกันได้ครบ", () => {
  const placed = [];
  for (let i = 0; i < 6; i++) {
    const start = box(400, 150, 510, 179);
    const shift = resolveLabelShift(start, placed, { gap: 2, maxPush: 10 });
    placed.push({ ...start, y1: start.y1 + shift, y2: start.y2 + shift });
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.equal(boxesOverlap(placed[i], placed[j], 2), false, `ป้าย ${i} กับ ${j} ทับกัน`);
    }
  }
});

check("ไม่ดันจนป้ายหลุดขอบล่างของห้อง (ยอมให้ทับดีกว่าอ่านไม่เห็น)", () => {
  const start = box(0, 480, 100, 509);
  const shift = resolveLabelShift(start, [box(0, 480, 100, 509)], { gap: 2, maxY: 510 });
  assert.equal(start.y2 + shift <= 510, true);
});

console.log("\nจำนวนที่นั่งต่อโซน (§7.2)");

check("lounge เป็น grid 2×2 = 4 ที่นั่ง", () => {
  assert.equal(zones.lounge.slots.length, 4);
});

check("stopped เป็น grid 3×1 = 3 ที่นั่ง", () => {
  assert.equal(zones.stopped.slots.length, 3);
});

check("desks เป็น grid 2×3 = 6 ที่นั่ง", () => {
  assert.equal(zones.desks.slots.length, 6);
});

check("bug เป็น grid 3×1 = 3 ที่นั่ง", () => {
  assert.equal(zones.bug.slots.length, 3);
});

check("approval เป็น radial 4 จุด รัศมี 3.1 tile รอบกลางโซน", () => {
  assert.equal(zones.approval.slots.length, 4);
  const [ax, ay, aw, ah] = zones.approval.rect;
  const center = { x: ax + aw / 2, y: ay + ah / 2 };
  for (const s of zones.approval.slots) {
    const dx = s.x - center.x;
    const dy = (s.y - center.y) / 0.62; // radialSlots แบนแนวตั้งด้วย 0.62 ก่อนคำนวณรัศมีจริง
    const r = Math.hypot(dx, dy);
    assert.ok(Math.abs(r - 3.1) < 1e-9, `รัศมีต้องเป็น 3.1 tile พอดี ได้ ${r}`);
  }
});

check("browser มีโต๊ะผู้ถือ 1 + ช่องคิว 4", () => {
  assert.equal(zones.browser.waiterSlots.length, 4);
  assert.ok(zones.browser.holderSlot);
  assert.equal(zones.browser.slots.length, 5); // holder + 4 คิว
});

console.log("\nzoneAndRoleFor() — precedence P1–P9 (spec §5.2 / §7.3)");

const emptyQueue = { holder: null, waiting: [] };

check("P1/P7: stopped ชนะทุกอย่างรวมทั้ง browser holder", () => {
  const char = { id: "t1", state: "stopped" };
  const q = { holder: "t1", waiting: [] };
  assert.deepEqual(zoneAndRoleFor(char, q), { zone: "stopped" });
});

check("P2: approval ธรรมดา (ไม่ได้ถือ/รอ Browser) ไม่มี badge", () => {
  const char = { id: "t2", state: "approval" };
  assert.deepEqual(zoneAndRoleFor(char, emptyQueue), { zone: "approval", browserBadge: false });
});

check("P2 > P3: approval ที่เป็นผู้ถือ Browser ด้วย ได้ badge 🌐 (browserBadge:true) แต่ zone ยังเป็น approval", () => {
  const char = { id: "t3", state: "approval" };
  const q = { holder: "t3", waiting: [] };
  assert.deepEqual(zoneAndRoleFor(char, q), { zone: "approval", browserBadge: true });
});

check("P2 > P4: approval ที่กำลังรอคิว Browser อยู่ด้วย ก็ได้ badge เหมือนกัน", () => {
  const char = { id: "t4", state: "approval" };
  const q = { holder: null, waiting: [{ id: "t4", since: 0, deadlineAt: null }] };
  assert.deepEqual(zoneAndRoleFor(char, q), { zone: "approval", browserBadge: true });
});

check("P3: ผู้ถือ Browser (ไม่ approval ไม่ stopped) → zone browser role holder", () => {
  const char = { id: "t5", state: "working" };
  const q = { holder: "t5", waiting: [] };
  assert.deepEqual(zoneAndRoleFor(char, q), { zone: "browser", role: "holder" });
});

check("P4: ผู้รอคิว Browser (Task) → zone browser role waiter, deadlineAt เป็น null ตาม ADR 0006", () => {
  const char = { id: "t6", state: "working" };
  const q = { holder: "someone-else", waiting: [{ id: "t6", since: 100, deadlineAt: null }] };
  assert.deepEqual(zoneAndRoleFor(char, q), {
    zone: "browser",
    role: "waiter",
    queuePos: 1,
    deadlineAt: null,
  });
});

check("P4: ผู้รอคิว Browser (Run) → deadlineAt มาจาก browserQueue.waiting[].deadlineAt เท่านั้น", () => {
  const char = { id: "schedule:s1", state: "working" };
  const q = {
    holder: "someone-else",
    waiting: [
      { id: "other", since: 0, deadlineAt: null },
      { id: "schedule:s1", since: 200, deadlineAt: 999999 },
    ],
  };
  assert.deepEqual(zoneAndRoleFor(char, q), {
    zone: "browser",
    role: "waiter",
    queuePos: 2,
    deadlineAt: 999999,
  });
});

check("P4: queuePos คือ index+1 ตามลำดับ FIFO จริงในอาเรย์ waiting", () => {
  const q = {
    holder: null,
    waiting: [
      { id: "a", since: 0, deadlineAt: null },
      { id: "b", since: 1, deadlineAt: null },
      { id: "c", since: 2, deadlineAt: null },
    ],
  };
  assert.equal(zoneAndRoleFor({ id: "a", state: "working" }, q).queuePos, 1);
  assert.equal(zoneAndRoleFor({ id: "b", state: "working" }, q).queuePos, 2);
  assert.equal(zoneAndRoleFor({ id: "c", state: "working" }, q).queuePos, 3);
});

check("P3 > P6: ผู้ถือ Browser ไม่ตกไปที่ desks ทั้งที่ state เป็น working", () => {
  const char = { id: "t7", state: "working" };
  const q = { holder: "t7", waiting: [] };
  const result = zoneAndRoleFor(char, q);
  assert.equal(result.zone, "browser");
  assert.notEqual(result.zone, "desks");
});

check("P5/P6: working ธรรมดา (ไม่แตะ Browser เลย) → desks", () => {
  const char = { id: "t8", state: "working" };
  assert.deepEqual(zoneAndRoleFor(char, emptyQueue), { zone: "desks" });
});

check("P8: failed → bug", () => {
  const char = { id: "t9", state: "failed" };
  assert.deepEqual(zoneAndRoleFor(char, emptyQueue), { zone: "bug" });
});

check("P9: idle → lounge", () => {
  const char = { id: "t10", state: "idle" };
  assert.deepEqual(zoneAndRoleFor(char, emptyQueue), { zone: "lounge" });
});

console.log("\nโซน Browser derive จาก browserQueue แหล่งเดียวเท่านั้น (ห้ามมี state ต่อ session)");

check("id ที่ไม่อยู่ใน browserQueue เลย ไม่มีวันได้ zone browser แม้ state จะเป็น working", () => {
  const q = { holder: "other-1", waiting: [{ id: "other-2", since: 0, deadlineAt: null }] };
  const result = zoneAndRoleFor({ id: "not-in-queue", state: "working" }, q);
  assert.equal(result.zone, "desks");
});

console.log("\nsprite hash (FNV-1a 32-bit, spec §5.1)");

check("fnv1aHash เป็น deterministic — id เดิมได้ค่าเดิมทุกครั้ง", () => {
  const a = fnv1aHash("1417000000000004");
  const b = fnv1aHash("1417000000000004");
  assert.equal(a, b);
  assert.equal(typeof a, "number");
  assert.ok(a >= 0 && a <= 0xffffffff, "ต้องเป็น unsigned 32-bit");
});

check("fnv1aHash คงที่ข้ามการ import ใหม่ (ค่าที่รู้ผลลัพธ์ล่วงหน้า กันการรีแฟกเตอร์เปลี่ยนพฤติกรรมโดยไม่ตั้งใจ)", () => {
  // ค่าอ้างอิงตายตัวจาก FNV-1a 32-bit มาตรฐาน (offset basis 0x811c9dc5, prime 0x01000193)
  assert.equal(fnv1aHash(""), 0x811c9dc5);
  assert.equal(fnv1aHash("a"), 0xe40c292c);
});

check("id ต่างกัน hash ต่างกัน (โดยทั่วไป — กันเคส degenerate ที่ทุก id ตกโฟลเดอร์เดียวกันหมด)", () => {
  const ids = ["1417000000000001", "1417000000000002", "schedule:sched-a", "schedule:sched-b"];
  const hashes = new Set(ids.map(fnv1aHash));
  assert.equal(hashes.size, ids.length);
});

check("pickCharacterFolder อยู่ในช่วง [0, folderCount) เสมอ และนิ่งข้ามการรัน", () => {
  const folderCount = 6;
  for (const id of ["1417000000000004", "schedule:sched-daily-export", "x", "a very long id string"]) {
    const idx1 = pickCharacterFolder(id, folderCount);
    const idx2 = pickCharacterFolder(id, folderCount);
    assert.equal(idx1, idx2);
    assert.ok(idx1 >= 0 && idx1 < folderCount);
  }
});

check("pickCharacterFolder คืน 0 อย่างปลอดภัยเมื่อ folderCount เป็น 0/undefined (กันหารด้วยศูนย์)", () => {
  assert.equal(pickCharacterFolder("any-id", 0), 0);
  assert.equal(pickCharacterFolder("any-id", undefined), 0);
});

if (failures > 0) {
  console.error(`\n${failures} layout test(s) failed`);
  process.exit(1);
}
console.log("\nall layout tests passed");
