// office/app/layout.js
//
// เรขาคณิตของห้อง + การ derive โซนจากสถานะ — โมดูลนี้ "pure" ล้วน (ไม่แตะ DOM/canvas/เวลาจริง)
// เพื่อให้รันเทสต์ด้วย tsx ตรง ๆ ได้ (ดู layout.test.js) และพอร์ตไปที่อื่นได้ง่าย
//
// อ้างอิงตาราง zone rect และกติกา derive จาก spec §7.2 / §7.3 (marketing-bro issue #20)

"use strict";

/** px ต่อ tile ของห้อง **ค่าเริ่มต้น** — ค่าจริงตอนรันมาจาก `manifest.room.tileSize * room.scale`
 *  (ดู tilePxOf() ใน assets.js) แล้วส่งเข้า worldPos()/createRoomState()/createRenderer() เป็นพารามิเตอร์
 *  ห้ามใช้ค่านี้เป็น "ขนาด tile จริง" ในโค้ดที่วาด — spec §8.2 บังคับว่าโค้ดห้าม assume ขนาด */
export const TILE = 32;
/** px ต่อเฟรมสไปรต์ตัวละคร (ตรงกับ manifest.character.frameSize ค่าเริ่มต้น) */
export const FRAME = 64;
/** จุดเท้าของตัวละครภายในเฟรม (ตรงกับ manifest.character.anchor ค่าเริ่มต้น) */
export const ANCHOR = { x: 32, y: 62 };
/** ขนาดห้องเป็น tile **ค่าเริ่มต้น** — ถูกแทนด้วย map.width/height เมื่อมี map.json (roomSizeFromMap) */
export const ROOM = { cols: 32, rows: 16 };
/** ลำดับแถวในชีตสไปรต์ค่าเริ่มต้น (ตรงกับ manifest.character.directions ของชุด LPC) */
export const DEFAULT_DIRECTIONS = ["up", "left", "down", "right"];
/** จุด "ประตู" ที่ตัวละครเดินเข้า/ออกตอนเกิด/หาย (กึ่งกลางผนังล่างของห้องขนาดเริ่มต้น) */
export const DOOR_SLOT = doorSlotFor(ROOM.cols, ROOM.rows);

/** ประตูของห้องขนาดใด ๆ — กึ่งกลางผนังล่าง (ห้องขนาดเริ่มต้น 32x16 ได้ค่าเดียวกับ DOOR_SLOT เป๊ะ) */
export function doorSlotFor(cols = ROOM.cols, rows = ROOM.rows) {
  return { x: cols / 2, y: rows - 0.6, dir: "up" };
}

/** ลำดับโซนคงที่ — ใช้ทั้งวาดพื้นห้องและวนลูป assign ที่นั่ง */
export const ZONE_IDS = ["lounge", "stopped", "approval", "desks", "browser", "bug"];

export const ZONE_LABELS = {
  lounge: { label: "ว่าง", icon: "☕" },
  stopped: { label: "ถูกสั่งหยุด", icon: "⏸" },
  approval: { label: "รอ Approval", icon: "🔔" },
  desks: { label: "กำลังทำงาน", icon: "💻" },
  browser: { label: "รอคิว–ถือ Browser", icon: "🌐" },
  bug: { label: "ล้มเหลว", icon: "🐞" },
};

/** rect เริ่มต้นของแต่ละโซน หน่วย tile [x, y, w, h] — ตาม spec §7.2
 *  ถูก override ได้จาก object layer `zones` ของ map.json (ดู buildZones()) */
export const DEFAULT_ZONE_RECTS = {
  lounge: [1, 1, 6, 6],
  stopped: [1, 8, 6, 6],
  approval: [8, 1, 8, 13],
  desks: [17, 1, 6, 13],
  browser: [24, 1, 6, 6],
  bug: [24, 8, 6, 6],
};

/**
 * คำนวณที่นั่งแบบ grid ภายใน rect โซน — ห้าม hard-code พิกัดที่นั่งเด็ดขาด (spec §7.2)
 *
 * `count` ใช้เมื่อจำนวนที่นั่งไม่เต็ม cols×rows (เช่น 3 ที่นั่งในกริด 2×2 ของโซน stopped/bug):
 * แถวสุดท้ายที่ไม่เต็มจะถูก **จัดกึ่งกลางโซน** ไม่ใช่ชิดซ้าย — แถวที่มีที่นั่งเดียวจึงได้พิกัดกลาง rect พอดี
 * @param {[number,number,number,number]} rect
 * @param {number} cols
 * @param {number} rows
 * @param {{padX?:number, padTop?:number, padBottom?:number, dir?:string, count?:number}} [opts]
 * @returns {{x:number,y:number,dir:string}[]}
 */
export function gridSlots(rect, cols, rows, opts = {}) {
  const [rx, ry, rw, rh] = rect;
  const padX = opts.padX ?? 1.3;
  const padTop = opts.padTop ?? 1.9;
  const padBottom = opts.padBottom ?? 0.8;
  const usableW = rw - padX * 2;
  const usableH = rh - padTop - padBottom;
  const limit = opts.count ?? cols * rows;
  const slots = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, limit - slots.length);
    if (inRow <= 0) break;
    for (let c = 0; c < inRow; c++) {
      const x = rx + padX + (inRow === 1 ? usableW / 2 : (usableW * c) / (inRow - 1));
      const y = ry + padTop + (rows === 1 ? usableH / 2 : (usableH * r) / (rows - 1));
      slots.push({ x, y, dir: opts.dir || "down" });
    }
  }
  return slots;
}

