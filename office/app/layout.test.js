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
  boxInside,
  slotLabelBox,
  characterLabelBox,
  zoneLabelArea,
  zoneRectPx,
  fixedLabels,
  labelFitReport,
  gridSlots,
  CHAR_LABEL_W_TILES,
  CHAR_LABEL_H,
  CHAR_LABEL_TOP_OFFSET,
  DEFAULT_ZONE_RECTS,
  ZONE_IDS,
  DOOR_SLOT,
  ROOM,
  TILE,
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

console.log("\nป้ายอยู่ในกรอบโซนของตัวเอง — containment (§7.2)");
//
// นี่คือ "ตาข่าย" ที่หายไปตอนบั๊กป้ายกลืนห้อง: บั๊กของฟังก์ชันวาดป้ายสามรุ่นที่ผ่านมาไม่มีเทสต์ไหนจับได้เลย
// เพราะเกณฑ์ที่ใช้วัดตอนนั้นคือ "ป้ายห้ามทับกัน" ซึ่งผ่านได้ด้วยการดันป้ายออกไปนอกโซนตัวเอง
//
// เกณฑ์ที่ถูกคือ containment: กล่องป้ายทุกใบต้องอยู่ในกรอบโซนของตัวเอง และเพราะโซนไม่ซ้อนกัน
// (พิสูจน์แล้วด้านบนด้วย findOverlappingZones) containment จึง **implies** ว่าป้ายข้ามโซนไม่ได้
// และป้ายของคนละโซนทับกันไม่ได้ ส่วน "ป้ายในโซนเดียวกันไม่ทับกัน" เป็นผลพลอยได้ที่ตรวจเพิ่มไว้ท้ายสุด

const box = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });

check("boxesOverlap ตรวจชนแบบ AABB และนับ 'เฉียดกัน' ในระยะ gap ว่าชน", () => {
  assert.equal(boxesOverlap(box(0, 0, 10, 10), box(5, 5, 15, 15)), true);
  assert.equal(boxesOverlap(box(0, 0, 10, 10), box(20, 0, 30, 10)), false);
  assert.equal(boxesOverlap(box(0, 0, 10, 10), box(11, 0, 20, 10)), false);
  assert.equal(boxesOverlap(box(0, 0, 10, 10), box(11, 0, 20, 10), 2), true); // ห่าง 1px < gap 2
});

check("boxInside: ขอบชนขอบพอดีถือว่าอยู่ข้างใน ล้ำออกไปแม้ด้านเดียวถือว่าไม่อยู่", () => {
  const outer = box(0, 0, 100, 100);
  assert.equal(boxInside(box(0, 0, 100, 100), outer), true);
  assert.equal(boxInside(box(10, 10, 90, 90), outer), true);
  assert.equal(boxInside(box(-1, 10, 90, 90), outer), false);
  assert.equal(boxInside(box(10, 10, 101, 90), outer), false);
  assert.equal(boxInside(box(10, 10, 90, 101), outer), false);
});

check("กล่องป้ายมีขนาดตายตัว ไม่ขึ้นกับข้อความ/ฟอนต์ และผูกกับเท้าตัวละคร", () => {
  const b = characterLabelBox(200, 300, 32);
  assert.equal(b.x2 - b.x1, CHAR_LABEL_W_TILES * 32, "กว้างเท่า CHAR_LABEL_W_TILES เสมอ");
  assert.equal(b.y2 - b.y1, CHAR_LABEL_H, "สูงคงที่ (สองบรรทัดเสมอ)");
  assert.equal((b.x1 + b.x2) / 2, 200, "กึ่งกลางตรงกับตัวละคร");
  assert.equal(b.y1, 300 + CHAR_LABEL_TOP_OFFSET, "อยู่ใต้เท้าตัวละคร");
  // ความกว้างสเกลตาม tile ⇒ ห้องที่ tile ใหญ่ขึ้น ป้ายก็ใหญ่ตามสัดส่วนเดิม
  assert.equal(characterLabelBox(0, 0, 64).x2 - characterLabelBox(0, 0, 64).x1, CHAR_LABEL_W_TILES * 64);
});

