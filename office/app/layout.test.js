/**
 * Run with: npx tsx office/app/layout.test.js
 * ครอบ layout.js: โซนไม่ซ้อนกัน, จำนวนที่นั่งต่อโซนตาม spec §7.2, zoneAndRoleFor() ครบทุกสาขา
 * (P1–P9 ของ spec §5.2 / §7.3) และ hash ของ sprite นิ่งข้ามการรัน — ตามที่ ticket #20 ระบุ
 */
import assert from "node:assert/strict";
import {
  buildZones,
  findOverlappingZones,
  zoneAndRoleFor,
  fnv1aHash,
  pickCharacterFolder,
  DEFAULT_ZONE_RECTS,
  ZONE_IDS,
} from "./layout.js";

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