/**
 * คำนวณที่นั่งเป็นวงกลม (ใช้กับโต๊ะประชุมโซน Approval)
 * @returns {{x:number,y:number,dir:string}[]}
 */
export function radialSlots(cx, cy, radius, count, phaseDeg = 45) {
  const slots = [];
  for (let i = 0; i < count; i++) {
    const ang = ((phaseDeg + (i * 360) / count) * Math.PI) / 180;
    const x = cx + radius * Math.cos(ang);
    const y = cy + radius * Math.sin(ang) * 0.62; // แบนแนวตั้งให้ดูเป็นโต๊ะประชุมจากมุมมองเฉียงบน
    slots.push({ x, y, dir: angleToDir(ang + Math.PI) });
  }
  return slots;
}

/** แปลงมุม (เรเดียน) เป็นทิศที่ตัวละครควรหันหน้า (เข้าหาจุดศูนย์กลาง) */
export function angleToDir(rad) {
  const deg = ((rad * 180) / Math.PI + 360) % 360;
  if (deg >= 45 && deg < 135) return "down";
  if (deg >= 135 && deg < 225) return "left";
  if (deg >= 225 && deg < 315) return "up";
  return "right";
}

/**
 * ประกอบ ZONE_DEFS ฉบับเต็ม (rect + slots + prop ตำแหน่งพิเศษของแต่ละโซน)
 * @param {Partial<Record<string,[number,number,number,number]>>} [rectOverrides]
 *   ใช้ค่าจาก object layer `zones` ของ map.json แทนค่าเริ่มต้นเมื่อมี (ต่อโซน)
 */
export function buildZones(rectOverrides = {}) {
  const zones = {};
  for (const id of ZONE_IDS) {
    const rect = rectOverrides[id] || DEFAULT_ZONE_RECTS[id];
    zones[id] = { id, rect, ...ZONE_LABELS[id] };
  }

  // ---- ระยะห่างของที่นั่งถูกเลือกจาก "กล่องป้ายขนาดตายตัว" ไม่ใช่จากความสวยอย่างเดียว ----
  // กติกา: กล่องป้ายของทุกที่นั่งต้องอยู่ในกรอบโซนของตัวเอง (ดู labelFitReport) ⇒ ระยะขั้นต่ำคือ
  //   แนวนอน  ที่นั่งต้องห่างขอบโซนอย่างน้อยครึ่งความกว้างป้าย (CHAR_LABEL_W_TILES / 2 = 1.375 tile)
  //   แนวตั้ง  แถวล่างสุดต้องเหลือที่ใต้เท้าอย่างน้อย CHAR_LABEL_TOP_OFFSET + CHAR_LABEL_H (33px ≈ 1.03 tile)
  //            และแถวบนสุดต้องต่ำกว่าแถบหัวโซน (zoneHeaderHeight)
  // นี่คือเหตุผลที่ padX = 1.5 ทุกโซนกริด และ padBottom ≥ 1.2 — ห้ามลดลงโดยไม่รัน layout.test.js
  const GRID = { padX: 1.5, padBottom: 1.2, dir: "down" };
  zones.lounge.slots = gridSlots(zones.lounge.rect, 2, 2, { ...GRID, padTop: 1.9 });
  // stopped/bug: 3 ที่นั่งเท่าเดิม แต่เป็นทรงพีระมิด 2+1 แทน 3 ที่เรียงแถวเดียว — สามคอลัมน์ใน 6 tile
  // ทำให้ระยะห่างเหลือ 1.7 tile ซึ่งแคบกว่าความกว้างป้าย ป้ายจึงชนกันแน่นอนไม่ว่าจะบีบข้อความแค่ไหน
  zones.stopped.slots = gridSlots(zones.stopped.rect, 2, 2, { ...GRID, padTop: 2.4, count: 3 });
  zones.bug.slots = gridSlots(zones.bug.rect, 2, 2, { ...GRID, padTop: 2.4, count: 3 });
  // desks: แถวอยู่ใต้แถวโต๊ะจริงของ map.json (โต๊ะ row 2/7/12, เก้าอี้ row 3/8/13) — 3.2 / 8.0 / 12.8
  zones.desks.slots = gridSlots(zones.desks.rect, 2, 3, { ...GRID, padTop: 2.2 });

  {
    const [ax, ay, aw, ah] = zones.approval.rect;
    const center = { x: ax + aw / 2, y: ay + ah / 2 };
    zones.approval.center = center;
    zones.approval.slots = radialSlots(center.x, center.y, 3.1, 4, 45);
  }

  {
    const [bx, by] = zones.browser.rect;
    zones.browser.holderSlot = { x: bx + 2.6, y: by + 2, dir: "right" };
    // ---- ทำไมคิวเหลือ "แถวเดียว 2 ช่อง" (#20) ----
    // หนึ่งแถวกินพื้นที่แนวตั้ง = ตัวละคร 64px + กล่องป้าย 29px ≈ 93px แต่โซนนี้สูง 6 tile และเสียให้
    // แถบหัวโซน (zoneHeaderHeight = 40px) ไป ⇒ เหลือใช้จริง ~150px ที่ tilePx ต่ำสุด = **สองแถว**
    // ผังเดิม (ผู้ถือ + คิว 2×2 = สามแถว) จึงเอาป้ายแถวบนไปบังหัว/ตัวของแถวล่างเต็ม ๆ ทั้งความกว้าง
    // ตอนนี้เหลือผู้ถือแถวบน + คิวแถวล่างสุดที่ยังผ่าน containment ⇒ ป้ายผู้ถือเฉี่ยวหัวคิวแค่ไม่กี่ px
    // ตรงช่วงที่มันซ้อนกันตามแนวนอนเท่านั้น · คิวที่ยาวกว่านี้บอกเป็น `+n` ที่หัวโซนเหมือนโซนอื่น
    // (ลำดับคิว/เส้นตายของตัวที่ไม่ได้ยืนอยู่ ดูได้จากการคลิกชิป +n — spec §7.5)
    // ห้ามเพิ่มแถวกลับเข้ามาโดยไม่รัน layout.test.js: ระยะ 2.85 tile ระหว่างสองแถวคือค่าที่กว้างที่สุด
    // ที่เป็นไปได้แล้ว (แถวล่างขยับลงอีกไม่ได้ ป้ายจะล้นก้นโซนที่ tilePx 32)
    zones.browser.waiterSlots = [
      { x: bx + 1.5, y: by + 4.85, dir: "up" },
      { x: bx + 4.5, y: by + 4.85, dir: "up" },
    ];
    // browser zone ไม่มี "slots" ทั่วไป (assignSlots ใช้ holderSlot/waiterSlots แทน)
    zones.browser.slots = [zones.browser.holderSlot, ...zones.browser.waiterSlots];
  }

  return zones;
}