check("★ ป้ายของ *ทุกที่นั่ง* ใน *ทุกโซน* อยู่ในกรอบโซนของตัวเอง (เกณฑ์หลักของ #20)", () => {
  const problems = labelFitReport(zones, TILE, 1);
  assert.deepEqual(problems, [], problems.map((p) => `${p.kind}/${p.zone}: ${p.detail}`).join("\n"));
});

check("★ containment ยังจริงเมื่อ tile ใหญ่ขึ้น (manifest ตั้ง scale อื่นได้ — §8.2 ห้าม assume ขนาด)", () => {
  for (const tilePx of [32, 40, 48, 64]) {
    const problems = labelFitReport(zones, tilePx, 1);
    assert.deepEqual(problems, [], `tilePx=${tilePx}: ${problems.map((p) => p.detail).join(" | ")}`);
  }
});

check("ตรวจซ้ำแบบตรง ๆ ไม่ผ่าน labelFitReport — ทุกที่นั่งทุกโซน เทียบกับกรอบโซนดิบ ๆ", () => {
  for (const id of ZONE_IDS) {
    const zone = zones[id];
    const rect = zoneRectPx(zone.rect, TILE);
    zone.slots.forEach((slot, i) => {
      const b = slotLabelBox(slot, TILE);
      assert.ok(
        b.x1 >= rect.x1 && b.x2 <= rect.x2 && b.y1 >= rect.y1 && b.y2 <= rect.y2,
        `โซน ${id} ที่นั่ง ${i}: ป้าย [${b.x1},${b.y1}]–[${b.x2},${b.y2}] ล้นกรอบโซน [${rect.x1},${rect.y1}]–[${rect.x2},${rect.y2}]`,
      );
    });
  }
});

check("ป้ายตัวละครไม่ล้ำแถบหัวโซน (หัวโซนต้องอ่านออกเสมอ — spec §7.2)", () => {
  for (const id of ZONE_IDS) {
    const area = zoneLabelArea(zones[id], TILE);
    const header = fixedLabels(zones, TILE).zoneHeader[id];
    assert.ok(header.y2 <= area.y1, `หัวโซน ${id} ล้ำเข้าไปในพื้นที่ป้ายตัวละคร`);
    for (const slot of zones[id].slots) {
      assert.ok(slotLabelBox(slot, TILE).y1 >= area.y1, `ป้ายในโซน ${id} ล้ำขึ้นไปทับหัวโซน`);
    }
  }
});

check("ผลพลอยได้: ป้ายในโซนเดียวกันไม่ทับกันเลยสักคู่ (ไม่ต้องมี pass ดันป้ายหลบกัน)", () => {
  for (const id of ZONE_IDS) {
    const boxes = zones[id].slots.map((s) => slotLabelBox(s, TILE));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        assert.equal(boxesOverlap(boxes[i], boxes[j]), false, `โซน ${id}: ป้ายที่นั่ง ${i} กับ ${j} ทับกัน`);
      }
    }
  }
});

check("โซนที่เตี้ย/แคบเกินกว่ากล่องป้ายจะลง ต้องถูก 'จับได้' ไม่ใช่เงียบ (เทสต์ว่าตาข่ายทำงานจริง)", () => {
  const cramped = buildZones({ lounge: [1, 1, 2, 2] });
  const problems = labelFitReport(cramped, TILE);
  assert.ok(
    problems.some((p) => p.zone === "lounge" && p.kind === "contain"),
    "โซนเล็กจนป้ายไม่ลง ต้องรายงาน contain",
  );
});

check("ที่นั่งที่ถูกดันออกนอกโซน (padX ติดลบ) ต้องถูกจับได้ — กันการรีแฟกเตอร์ทำ pad พังเงียบ ๆ", () => {
  const broken = buildZones();
  broken.stopped.slots = gridSlots(broken.stopped.rect, 3, 1, { padX: 1.3, padTop: 2.4 });
  const problems = labelFitReport(broken, TILE);
  assert.ok(problems.some((p) => p.zone === "stopped" && p.kind === "contain"), "3 คอลัมน์ใน 6 tile ต้องล้น");
  assert.ok(problems.some((p) => p.zone === "stopped" && p.kind === "overlap"), "และต้องทับกันเองด้วย");
});

