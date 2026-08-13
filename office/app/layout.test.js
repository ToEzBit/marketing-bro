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
  restFrameIndex,
  boxesOverlap,
  boxInside,
  slotLabelBox,
  characterLabelBox,
  clampBoxInto,
  zoneLabelArea,
  zoneRectPx,
  fixedLabels,
  labelFitReport,
  gridSlots,
  chooseTilePx,
  MIN_TILE_PX,
  CHAR_LABEL_W_TILES,
  CHAR_LABEL_H,
  CHAR_LABEL_TOP_OFFSET,
  CHAR_SPRITE_TILES,
  CHAR_HEAD_TOP_TILES,
  CHAR_BODY_HALF_W_TILES,
  CHAIR_SEAT_Y,
  DESK_CHAIR_ROW,
  DESK_ROW_PITCH,
  labelAboveFor,
  slotHeadTop,
  DEFAULT_ZONE_RECTS,
  ZONE_IDS,
  DOOR_SLOT,
  ROOM,
  TILE,
  ANCHOR,
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

console.log("\nเลือก tilePx จากพื้นที่ที่มีจริง — ห้องกินพื้นที่จอให้เต็ม (#20)");

/**
 * กล่องพื้นที่ว่างจริงของแต่ละขนาดหน้าต่าง — **วัดจากเบราว์เซอร์จริง** ไม่ใช่เดาจากสูตร
 * (Playwright + harness ของ office/index.html: อ่าน .stage.getBoundingClientRect() หัก padding/border
 *  ด้วยโค้ดชุดเดียวกับ availableRoomBox() ใน main.js) — ถ้าใครแก้ chrome ของหน้า (ความสูง header /
 *  ความกว้างแผงข้าง / padding) ตัวเลขชุดนี้ต้องวัดใหม่ ไม่ใช่แก้ให้เทสต์ผ่าน
 */
const SCREENS = [
  { name: "1280×800", availW: 906, availH: 673, expect: 32 },
  { name: "1440×900", availW: 1066, availH: 773, expect: 32 },
  { name: "1920×1080", availW: 1546, availH: 953, expect: 48 },
  { name: "2560×1440", availW: 2186, availH: 1313, expect: 64 },
  { name: "1024×768 (จอเล็ก)", availW: 650, availH: 641, expect: 32 },
  { name: "1920×1080 เต็มจอ", availW: 1920, availH: 1080, expect: 60 },
  { name: "2560×1440 เต็มจอ", availW: 2560, availH: 1440, expect: 80 },
];

check("ทุกขนาดจอในตารางได้ tilePx ตามที่คำนวณด้วยมือไว้ (ห้องกว้าง 32×16 tile)", () => {
  for (const s of SCREENS) {
    assert.equal(chooseTilePx({ availW: s.availW, availH: s.availH }), s.expect, `จอ ${s.name}`);
  }
});

check("จอเล็กเกินกว่าห้องจะลง → คาที่ MIN_TILE_PX ไม่ย่อลงอีก (ให้เลื่อนดูแทนการย่อจนป้ายพัง)", () => {
  assert.equal(MIN_TILE_PX, 32);
  // 1024×768: fit = min(650/32, 641/16) = 20.3 → ถ้าไม่มีพื้นล่าง ห้องจะเหลือ tile 20px ป้ายจะล้นโซนทันที
  assert.equal(chooseTilePx({ availW: 650, availH: 641 }), 32);
  assert.equal(chooseTilePx({ availW: 320, availH: 200 }), 32);
  for (const bad of [0, -100, NaN, undefined]) {
    assert.equal(chooseTilePx({ availW: bad, availH: 800 }), 32, `availW=${bad}`);
    assert.equal(chooseTilePx({ availW: 1600, availH: bad }), 32, `availH=${bad}`);
  }
});

check("ทวีคูณของ tile ต้นฉบับชนะเมื่อยังกินพื้นที่ได้ ≥88% (พิกเซลอาร์ตคมสนิท)", () => {
  assert.equal(chooseTilePx({ availW: 32 * 64, availH: 16 * 64 }), 64); // พอดีเป๊ะ = ขยาย 2 เท่า
  assert.equal(chooseTilePx({ availW: 32 * 70, availH: 16 * 70 }), 64); // 64/70 = 91% ≥ 88% → ยอมเสียที่
  assert.equal(chooseTilePx({ availW: 32 * 33, availH: 16 * 33 }), 32); // 32/33 = 97%
});