/**
 * แปลง slot (พิกัด tile) เป็นพิกัด px กลางเวิลด์สำหรับวาด/glide
 * @param {{x:number,y:number}} slot
 * @param {number} [tilePx] px ต่อ tile ที่ใช้จริงตอนรัน (ค่าเริ่มต้น TILE — ห้าม assume ในโค้ดที่วาด)
 */
export function worldPos(slot, tilePx = TILE) {
  return { x: slot.x * tilePx, y: slot.y * tilePx };
}

// ---------------------------------------------------------------------------
// เลือก px ต่อ tile จากพื้นที่ที่มีจริงบนจอ — pure ล้วน (main.js เป็นคนวัดกล่องแล้วส่งตัวเลขเข้ามา)
//
// หลักการ: ห้องขยายด้วยการ **วาดใหญ่ขึ้น** ไม่ใช่ยืดภาพ — CSS ยืด canvas 1024px ให้เต็มจอเมื่อไร
// ตัวหนังสือไทยเบลอทันที (สระบน/ล่างเละก่อนใคร) เพิ่ม tilePx แล้ววาดใหม่ที่ความละเอียดจริงเท่านั้น
// ---------------------------------------------------------------------------

/** px ต่อ tile ต่ำสุดที่ยอมให้ห้องหดลงไป
 *
 *  กล่องป้าย (CHAR_LABEL_H / CHAR_LABEL_TOP_OFFSET / ZONE_LABEL_INSET / zoneHeaderHeight) มีหน่วยเป็น
 *  px ตายตัว **ไม่หดตาม tile** ⇒ ยิ่ง tilePx เล็ก ป้ายยิ่งกินสัดส่วนโซนมากขึ้นจนล้นในที่สุด
 *  (แถวล่างของคิว Browser คือจุดที่ตึงที่สุด: 5.85t + 4 + 29 ≤ 7t − 2 ⇒ t ≥ 30.4)
 *  เทสต์ containment จึงการันตีไว้ที่ ≥32 เท่านั้น — จอที่แคบกว่านี้ให้ **เลื่อนดู** แทนการย่อจนป้ายพัง */
export const MIN_TILE_PX = TILE;

/** สัดส่วนขั้นต่ำที่ tilePx แบบ "ทวีคูณของ tile ต้นฉบับ" ต้องทำได้ ถึงจะยอมเสียพื้นที่เพื่อความคม
 *  วัดเป็น **ความยาวด้าน** (tilePx ต่อ tilePx) ไม่ใช่พื้นที่ — ดูเหตุผลใน chooseTilePx() */
export const CRISP_TILE_RATIO = 0.88;

/**
 * px ต่อ tile ที่ควรใช้กับพื้นที่ว่างขนาด availW × availH (px ของ CSS หลังหักหัวข้อ/แผงข้าง/ขอบแล้ว)
 *
 * เกณฑ์ (ตามที่เจ้าของโปรเจกต์ขอ):
 *  1. ค่าที่ใหญ่ที่สุดที่ห้องยังใส่ได้ทั้งใบคือ `fit = min(availW/cols, availH/rows)`
 *  2. **ทวีคูณของขนาด tile ต้นฉบับ** (32 สำหรับชุด asset ที่ ship จริง) ทำให้พิกเซลอาร์ตคมสนิท เพราะ
 *     ทุกพิกเซลต้นฉบับถูกขยายเป็นจำนวนเต็มเท่ากันหมด — ค่าที่ไม่ใช่ทวีคูณ (เช่น 46) พิกเซลจะขนาด
 *     ไม่เท่ากันเล็กน้อย เห็นได้แต่ยอมรับได้
 *  3. จึงใช้ทวีคูณนั้น **ถ้ามันยังกินพื้นที่ได้ ≥ 88% ของที่มี** ไม่งั้นยอมพิกเซลไม่เท่ากันแล้วใช้
 *     integer ที่ใหญ่สุดที่ยังใส่ได้ (การเหลือขอบดำครึ่งจอเพื่อความคมไม่คุ้ม)
 *  4. ไม่ต่ำกว่า MIN_TILE_PX เด็ดขาด — จอเล็กเกินไปให้ห้องล้นแล้วเลื่อนดูแทน (ดูเหตุผลที่ MIN_TILE_PX)
 *
 * 88% วัดเป็น **ความยาวด้าน** ไม่ใช่พื้นที่โดยตั้งใจ: ถ้าวัดเป็นพื้นที่ ทวีคูณต้องได้ ≥93.8% ของด้าน
 * ซึ่งแทบไม่มีวันเกิดกับจอจริง (สาขานี้จะกลายเป็นโค้ดตาย) และจะพลาดเคสสำคัญที่สุดคือจอ 2560×1440
 * ที่ได้ 64px = ขยาย 2 เท่าพอดี
 *
 * @param {{availW:number, availH:number, cols?:number, rows?:number, baseTilePx?:number}} args
 *   `baseTilePx` = ขนาด tile ต้นฉบับบนจอจาก manifest (tileSize × scale) — ห้าม assume 32 (spec §8.2)
 * @returns {number} จำนวนเต็มเสมอ (ครึ่งพิกเซลทำให้รอยต่อ tile เป็นเส้นบาง ๆ)
 */