console.log("\nป้ายตำแหน่งตายตัว (หัวโซน / FIFO / ผู้ถือ Browser / Schedule auto-pause)");

check("ป้ายตำแหน่งตายตัวทุกใบอยู่ในกรอบโซนของตัวเอง รวม marker ของ auto-pause", () => {
  for (const count of [0, 1, 3, 6]) {
    const problems = labelFitReport(zones, TILE, count).filter((p) => p.kind === "fixed");
    assert.deepEqual(problems, [], `auto-paused ${count} อัน: ${problems.map((p) => p.detail).join(" | ")}`);
  }
});

check("หมายเหตุ FIFO ย้ายมาอยู่ใต้หัวโซน Browser ไม่ใช่ก้นโซน (ก้นโซนคือแถวคิวแถวสุดท้าย)", () => {
  const f = fixedLabels(zones, TILE);
  const browserRect = zoneRectPx(zones.browser.rect, TILE);
  assert.ok(f.browserNote.y1 < browserRect.y1 + 48, "ต้องอยู่ช่วงหัวโซน");
  for (const slot of zones.browser.slots) {
    assert.equal(boxesOverlap(f.browserNote, slotLabelBox(slot, TILE)), false, "ต้องไม่ทับป้ายของช่องคิว");
  }
});

check("ป้ายผู้ถือ Browser (ตอนตัวถือไปยืนโซน Approval) ไม่ทับป้ายของช่องคิวที่เหลือ", () => {
  const f = fixedLabels(zones, TILE);
  for (const slot of zones.browser.waiterSlots) {
    assert.equal(boxesOverlap(f.browserHolder, slotLabelBox(slot, TILE)), false);
  }
});

check("ป้าย/marker ของ Schedule auto-pause ไม่ทับป้ายตัวละครในโซน bug", () => {
  const f = fixedLabels(zones, TILE, 3);
  const charBoxes = zones.bug.slots.map((s) => slotLabelBox(s, TILE));
  for (const b of charBoxes) {
    assert.equal(boxesOverlap(f.autoPause.plate, b), false, "ป้าย auto-pause ทับป้ายตัวละคร");
    for (const m of f.autoPause.markers) {
      const mb = { x1: m.cx - m.r, y1: m.cy - m.r, x2: m.cx + m.r, y2: m.cy + m.r };
      assert.equal(boxesOverlap(mb, b), false, "marker auto-pause ทับป้ายตัวละคร");
    }
  }
});

console.log("\nกริดที่นั่งที่ไม่เต็มแถว (gridSlots count)");

check("count น้อยกว่า cols×rows: ตัดที่นั่งส่วนเกิน และแถวสุดท้ายจัดกึ่งกลาง rect", () => {
  const slots = gridSlots([1, 8, 6, 6], 2, 2, { padX: 1.5, padTop: 2.4, padBottom: 1.2, count: 3 });
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map((s) => s.x), [2.5, 5.5, 4]); // แถวล่างอยู่กลางโซน (1 + 6/2 = 4)
  assert.notEqual(slots[0].y, slots[2].y, "ต้องอยู่คนละแถว");
});

check("ไม่ใส่ count = พฤติกรรมเดิมเป๊ะ (กริดเต็ม)", () => {
  const full = gridSlots([1, 1, 6, 6], 2, 2, { padX: 1.5 });
  assert.equal(full.length, 4);
});

console.log("\nจำนวนที่นั่งต่อโซน (§7.2)");

check("lounge เป็น grid 2×2 = 4 ที่นั่ง", () => {
  assert.equal(zones.lounge.slots.length, 4);
});

check("stopped มี 3 ที่นั่ง (ทรงพีระมิด 2+1 — 3 คอลัมน์ใน 6 tile ทำให้ป้ายชนกันแน่นอน)", () => {
  assert.equal(zones.stopped.slots.length, 3);
});

check("desks เป็น grid 2×3 = 6 ที่นั่ง", () => {
  assert.equal(zones.desks.slots.length, 6);
});

check("bug มี 3 ที่นั่ง (ทรงพีระมิด 2+1 เหมือน stopped)", () => {
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