check("ต่ำกว่า 88% ยอมให้พิกเซลไม่เท่ากัน แล้วใช้ integer ที่ใหญ่สุดที่ยังใส่ได้ (ไม่เหลือขอบดำครึ่งจอ)", () => {
  assert.equal(chooseTilePx({ availW: 32 * 76, availH: 16 * 76 }), 76); // 64/76 = 84% < 88%
  assert.equal(chooseTilePx({ availW: 32 * 63, availH: 16 * 63 }), 63); // 32/63 = 51%
  assert.equal(chooseTilePx({ availW: 32 * 48.9, availH: 16 * 60 }), 48); // เศษถูกปัดลงเป็นจำนวนเต็ม
});

check("คืนจำนวนเต็มเสมอ และไม่มีวันทำให้ห้องล้นกรอบที่ให้มา (เว้นตอนคาที่ MIN_TILE_PX)", () => {
  for (let w = 700; w <= 3000; w += 7) {
    const tilePx = chooseTilePx({ availW: w, availH: 1200 });
    assert.ok(Number.isInteger(tilePx), `availW=${w} ได้ ${tilePx} ซึ่งไม่ใช่จำนวนเต็ม`);
    assert.ok(tilePx >= MIN_TILE_PX, `availW=${w} ได้ ${tilePx} ซึ่งต่ำกว่า MIN_TILE_PX`);
    if (tilePx > MIN_TILE_PX) {
      assert.ok(tilePx * ROOM.cols <= w, `availW=${w} ได้ห้องกว้าง ${tilePx * ROOM.cols} ซึ่งล้นกรอบ`);
      assert.ok(tilePx * ROOM.rows <= 1200, `availW=${w}: ห้องสูง ${tilePx * ROOM.rows} ล้นกรอบ`);
    }
  }
});

check("ขนาดห้อง/ขนาด tile ต้นฉบับมาจาก map.json+manifest ห้าม assume 32×16 หรือ 32px (§8.2)", () => {
  // ห้องสูงกว่า (40×30) ⇒ ความสูงเป็นตัวบีบแทนความกว้าง
  assert.equal(chooseTilePx({ availW: 4000, availH: 16 * 60, cols: 40, rows: 30 }), 32);
  assert.equal(chooseTilePx({ availW: 40 * 50, availH: 30 * 50, cols: 40, rows: 30 }), 50);
  // ชุด asset ที่ tile ต้นฉบับ 16px → "ทวีคูณ" คือทวีคูณของ 16 (แต่ยังห้ามต่ำกว่า MIN_TILE_PX)
  assert.equal(chooseTilePx({ availW: 32 * 50, availH: 16 * 50, baseTilePx: 16 }), 48);
  assert.equal(chooseTilePx({ availW: 320, availH: 200, baseTilePx: 16 }), 32);
  // ชุดที่ tile ต้นฉบับใหญ่กว่า 32 ห้ามถูกย่อลงมา 32 (ย่อภาพพิกเซล = เละกว่าห้องล้นจอ)
  assert.equal(chooseTilePx({ availW: 320, availH: 200, baseTilePx: 64 }), 64);
  assert.equal(chooseTilePx({ availW: 32 * 130, availH: 16 * 130, baseTilePx: 64 }), 128);
});

check("★ containment ยังจริงที่ tilePx *ทุกค่าที่ chooseTilePx เลือกจริง* (ไม่ใช่แค่ค่าที่เลือกมาเทสต์เอง)", () => {
  const chosen = new Set(SCREENS.map((s) => chooseTilePx({ availW: s.availW, availH: s.availH })));
  // กวาดทุกความกว้างจอที่เป็นไปได้ด้วย เผื่อมีค่าแปลก ๆ ที่ตารางข้างบนไม่โดน
  for (let w = 600; w <= 4000; w += 13) chosen.add(chooseTilePx({ availW: w, availH: 2200 }));
  for (const tilePx of chosen) {
    for (const autoPaused of [0, 3]) {
      const problems = labelFitReport(zones, tilePx, autoPaused);
      assert.deepEqual(problems, [], `tilePx=${tilePx}: ${problems.map((p) => p.detail).join(" | ")}`);
    }
  }
});