export function chooseTilePx({ availW, availH, cols = ROOM.cols, rows = ROOM.rows, baseTilePx = TILE }) {
  const base = Math.floor(Number(baseTilePx)) > 0 ? Math.floor(Number(baseTilePx)) : TILE;
  const c = Number(cols) > 0 ? Number(cols) : ROOM.cols;
  const r = Number(rows) > 0 ? Number(rows) : ROOM.rows;
  // ห้องเล็กกว่าขนาดต้นฉบับ = ย่อภาพพิกเซลลง ซึ่งพังยิ่งกว่าห้องล้นจอ ⇒ พื้นล่างคือ max(32, ต้นฉบับ)
  const floorPx = Math.max(MIN_TILE_PX, base);
  const fit = Math.min(Number(availW) / c, Number(availH) / r);
  if (!Number.isFinite(fit) || fit <= 0) return floorPx;

  const largest = Math.floor(fit); // ค่า integer ที่ใหญ่สุดที่ยังใส่ได้ทั้งห้อง
  const crisp = Math.floor(fit / base) * base; // ทวีคูณของ tile ต้นฉบับที่ใหญ่สุดที่ยังใส่ได้
  const useCrisp = crisp >= floorPx && crisp >= fit * CRISP_TILE_RATIO;
  return Math.max(floorPx, useCrisp ? crisp : largest);
}

// ---------------------------------------------------------------------------
// อ่าน map.json (Tiled JSON subset ตาม spec §8.2) — pure ล้วน ไม่แตะ network/DOM
// ฟังก์ชันพวกนี้รับ object ที่ parse แล้วเข้ามา (assets.js เป็นคนไป fetch) จะได้เทสต์ได้ตรง ๆ
// ---------------------------------------------------------------------------

/**
 * rect ของโซนจาก object layer ชื่อ `zones` — พิกัดในไฟล์เป็น **px** (มาตรฐาน Tiled) หารด้วย
 * tilewidth/tileheight ของ map ให้เป็นหน่วย tile ตามที่ buildZones() ต้องการ
 * ข้าม object ที่ชื่อไม่ใช่ zone id ที่รู้จัก และข้าม object ที่กว้าง/สูงเป็น 0 (point object)
 * @param {any} map map.json ที่ parse แล้ว
 * @returns {Record<string,[number,number,number,number]>} ใส่เฉพาะโซนที่เจอจริง (ที่เหลือใช้ค่า default)
 */
export function zoneRectsFromMap(map) {
  /** @type {Record<string,[number,number,number,number]>} */
  const rects = {};
  if (!map || !Array.isArray(map.layers)) return rects;
  const tw = Number(map.tilewidth);
  const th = Number(map.tileheight);
  if (!(tw > 0) || !(th > 0)) return rects;
  const layer = map.layers.find((l) => l && l.type === "objectgroup" && l.name === "zones");
  if (!layer || !Array.isArray(layer.objects)) return rects;
  for (const obj of layer.objects) {
    if (!obj || !ZONE_IDS.includes(obj.name)) continue;
    const w = Number(obj.width) / tw;
    const h = Number(obj.height) / th;
    if (!(w > 0) || !(h > 0)) continue;
    rects[obj.name] = [Number(obj.x) / tw, Number(obj.y) / th, w, h];
  }
  return rects;
}

/** ขนาดห้องเป็น tile จาก map.json — ไม่มี/พัง → ค่าเริ่มต้น ROOM (32x16) */
export function roomSizeFromMap(map) {
  const cols = Number(map?.width);
  const rows = Number(map?.height);
  if (cols > 0 && rows > 0) return { cols: Math.floor(cols), rows: Math.floor(rows) };
  return { ...ROOM };
}

/** tile layer ทั้งหมดของ map ตามลำดับในไฟล์ (floor → walls → props) — layer อื่นถูกข้าม */
export function tileLayersOf(map) {
  if (!map || !Array.isArray(map.layers)) return [];
  return map.layers.filter(
    (l) => l && l.type === "tilelayer" && l.visible !== false && Array.isArray(l.data),
  );
}

