// office/app/layout.js
//
// เรขาคณิตของห้อง + การ derive โซนจากสถานะ — โมดูลนี้ "pure" ล้วน (ไม่แตะ DOM/canvas/เวลาจริง)
// เพื่อให้รันเทสต์ด้วย tsx ตรง ๆ ได้ (ดู layout.test.js) และพอร์ตไปที่อื่นได้ง่าย
//
// อ้างอิงตาราง zone rect และกติกา derive จาก spec §7.2 / §7.3 (marketing-bro issue #20)

"use strict";

/** px ต่อ tile ของห้อง (ตรงกับ manifest.room.tileSize ค่าเริ่มต้น) */
export const TILE = 32;
/** px ต่อเฟรมสไปรต์ตัวละคร (ตรงกับ manifest.character.frameSize ค่าเริ่มต้น) */
export const FRAME = 64;
/** จุดเท้าของตัวละครภายในเฟรม (ตรงกับ manifest.character.anchor ค่าเริ่มต้น) */
export const ANCHOR = { x: 32, y: 62 };
/** ขนาดห้องเป็น tile — 32 คอลัมน์ x 16 แถว = canvas 1024x512px */
export const ROOM = { cols: 32, rows: 16 };
/** จุด "ประตู" ที่ตัวละครเดินเข้า/ออกตอนเกิด/หาย (กึ่งกลางผนังล่างของห้อง) */
export const DOOR_SLOT = { x: 16, y: 15.4, dir: "up" };

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
 * @param {[number,number,number,number]} rect
 * @param {number} cols
 * @param {number} rows
 * @param {{padX?:number, padTop?:number, padBottom?:number, dir?:string}} [opts]
 * @returns {{x:number,y:number,dir:string}[]}
 */
export function gridSlots(rect, cols, rows, opts = {}) {
  const [rx, ry, rw, rh] = rect;
  const padX = opts.padX ?? 1.3;
  const padTop = opts.padTop ?? 1.9;
  const padBottom = opts.padBottom ?? 0.8;
  const usableW = rw - padX * 2;
  const usableH = rh - padTop - padBottom;
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = rx + padX + (cols === 1 ? usableW / 2 : (usableW * c) / (cols - 1));
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

  zones.lounge.slots = gridSlots(zones.lounge.rect, 2, 2, { dir: "down" });
  zones.stopped.slots = gridSlots(zones.stopped.rect, 3, 1, { dir: "down", padTop: 2.4 });
  zones.desks.slots = gridSlots(zones.desks.rect, 2, 3, { dir: "down", padTop: 2.2 });
  zones.bug.slots = gridSlots(zones.bug.rect, 3, 1, { dir: "down", padTop: 2.4 });

  {
    const [ax, ay, aw, ah] = zones.approval.rect;
    const center = { x: ax + aw / 2, y: ay + ah / 2 };
    zones.approval.center = center;
    zones.approval.slots = radialSlots(center.x, center.y, 3.1, 4, 45);
  }

  {
    const [bx, by] = zones.browser.rect;
    zones.browser.holderSlot = { x: bx + 2.6, y: by + 2, dir: "right" };
    zones.browser.waiterSlots = [
      { x: bx + 1.6, y: by + 4.0, dir: "up" },
      { x: bx + 3.4, y: by + 4.0, dir: "up" },
      { x: bx + 1.6, y: by + 5.6, dir: "up" },
      { x: bx + 3.4, y: by + 5.6, dir: "up" },
    ];
    // browser zone ไม่มี "slots" ทั่วไป (assignSlots ใช้ holderSlot/waiterSlots แทน)
    zones.browser.slots = [zones.browser.holderSlot, ...zones.browser.waiterSlots];
  }

  return zones;
}

/** แปลง slot (พิกัด tile) เป็นพิกัด px กลางเวิลด์สำหรับวาด/glide */
export function worldPos(slot) {
  return { x: slot.x * TILE, y: slot.y * TILE };
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