check("★ ป้ายของทุกที่นั่งอยู่ในห้องอยู่แล้วที่ tilePx ทุกค่าที่เลือกจริง (clamp ยังเป็น no-op)", () => {
  for (const s of SCREENS) {
    const tilePx = chooseTilePx({ availW: s.availW, availH: s.availH });
    const bounds = { x1: 4, y1: 4, x2: ROOM.cols * tilePx - 4, y2: ROOM.rows * tilePx - 4 };
    for (const id of ZONE_IDS) {
      zones[id].slots.forEach((slot, i) => {
        const raw = slotLabelBox(slot, tilePx);
        assert.deepEqual(clampBoxInto(raw, bounds), raw, `จอ ${s.name} โซน ${id} ที่นั่ง ${i}`);
      });
    }
  }
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

check("restFrameIndex: ไม่ระบุ frame ใน manifest = เฟรม 0 (พฤติกรรมเดิมของทุกชุด asset)", () => {
  assert.equal(restFrameIndex(undefined, 3), 0);
  assert.equal(restFrameIndex({}, 3), 0);
  assert.equal(restFrameIndex({ anim: "sit" }, 3), 0);
});

check("restFrameIndex: ชุด default บอกให้ working ใช้เฟรมนั่งเก้าอี้ (ไม่ใช่นั่งกับพื้น) — บั๊กภาพ #20", () => {
  const manifest = JSON.parse(readFileSync(new URL("../assets/default/manifest.json", import.meta.url), "utf8"));
  const sit = manifest.character.animations.sit;
  assert.equal(manifest.states.working.anim, "sit");
  assert.equal(restFrameIndex(manifest.states.working, sit.frames), 2, "ท่านั่งเก้าอี้คือเฟรม 2 ของ sit.png");
  // สถานะที่เหลือยังเป็นเฟรม 0 — failed ใช้ sleep→sit เฟรม 0 (ท่าทรุดกับพื้น) โดยตั้งใจ
  for (const id of ["idle", "approval", "failed", "stopped"]) {
    assert.equal(restFrameIndex(manifest.states[id], sit.frames), 0, `states.${id} ต้องยังเป็นเฟรม 0`);
  }
});

check("restFrameIndex หนีบค่าไม่ให้อ่านเลยชีต (ชุด asset ที่ sit มีเฟรมเดียวต้องไม่วาดพัง — §8.2)", () => {
  assert.equal(restFrameIndex({ frame: 2 }, 1), 0);
  assert.equal(restFrameIndex({ frame: 9 }, 3), 2);
  for (const bad of [undefined, 0, -1, NaN, "x", null]) {
    assert.equal(restFrameIndex({ frame: 2 }, bad), 0, `frameCount=${bad}`);
    assert.equal(restFrameIndex({ frame: bad }, 3), 0, `frame=${bad}`);
  }
  assert.equal(restFrameIndex({ frame: 1.9 }, 3), 1); // ปัดลงเป็นจำนวนเต็ม
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

console.log("\nป้ายที่พลิกไปอยู่เหนือหัว (ที่นั่งที่ใต้เท้าไม่เหลือที่ให้ป้าย — #20)");

check("characterLabelBox(above) วางป้ายไว้เหนือหัว ขนาดเท่าเดิมเป๊ะ และยังกึ่งกลางตัวละคร", () => {
  const below = characterLabelBox(200, 300, 32);
  const above = characterLabelBox(200, 300, 32, true);
  assert.equal(above.x2 - above.x1, below.x2 - below.x1, "กว้างเท่าเดิม");
  assert.equal(above.y2 - above.y1, below.y2 - below.y1, "สูงเท่าเดิม");
  assert.equal((above.x1 + above.x2) / 2, 200);
  assert.ok(above.y2 < 300 - CHAR_SPRITE_TILES * 32 + 1, "ขอบล่างต้องอยู่เหนือหัว ไม่ใช่กลางตัว");
});

check("★ พลิกเฉพาะที่นั่งที่จำเป็นจริง — ที่เหลือทั้งห้องยังอยู่ใต้เท้าเหมือนเดิม", () => {
  const flipped = [];
  for (const id of ZONE_IDS) {
    zones[id].slots.forEach((s, i) => {
      if (s.labelAbove) flipped.push(`${id}#${i}`);
    });
  }
  // มีที่เดียวในห้องที่ป้ายใต้เท้าลงไม่ได้จริง ๆ คือแถวเก้าอี้ล่างสุดของ desks (ห่างก้นโซน 0.2 tile)
  assert.deepEqual(flipped, ["desks#4", "desks#5"]);
  // และต้องพลิกเพราะ "ไม่มีทางเลือก" จริง ๆ ไม่ใช่เพราะความชอบ — ที่ tilePx ไหนก็ยังต้องพลิก
  for (const [id, idx] of [["desks", 4], ["desks", 5]]) {
    for (const tilePx of [32, 48, 64, 128]) {
      assert.ok(
        labelAboveFor(zones[id], zones[id].slots[idx], tilePx),
        `${id} ที่นั่ง ${idx}: ป้ายใต้เท้าลงได้ที่ tilePx=${tilePx} ⇒ ไม่ควรพลิก`,
      );
    }
  }
});

check("★ ไม่มีป้ายใบไหนในห้องไปคลุม 'หัว' ของตัวละครตัวอื่น (กติกาที่ตัดสินผังของ 3 โซน — #20)", () => {
  // นี่คือเกณฑ์ที่ทำให้ต้องพลิกป้าย และเป็นเกณฑ์ที่บอกว่าโซน Browser ให้ผู้ถือนั่งเก้าอี้ไม่ได้
  // ตรวจทุก tilePx ที่ chooseTilePx เลือกจริง เพราะกล่องป้ายสูงเป็น px ตายตัวแต่ตัวละครโตตาม tile
  const chosen = new Set([TILE]);
  for (let w = 600; w <= 4000; w += 37) chosen.add(chooseTilePx({ availW: w, availH: 2200 }));
  for (const tilePx of chosen) {
    for (const id of ZONE_IDS) {
      const slots = zones[id].slots;
      slots.forEach((slot, i) => {
        const box = slotLabelBox(slot, tilePx);
        slots.forEach((other, j) => {
          if (i === j) return;
          const half = CHAR_BODY_HALF_W_TILES * tilePx;
          const covers =
            box.y2 > slotHeadTop(other, tilePx) &&
            box.y1 < other.y * tilePx &&
            box.x1 < other.x * tilePx + half &&
            box.x2 > other.x * tilePx - half;
          assert.equal(covers, false, `tilePx=${tilePx} โซน ${id}: ป้ายของที่นั่ง ${i} คลุมหัวที่นั่ง ${j}`);
        });
      });
    }
  }
});

check("★ การตัดสินว่าพลิกหรือไม่ ไม่ขึ้นกับขนาดจอ (ป้ายห้ามเด้งสลับบน/ล่างตอนย่อ-ขยายหน้าต่าง)", () => {
  const flags = zones.desks.slots.map((s) => !!s.labelAbove);
  for (const availW of [700, 1000, 1546, 2186, 2560, 3800]) {
    const tilePx = chooseTilePx({ availW, availH: 2200 });
    const rebuilt = buildZones();
    assert.deepEqual(rebuilt.desks.slots.map((s) => !!s.labelAbove), flags, `tilePx=${tilePx}`);
  }
});

check("★ ป้ายที่พลิกขึ้นบนต้องไม่ทับป้ายของแถวเหนือมัน และไม่ทับหัวโซน", () => {
  for (const tilePx of [32, 38, 48, 64]) {
    const boxes = zones.desks.slots.map((s) => slotLabelBox(s, tilePx));
    const area = zoneLabelArea(zones.desks, tilePx);
    for (const b of boxes) assert.ok(b.y1 >= area.y1, `tilePx=${tilePx}: ป้ายล้ำหัวโซน`);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        assert.equal(boxesOverlap(boxes[i], boxes[j]), false, `tilePx=${tilePx}: ป้าย ${i} กับ ${j} ทับกัน`);
      }
    }
  }
});

check("★ ป้ายที่พลิกขึ้นบนต้องอยู่เหนือ 'หัว' ของเจ้าของป้ายจริง ๆ ไม่ใช่ทับตัวมันเอง", () => {
  for (const tilePx of [32, 48, 64]) {
    for (const slot of zones.desks.slots.filter((s) => s.labelAbove)) {
      const headTop = slot.y * tilePx - (CHAR_SPRITE_TILES - CHAR_HEAD_TOP_TILES) * tilePx;
      assert.ok(slotLabelBox(slot, tilePx).y2 <= headTop, `tilePx=${tilePx}: ป้ายทับหัวเจ้าของเอง`);
    }
  }
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

console.log("\nป้ายของตัวละครที่กำลังเดินเข้า/ออกทางประตู (อยู่นอกทุกโซนชั่วคราว)");

check("ป้ายที่ประตูตกใต้ขอบห้องทั้งใบ ถ้าไม่ดึงกลับ — นาฬิกาจะหายตลอดช่วงเดินเข้า/ออก", () => {
  const H = ROOM.rows * TILE;
  const raw = characterLabelBox(DOOR_SLOT.x * TILE, DOOR_SLOT.y * TILE, TILE);
  assert.ok(raw.y2 > H, `ป้ายที่ประตูต้องตกใต้ขอบห้องจริง (y2=${raw.y2} vs H=${H}) ไม่งั้นเทสต์นี้ไม่ได้ทดสอบอะไร`);
  const bounds = { x1: 4, y1: 4, x2: ROOM.cols * TILE - 4, y2: H - 4 };
  const fixed = clampBoxInto(raw, bounds);
  assert.ok(boxInside(fixed, bounds), "ดึงกลับแล้วต้องอยู่ในห้อง");
  assert.equal(fixed.x2 - fixed.x1, raw.x2 - raw.x1, "เลื่อนเท่านั้น ห้ามย่อ");
  assert.equal(fixed.y2 - fixed.y1, raw.y2 - raw.y1, "เลื่อนเท่านั้น ห้ามย่อ");
});

check("★ clamp ต้องเป็น no-op กับที่นั่งทุกที่ในทุกโซน — ไม่งั้นตาข่าย containment กลายเป็นของปลอม", () => {
  const bounds = { x1: 4, y1: 4, x2: ROOM.cols * TILE - 4, y2: ROOM.rows * TILE - 4 };
  for (const id of ZONE_IDS) {
    zones[id].slots.forEach((slot, i) => {
      const raw = slotLabelBox(slot, TILE);
      assert.deepEqual(clampBoxInto(raw, bounds), raw, `โซน ${id} ที่นั่ง ${i}: ป้ายต้องอยู่ในห้องอยู่แล้ว`);
    });
  }
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

check("★ ที่นั่งโซน desks ลงบน 'เก้าอี้จริง' ของผังห้องทุกตัว ไม่ใช่ลอยอยู่บนโต๊ะ (บั๊กภาพ #20)", () => {
  // เก้าอี้ใน map.json ของชุด default อยู่ที่ tile (18,3) (21,3) (18,8) (21,8) (18,13) (21,13)
  // ⇒ ที่นั่งต้องอยู่กลาง tile ตามแนวนอน และอยู่ที่ CHAIR_SEAT_Y ของแถวเก้าอี้ตามแนวตั้ง
  const [rx, ry] = zones.desks.rect;
  const chairRows = [0, 1, 2].map((i) => ry + DESK_CHAIR_ROW + i * DESK_ROW_PITCH);
  assert.deepEqual(chairRows, [3, 8, 13], "แถวเก้าอี้ต้องตรงกับ map.json ของชุด default");
  for (const [i, slot] of zones.desks.slots.entries()) {
    const row = chairRows[Math.floor(i / 2)];
    assert.ok(
      Math.abs(slot.y - (row + CHAIR_SEAT_Y)) < 1e-9,
      `ที่นั่ง ${i}: y=${slot.y} ไม่ได้อยู่บนเก้าอี้แถว ${row} (ต้องเป็น ${row + CHAIR_SEAT_Y})`,
    );
    assert.ok(Math.abs(((slot.x % 1) + 1) % 1 - 0.5) < 1e-9, `ที่นั่ง ${i}: x=${slot.x} ไม่ได้อยู่กลาง tile เก้าอี้`);
    assert.ok(slot.x > rx && slot.x < rx + zones.desks.rect[2], `ที่นั่ง ${i} หลุดกรอบโซน`);
  }
});

check("★ ที่นั่งยังคำนวณจาก rect จริง: rect ที่ map.json ให้มาเปลี่ยน ที่นั่งต้องเลื่อนตามทั้งชุด", () => {
  const moved = buildZones({ desks: [10, 4, 6, 13] });
  const base = buildZones();
  for (const [i, slot] of moved.desks.slots.entries()) {
    assert.equal(slot.x, base.desks.slots[i].x - 7, `ที่นั่ง ${i} ไม่ได้เลื่อนตามแกน x ของ rect`);
    assert.equal(slot.y, base.desks.slots[i].y + 3, `ที่นั่ง ${i} ไม่ได้เลื่อนตามแกน y ของ rect`);
  }
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

check("browser มีโต๊ะผู้ถือ 1 + ช่องคิว 2 (คิวยาวกว่านี้บอกเป็น +n ที่หัวโซน — #20)", () => {
  assert.equal(zones.browser.waiterSlots.length, 2);
  assert.ok(zones.browser.holderSlot);
  assert.equal(zones.browser.slots.length, 3); // holder + 2 คิว
});

check("★ คิว Browser เป็นแถวเดียว และทั้งโซนมีไม่เกิน 2 แถว (สามแถวคือต้นเหตุที่ป้ายบังงานศิลป์)", () => {
  const waiterRows = new Set(zones.browser.waiterSlots.map((s) => s.y));
  assert.equal(waiterRows.size, 1, "ช่องคิวทุกช่องต้องอยู่แถวเดียวกัน");
  const rows = new Set(zones.browser.slots.map((s) => s.y));
  assert.ok(rows.size <= 2, `โซน browser มี ${rows.size} แถว — เกินที่พื้นที่รองรับได้`);
  // ผู้ถืออยู่แถวบนสุดเสมอ (โต๊ะจริงของ tileset อยู่แถวนั้น และ P3 ต้องอ่านออกก่อนคิว)
  assert.ok(zones.browser.holderSlot.y < zones.browser.waiterSlots[0].y);
});

check("★ ป้ายผู้ถือ Browser ต้องไม่ล้ำลงไปถึง 'หัว' ของคิว — เงื่อนไขที่ทำให้ผู้ถือยืนไม่ได้นั่ง (#20)", () => {
  // เงื่อนไขนี้คือเหตุผลทั้งหมดที่โซน Browser ใช้ท่ายืน: ถ้าดันจุดเท้าผู้ถือลงไปที่เบาะเก้าอี้
  // (by + DESK_CHAIR_ROW + CHAIR_SEAT_Y เหมือนโซน desks) ป้ายของมันจะเลื่อนลงไปคลุมหัวคิวทั้งหัว
  // ⇒ ใครจะย้ายผู้ถือลงต้องแก้ผังคิวด้วย ไม่ใช่แค่ขยับตัวเลข
  const headTopOf = (slot, tilePx) => slot.y * tilePx - (CHAR_SPRITE_TILES - CHAR_HEAD_TOP_TILES) * tilePx;
  for (const tilePx of [32, 38, 48, 64]) {
    const holderLabel = slotLabelBox(zones.browser.holderSlot, tilePx);
    for (const [i, slot] of zones.browser.waiterSlots.entries()) {
      assert.ok(
        holderLabel.y2 <= headTopOf(slot, tilePx),
        `tilePx=${tilePx}: ป้ายผู้ถือ (จบที่ ${holderLabel.y2}) ล้ำหัวคิว ${i} (เริ่มที่ ${headTopOf(slot, tilePx)})`,
      );
    }
  }
  // และเทสต์นี้ต้องจับได้จริงถ้ามีคนย้ายผู้ถือไปนั่งเก้าอี้
  const seated = buildZones();
  seated.browser.holderSlot = { ...seated.browser.holderSlot, y: seated.browser.rect[1] + DESK_CHAIR_ROW + CHAIR_SEAT_Y };
  assert.ok(
    slotLabelBox(seated.browser.holderSlot, TILE).y2 > headTopOf(seated.browser.waiterSlots[0], TILE),
    "ถ้าย้ายผู้ถือไปนั่งเก้าอี้แล้วเทสต์ยังผ่าน แปลว่าเทสต์นี้ไม่ได้ทดสอบอะไร",
  );
});

check("★ ป้ายผู้ถือ Browser ไม่ทับป้ายของแถวคิว และเฉี่ยวตัวคิวได้ไม่เกินครึ่งบนของสไปรต์", () => {
  for (const tilePx of [32, 38, 48, 64]) {
    const holderLabel = slotLabelBox(zones.browser.holderSlot, tilePx);
    for (const [i, slot] of zones.browser.waiterSlots.entries()) {
      assert.equal(boxesOverlap(holderLabel, slotLabelBox(slot, tilePx)), false, `tilePx=${tilePx} คิว ${i}`);
      // ป้ายผู้ถือต้องไม่ล้ำลงไปถึง "กลางตัว" ของคิว (จุดที่ผังเดิมพังคือกินทั้งหัวและลำตัว)
      const foot = slot.y * tilePx;
      const headTop = foot - ANCHOR.y * (tilePx / TILE); // จุดเท้าอยู่ที่ ANCHOR.y ของเฟรม (ดู drawSpriteFrame)
      assert.ok(
        holderLabel.y2 <= (headTop + foot) / 2,
        `tilePx=${tilePx}: ป้ายผู้ถือกินลงไปเกินครึ่งตัวของคิว ${i}`,
      );
    }
  }
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