// ---------------------------------------------------------------------------
// เรขาคณิตของป้าย (spec §7.2) — pure ล้วน หน่วยเป็น px บนเวิลด์ (ก่อนคูณ dpr)
//
// เกณฑ์เดียวที่ตัดสินว่าป้ายวางถูกคือ **containment**: กล่องป้ายทุกใบต้องอยู่ในกรอบโซนของตัวเอง
// เพราะโซนไม่ซ้อนกัน (findOverlappingZones) containment จึงพิสูจน์ "ป้ายข้ามโซนไม่ได้" ให้ฟรี
// และเมื่อบวกกับที่นั่งที่ห่างกันพอ (buildZones) ก็ได้ "ป้ายไม่ทับกัน" เป็นผลพลอยได้อีกที
//
// ประวัติ: รอบก่อนใช้เกณฑ์ "ป้ายห้ามทับกัน" แล้วแก้ด้วยการดันป้ายที่ชนลงทีละแถว ผลคือได้ 0 คู่ที่ทับกัน
// จริง แต่ป้ายเดินออกนอกโซนตัวเองเป็นบันไดทแยงกินครึ่งจอ — เกณฑ์นั้นถูกถอดออกทั้งกลไกและเทสต์แล้ว
// ---------------------------------------------------------------------------

/** กรอบสี่เหลี่ยมสองอันชนกันไหม เผื่อช่องว่างขั้นต่ำ `gap` px รอบด้าน */
export function boxesOverlap(a, b, gap = 0) {
  return a.x1 - gap < b.x2 && a.x2 + gap > b.x1 && a.y1 - gap < b.y2 && a.y2 + gap > b.y1;
}

/** `inner` อยู่ในกรอบ `outer` ครบทุกด้านไหม (ขอบชนขอบพอดีถือว่าอยู่ข้างใน) */
export function boxInside(inner, outer) {
  return inner.x1 >= outer.x1 && inner.x2 <= outer.x2 && inner.y1 >= outer.y1 && inner.y2 <= outer.y2;
}

/** ระยะบรรทัด + ความสูงแผ่นรองของป้ายหนึ่งบรรทัด (px) — ผูกกับขนาดฟอนต์ จึงเป็น px ตายตัวไม่ใช่ tile */
export const LABEL_LINE_H = 14;
export const LABEL_PLATE_H = 15;
export const LABEL_PLATE_PAD_X = 5;
/** ป้ายชื่อตัวละครเป็นสองบรรทัดเสมอ (บรรทัด 1 = ชื่อ, บรรทัด 2 = นาฬิกา + headline) ⇒ สูงคงที่ */
export const CHAR_LABEL_H = LABEL_LINE_H + LABEL_PLATE_H;
/**
 * ความกว้างกล่องป้ายชื่อตัวละคร — **ตายตัว** เป็นสัดส่วนของ tile ไม่ยืดตามความยาวชื่อ
 * (ชื่อยาวถูกตัดด้วย … ชื่อเต็มดูได้จากการ์ดข้อมูลตอนคลิก — spec §7.5)
 * 2.75 tile = 88px ที่ชุด asset จริง ซึ่งพอดี 2 คอลัมน์ในโซนกว้าง 6 tile โดยยังเหลือช่องว่างระหว่างกัน
 */
export const CHAR_LABEL_W_TILES = 2.75;
/** ขอบบนของกล่องป้าย = จุดเท้าตัวละคร + ระยะนี้ */
export const CHAR_LABEL_TOP_OFFSET = 4;
/** ระยะร่นเข้ามาจากขอบโซน ที่ป้ายห้ามล้ำออกไป */
export const ZONE_LABEL_INSET = 2;
/** baseline ของป้ายหัวโซน วัดจากขอบบนโซน (โซน Approval ใช้ตัวใหญ่กว่า จึงต่ำลงมาอีกนิด) */
export const ZONE_HEADER_BASELINE = 16;
export const ZONE_HEADER_BASELINE_TALL = 20;

/**
 * ความสูงของ "แถบหัวโซน" (px จากขอบบนโซน) ที่ป้ายชื่อตัวละครห้ามเข้าไป
 * — approval มีหัวโซนสองบรรทัด, browser มีหมายเหตุ FIFO ต่อท้ายหัวโซนอีกบรรทัด
 */
export function zoneHeaderHeight(zoneId) {
  return zoneId === "approval" || zoneId === "browser" ? 40 : 22;
}

/** กรอบโซนเป็น px */
export function zoneRectPx(rect, tilePx = TILE) {
  const [rx, ry, rw, rh] = rect;
  return { x1: rx * tilePx, y1: ry * tilePx, x2: (rx + rw) * tilePx, y2: (ry + rh) * tilePx };
}

/** พื้นที่ที่ป้ายชื่อ "ตัวละคร" ต้องอยู่ข้างใน = กรอบโซน หักแถบหัวโซนด้านบน และร่นขอบเล็กน้อย */
export function zoneLabelArea(zone, tilePx = TILE) {
  const r = zoneRectPx(zone.rect, tilePx);
  return {
    x1: r.x1 + ZONE_LABEL_INSET,
    y1: r.y1 + zoneHeaderHeight(zone.id),
    x2: r.x2 - ZONE_LABEL_INSET,
    y2: r.y2 - ZONE_LABEL_INSET,
  };
}

/**
 * กล่องป้ายชื่อของตัวละครที่ยืนอยู่ที่ (footX, footY) — ขนาดตายตัวเสมอ ไม่ขึ้นกับข้อความ/ฟอนต์
 * นี่คือกล่องเดียวกับที่ render.js วาดแผ่นรอง และเดียวกับที่ layout.test.js ตรวจ containment
 */
export function characterLabelBox(footX, footY, tilePx = TILE) {
  const half = (CHAR_LABEL_W_TILES * tilePx) / 2;
  const top = footY + CHAR_LABEL_TOP_OFFSET;
  return { x1: footX - half, y1: top, x2: footX + half, y2: top + CHAR_LABEL_H };
}

/** กล่องป้ายของ "ที่นั่ง" (พิกัด tile) — wrapper ของ characterLabelBox ให้เทสต์/self-check อ่านง่าย */
export function slotLabelBox(slot, tilePx = TILE) {
  return characterLabelBox(slot.x * tilePx, slot.y * tilePx, tilePx);
}

/**
 * **เลื่อน** (ไม่ย่อ ไม่ยืด) กล่องให้กลับเข้ามาในกรอบ `bounds`
 *
 * ใช้กับป้ายของตัวละครที่กำลัง **เดินเข้า/ออกทางประตู** เท่านั้น — ตอนนั้นตัวละครอยู่นอกทุกโซน จึงไม่มี
 * โซนไหนการันตีให้ และประตูอยู่ติดผนังล่างพอดี (DOOR_SLOT y = rows - 0.6) ป้ายจึงตกใต้ขอบ canvas
 * ทั้งใบ นาฬิกาหายไปเลยตลอดช่วงเดิน (~1 วินาที)
 *
 * **นี่ไม่ใช่กลไกที่ทำให้ containment ผ่าน** — ป้ายของที่นั่งทุกที่อยู่ในโซนตั้งแต่แรกอยู่แล้ว การ clamp
 * จึงต้องเป็น no-op กับทุกที่นั่ง (layout.test.js ยืนยันข้อนี้ไว้ ไม่งั้นตาข่าย containment จะกลายเป็นของปลอม)
 */
export function clampBoxInto(box, bounds) {
  const w = box.x2 - box.x1;
  const h = box.y2 - box.y1;
  const x1 = Math.min(Math.max(box.x1, bounds.x1), Math.max(bounds.x1, bounds.x2 - w));
  const y1 = Math.min(Math.max(box.y1, bounds.y1), Math.max(bounds.y1, bounds.y2 - h));
  return { x1, y1, x2: x1 + w, y2: y1 + h };
}

/** แผ่นป้ายที่จัดกึ่งกลางแนวนอนที่ cx โดยมีขอบบนที่ top — `w` คือ "ความกว้างสูงสุด" ที่ render จะไม่เกิน */
function plate(cx, top, w, h) {
  return { cx, top, w, h, x1: cx - w / 2, y1: top, x2: cx + w / 2, y2: top + h };
}

/**
 * ป้ายทุกใบที่อยู่ตำแหน่ง "ตายตัว" ของห้อง (หัวโซน / หมายเหตุ FIFO / ป้ายผู้ถือ Browser / Schedule auto-pause)
 * — render.js วาดจากค่าชุดนี้ที่เดียว และ layout.test.js ตรวจ containment จากชุดเดียวกัน
 * ทุกอันประกาศ "ความกว้างสูงสุด" ไว้ แล้ว render ตัดข้อความให้ไม่เกิน ⇒ กล่องที่วาดจริง ⊆ กล่องที่ตรวจเสมอ
 * @param {ReturnType<typeof buildZones>} zones
 * @param {number} tilePx
 * @param {number} [autoPausedCount] จำนวน marker ของ Schedule ที่ auto-pause (0 = ไม่มีป้ายนี้)
 */
export function fixedLabels(zones, tilePx = TILE, autoPausedCount = 0) {
  const out = { zoneHeader: {}, browserNote: null, browserHolder: null, autoPause: null };

  for (const id of ZONE_IDS) {
    const zone = zones[id];
    if (!zone) continue;
    const r = zoneRectPx(zone.rect, tilePx);
    const tall = id === "approval";
    const lines = tall ? 2 : 1;
    out.zoneHeader[id] = {
      ...plate(
        (r.x1 + r.x2) / 2,
        r.y1 + (tall ? ZONE_HEADER_BASELINE_TALL : ZONE_HEADER_BASELINE) - 12,
        Math.max(0, r.x2 - r.x1 - ZONE_LABEL_INSET * 2),
        (lines - 1) * LABEL_LINE_H + LABEL_PLATE_H,
      ),
      lines,
      zoneId: id,
    };
  }

  if (zones.browser) {
    const r = zoneRectPx(zones.browser.rect, tilePx);
    const maxW = Math.max(0, r.x2 - r.x1 - ZONE_LABEL_INSET * 2);
    // หมายเหตุ FIFO อยู่ "ใต้หัวโซน" ไม่ใช่ก้นโซน — ก้นโซนคือแถวคิวแถวสุดท้าย ถ้าวางไว้ที่นั่นจะทับกัน
    out.browserNote = { ...plate((r.x1 + r.x2) / 2, r.y1 + ZONE_HEADER_BASELINE + 18 - 12, maxW, LABEL_PLATE_H), zoneId: "browser" };
    // ป้ายผู้ถือ Browser ตอนตัวถือไปยืนโซน Approval (P2 > P3) — วางที่แถวเดียวกับป้ายของที่นั่งผู้ถือ
    // แต่กว้างเต็มโซน เพราะข้อความมีคำนำ/ต่อท้าย ("🌐 ชื่อ (ถือ Browser)")
    const holderTop = zones.browser.holderSlot.y * tilePx + CHAR_LABEL_TOP_OFFSET;
    out.browserHolder = { ...plate((r.x1 + r.x2) / 2, holderTop, maxW, LABEL_PLATE_H), zoneId: "browser" };
  }

  if (zones.bug && autoPausedCount > 0) {
    const [bx, by, bw] = zones.bug.rect;
    // marker วางเป็นกลุ่มกึ่งกลางโซน และบีบระยะห่างลงเมื่อมีหลายอัน เพื่อไม่ให้กลุ่มล้นออกนอกโซน
    const spacing = Math.min(1.7, (bw - 1) / Math.max(1, autoPausedCount - 1));
    const markers = [];
    for (let i = 0; i < autoPausedCount; i++) {
      markers.push({
        cx: (bx + bw / 2 + (i - (autoPausedCount - 1) / 2) * spacing) * tilePx,
        cy: (by + 1.0) * tilePx,
        r: 12,
      });
    }
    const r = zoneRectPx(zones.bug.rect, tilePx);
    out.autoPause = {
      markers,
      plate: {
        ...plate((r.x1 + r.x2) / 2, (by + 1.85) * tilePx - 12, Math.max(0, r.x2 - r.x1 - ZONE_LABEL_INSET * 2), LABEL_PLATE_H),
        zoneId: "bug",
      },
    };
  }

  return out;
}

/**
 * self-check เชิงเรขาคณิตของป้ายทั้งห้อง — คืนลิสต์ "สิ่งที่ผิด" ([] = ผ่านหมด)
 * ใช้ทั้งใน layout.test.js (เป็น assertion หลัก) และตอน bootstrap (เตือนเมื่อ map.json ให้ rect ที่เล็กเกินไป)
 *
 * ตรวจสามข้อ เรียงตามความสำคัญ:
 *  1. `contain`  กล่องป้ายของทุกที่นั่งอยู่ในพื้นที่ป้ายของโซนตัวเอง  ← เกณฑ์หลัก
 *  2. `fixed`    ป้ายตำแหน่งตายตัวทุกใบอยู่ในกรอบโซนของตัวเอง
 *  3. `overlap`  ป้ายในโซนเดียวกันไม่ทับกัน (ผลพลอยได้ ไม่ใช่เป้าหมาย)
 * @returns {{kind:string, zone:string, detail:string}[]}
 */
export function labelFitReport(zones, tilePx = TILE, autoPausedCount = 0) {
  const problems = [];
  const fmt = (b) =>
    `[${b.x1.toFixed(1)},${b.y1.toFixed(1)}]–[${b.x2.toFixed(1)},${b.y2.toFixed(1)}]`;

  for (const id of ZONE_IDS) {
    const zone = zones[id];
    if (!zone || !Array.isArray(zone.slots)) continue;
    const area = zoneLabelArea(zone, tilePx);
    const boxes = zone.slots.map((s) => slotLabelBox(s, tilePx));
    boxes.forEach((box, i) => {
      if (!boxInside(box, area)) {
        problems.push({ kind: "contain", zone: id, detail: `ที่นั่ง ${i}: ป้าย ${fmt(box)} ล้นพื้นที่โซน ${fmt(area)}` });
      }
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxesOverlap(boxes[i], boxes[j])) {
          problems.push({ kind: "overlap", zone: id, detail: `ป้ายที่นั่ง ${i} กับ ${j} ทับกัน` });
        }
      }
    }
  }

  const fixed = fixedLabels(zones, tilePx, autoPausedCount);
  const checkFixed = (name, spec) => {
    if (!spec) return;
    const zone = zones[spec.zoneId];
    if (!zone) return;
    if (!boxInside(spec, zoneRectPx(zone.rect, tilePx))) {
      problems.push({ kind: "fixed", zone: spec.zoneId, detail: `${name}: ${fmt(spec)} ล้นกรอบโซน` });
    }
  };
  for (const [id, spec] of Object.entries(fixed.zoneHeader)) checkFixed(`หัวโซน ${id}`, spec);
  checkFixed("หมายเหตุ FIFO", fixed.browserNote);
  checkFixed("ป้ายผู้ถือ Browser", fixed.browserHolder);
  if (fixed.autoPause) {
    checkFixed("ป้าย Schedule auto-pause", fixed.autoPause.plate);
    const bugRect = zoneRectPx(zones.bug.rect, tilePx);
    fixed.autoPause.markers.forEach((m, i) => {
      const box = { x1: m.cx - m.r, y1: m.cy - m.r, x2: m.cx + m.r, y2: m.cy + m.r };
      if (!boxInside(box, bugRect)) {
        problems.push({ kind: "fixed", zone: "bug", detail: `marker auto-pause ${i}: ${fmt(box)} ล้นกรอบโซน` });
      }
    });
  }
  return problems;
}

/** เรียกจาก main.js ตอน bootstrap — เตือนใน console เฉย ๆ (rect จาก map.json อาจเล็กกว่าที่ป้ายต้องการ) */
export function warnLabelFits(zones, tilePx = TILE) {
  for (const p of labelFitReport(zones, tilePx, 1)) {
    console.warn(`[office-ui] ป้ายไม่พอดีโซน (${p.kind}) ${p.zone}: ${p.detail}`);
  }
}

// ---------------------------------------------------------------------------
// อนิเมชันตัวละคร (spec §7.4) — pure ล้วนเช่นกัน render.js เป็นคนเอาไป drawImage
// ---------------------------------------------------------------------------

/**
 * เลือก "แถว" ของชีตจากเวกเตอร์การเคลื่อนที่ — แกนที่ขยับเยอะกว่าเป็นตัวตัดสิน
 * (จอเป็น y ลง ⇒ dy > 0 คือเดินลง) คืน null เมื่อไม่ได้ขยับเลย เพื่อให้ผู้เรียกคงทิศเดิมไว้
 * @param {number} dx
 * @param {number} dy
 * @param {string[]} [directions] ลำดับแถวจาก manifest.character.directions
 * @returns {string|null}
 */
export function directionFromVector(dx, dy, directions = DEFAULT_DIRECTIONS) {
  if (!dx && !dy) return null;
  const list = Array.isArray(directions) && directions.length ? directions : DEFAULT_DIRECTIONS;
  const wanted = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  return list.includes(wanted) ? wanted : list[0];
}

/**
 * เฟรมที่ควรวาด ณ เวลาที่ผ่านไป `elapsedMs` ของอนิเมชันที่มี `frames` เฟรมเล่นที่ `fps`
 * — วนลูปเสมอ และคืน 0 อย่างปลอดภัยเมื่อ manifest ไม่ได้บอก frames/fps มา (ห้าม assume — spec §8.2)
 */
export function animationFrameIndex(elapsedMs, frames, fps) {
  const count = Math.floor(Number(frames));
  const rate = Number(fps);
  if (!(count > 1) || !(rate > 0) || !Number.isFinite(elapsedMs)) return 0;
  return Math.floor((Math.max(0, elapsedMs) * rate) / 1000) % count;
}

/** self-check ตอน dev: คืนคู่โซนที่ rect ซ้อนทับกัน ([] = ไม่ซ้อน) */
export function findOverlappingZones(zones) {
  const ids = Object.keys(zones);
  const overlaps = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [ax, ay, aw, ah] = zones[ids[i]].rect;
      const [bx, by, bw, bh] = zones[ids[j]].rect;
      const overlap = ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
      if (overlap) overlaps.push([ids[i], ids[j]]);
    }
  }
  return overlaps;
}

/** เรียกจาก main.js ตอน bootstrap — เตือนใน console เฉย ๆ ไม่ throw (self-check ตอน dev) */
export function warnZoneOverlaps(zones) {
  for (const [a, b] of findOverlappingZones(zones)) {
    console.warn(`[office-ui] zone ซ้อนกัน: ${a} กับ ${b}`);
  }
}

/** true เมื่อ id นี้คือผู้ถือหรืออยู่ในคิว Browser (แหล่งความจริงเดียว = browserQueue) */
function isOnBrowser(id, browserQueue) {
  if (!browserQueue) return false;
  if (browserQueue.holder === id) return true;
  return (browserQueue.waiting || []).some((w) => w.id === id);
}

/**
 * derive โซน/บทบาทของตัวละครหนึ่งตัว — ตรงกับ spec §7.3 (โครงเงื่อนไข P1–P9 ทุกตัวอักษร)
 * บวก `deadlineAt` แนบมากับผู้รอคิว (P4) ที่ดึงจาก `browserQueue.waiting[].deadlineAt` เท่านั้น
 * (ไม่ใช่ `char.deadlineAt` ที่ต้องเป็น null เสมอสำหรับเคสนี้ตาม spec §4.1 ข้อ 2) — จำเป็นสำหรับให้
 * นาฬิกาถอยหลังของ Run ที่รอคิว Browser ทำงานได้ตาม §5.6 โดยยังคงกติกา "แหล่งเดียว" ของ browserQueue
 * ลำดับตรงกับ precedence P1–P9 ของ §5.2: โซน browser derive จาก browserQueue แหล่งเดียว
 * ไม่ใช่จาก char.state (กัน state สองที่ drift กัน)
 * @param {{id:string,state:string}} char
 * @param {{holder:string|null, waiting:{id:string, deadlineAt?:number|null}[]}} browserQueue
 */
export function zoneAndRoleFor(char, browserQueue) {
  if (char.state === "stopped") return { zone: "stopped" }; // P1 / P7
  if (char.state === "approval") {
    return { zone: "approval", browserBadge: isOnBrowser(char.id, browserQueue) }; // P2
  }
  if (browserQueue.holder === char.id) return { zone: "browser", role: "holder" }; // P3
  const i = browserQueue.waiting.findIndex((w) => w.id === char.id);
  if (i !== -1) {
    // deadlineAt มาจาก browserQueue.waiting[].deadlineAt เท่านั้น (แหล่งเดียวตาม spec §4.1 ข้อ 2) —
    // char.deadlineAt ต้องเป็น null เสมอสำหรับตัวละครที่รอคิว Browser (ทั้ง Task และ Run) ห้ามอ่านจากที่นั่น
    return { zone: "browser", role: "waiter", queuePos: i + 1, deadlineAt: browserQueue.waiting[i].deadlineAt ?? null }; // P4
  }
  if (char.state === "working") return { zone: "desks" }; // P5 / P6
  if (char.state === "failed") return { zone: "bug" }; // P8
  return { zone: "lounge" }; // P9 (idle และอื่น ๆ ที่ไม่เข้าเงื่อนไขไหน)
}

/**
 * FNV-1a 32-bit — deterministic hash ล้วน (id เดิม → ค่าเดิมทุกครั้ง ทุกเครื่อง ทุก session)
 * ใช้เลือกโฟลเดอร์สไปรต์ของตัวละครแบบผูกกับ id ถาวร (spec §5.1)
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
export function fnv1aHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** เลือก index โฟลเดอร์ตัวละคร (0..folderCount-1) จาก id แบบ deterministic */
export function pickCharacterFolder(id, folderCount) {
  if (!folderCount || folderCount <= 0) return 0;
  return fnv1aHash(id) % folderCount;
}
