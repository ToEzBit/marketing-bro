// office/app/state.js
//
// applySnapshot() + position cache — จุดเดียวที่แตะ "state ทั้งหมด" ของห้อง (spec §7.4)
// pure ล้วนในแง่ไม่แตะ DOM/canvas — รับ `now` เป็นพารามิเตอร์เสมอ (ไม่อ่าน Date.now()/performance.now()
// เองข้างใน) เพื่อให้เทสต์กำหนดเวลาแบบ deterministic ได้ (ดู state.test.js)
//
// หลักการสำคัญที่ทดสอบไว้ (spec §7.4):
//  - เปลี่ยนโซนกลาง glide → เริ่ม glide ใหม่จากตำแหน่งปัจจุบันบนจอเสมอ (กันกระตุก)
//  - id หายจาก snapshot กลาง glide → แช่แข็ง meta ไว้จนกว่าจะจางหายจริง
//  - เกิด/หาย ใช้อนิเมชันเดียวกัน: เดินเข้า/ออกทางประตู (DOOR_SLOT) แล้ว fade ระหว่างเดิน

"use strict";

import { zoneAndRoleFor, worldPos, TILE, DOOR_SLOT, directionFromVector } from "./layout.js";

/** ความเร็วเดินของตัวละครระหว่างโซน — spec §7.4 "ประมาณ 4 tile/วินาที" */
export const GLIDE_TILES_PER_SEC = 4;
/** กันไม่ให้ glide ระยะสั้นมาก ๆ (สลับที่นั่งในโซนเดียวกัน) ดูกระตุกเกินไป */
export const MIN_GLIDE_MS = 150;
/** เดินออกทางประตูแล้วจางหาย ~1 วินาที (spec §7.4) — คงที่ไม่ผูกกับระยะทาง กันรอนานเกินไปตอนประตูไกล */
export const DESPAWN_MS = 1000;
/** เดินเข้าทางประตูตอนเกิด — สั้นกว่า despawn เล็กน้อยให้รู้สึกกระตือรือร้น */
export const SPAWN_MS = 700;
/** ป้ายชื่อ = ชื่อเธรดตัดเหลือ ~24 ตัวอักษร (spec §5.1/§5.4) */
export const LABEL_MAX_CHARS = 24;

/** ตัดชื่อให้เหลือ ~24 ตัวอักษรสำหรับป้ายบนตัวละคร (การ์ดข้อมูลยังโชว์ชื่อเต็มเสมอ) */
export function truncateName(name, max = LABEL_MAX_CHARS) {
  if (!name) return "";
  if (name.length <= max) return name;
  return `${name.slice(0, Math.max(0, max - 1))}…`;
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** รวม sessions + scheduleRuns + outcomeFeed เป็นลิสต์ตัวละครเดียว (dedupe กันเผื่อ backend พลาด) */
function collectCharacters(snapshot) {
  const all = [
    ...(snapshot.sessions || []),
    ...(snapshot.scheduleRuns || []),
    ...(snapshot.outcomeFeed || []),
  ];
  const byId = new Map();
  for (const char of all) {
    if (byId.has(char.id)) {
      console.warn(`[office-ui] id ซ้ำใน snapshot: ${char.id} (ใช้ตัวแรกที่เจอ)`);
      continue;
    }
    byId.set(char.id, char);
  }
  return byId;
}

/**
 * จัดสรร slotIndex ให้แต่ละ id ในโซน โดยพยายามคงตำแหน่งเดิมถ้ายังอยู่โซนเดิม (กันสลับที่กันเองไม่มีเหตุผล)
 *
 * ตัวที่ไม่เหลือที่นั่งได้ index ตั้งแต่ `slotCount` ขึ้นไป = **ล้นโซน** ยืนซ้อนที่นั่งสุดท้ายและ
 * ไม่ได้ป้ายชื่อ (render.js นับรวมเป็น `+n` ที่หัวโซนแทน) — ก่อนหน้านี้ทุกตัวที่ล้นถูกยัดที่นั่งสุดท้าย
 * เหมือนกันแล้วป้ายก็ทับกันเป็นตั้ง ซึ่งเป็นต้นทางของบันไดป้ายที่ไหลข้ามโซนไปทั้งจอ
 */
function assignSlots(prevAssignment, idsInZone, slotCount) {
  const used = new Set();
  const result = {};
  for (const id of idsInZone) {
    const p = prevAssignment[id];
    if (p != null && p < slotCount && !used.has(p)) {
      result[id] = p;
      used.add(p);
    }
  }
  let nextFree = 0;
  let overflow = slotCount;
  for (const id of idsInZone) {
    if (result[id] != null) continue;
    while (used.has(nextFree) && nextFree < slotCount) nextFree++;
    if (nextFree < slotCount) {
      result[id] = nextFree;
      used.add(nextFree);
    } else {
      result[id] = overflow++;
    }
  }
  return result;
}

/**
 * สร้างสถานะห้องหนึ่งชุด (position cache + slot memory) ผูกกับ zones ที่กำหนด
 * @param {ReturnType<import("./layout.js").buildZones>} zones
 * @param {{tilePx?:number, door?:{x:number,y:number,dir?:string}}} [options]
 *   `tilePx` = px ต่อ tile จริงจาก manifest (ค่าเริ่มต้น TILE) — คุมทั้งพิกัดปลายทางและความเร็วเดิน
 *   `door` = ประตูของห้องขนาดจริงจาก map.json (ค่าเริ่มต้น DOOR_SLOT ของห้อง 32x16)
 */
export function createRoomState(zones, options = {}) {
  const tilePx = options.tilePx ?? TILE;
  const door = options.door ?? DOOR_SLOT;
  /** id -> { from, to, cur, t0, dur, dir, spawning, despawning, despawnT0, meta } */
  const posCache = new Map();
  /** zoneId -> { id: slotIndex } — หน่วยความจำที่นั่งข้าม snapshot (เฉพาะโซน grid ปกติ) */
  const slotMemory = {};
  let clockOffsetMs = 0;

  /** อัปเดต cache.cur ให้ทันเวลา `now` (idempotent) — เรียกก่อน rebase glide เสมอ กันอ่านตำแหน่งเก่า */
  function syncCurrent(cache, now) {
    if (cache.dur === 0) {
      cache.cur = { ...cache.to };
      return cache.cur;
    }
    const t = Math.min(1, (now - cache.t0) / cache.dur);
    const e = easeInOutQuad(t);
    const x = cache.from.x + (cache.to.x - cache.from.x) * e;
    const y = cache.from.y + (cache.to.y - cache.from.y) * e;
    if (t >= 1) {
      cache.cur = { ...cache.to };
      cache.dur = 0;
    } else {
      cache.cur = { x, y };
    }
    return cache.cur;
  }

  function glideTo(cache, target, now) {
    syncCurrent(cache, now); // ให้ cache.cur เป็นตำแหน่งบนจอ "ตอนนี้" จริง ๆ ก่อนคำนวณ leg ใหม่
    cache.from = { ...cache.cur };
    cache.to = { ...target };
    cache.t0 = now;
    const distTiles = Math.hypot(cache.to.x - cache.from.x, cache.to.y - cache.from.y) / tilePx;
    cache.dur = Math.max(MIN_GLIDE_MS, (distTiles / GLIDE_TILES_PER_SEC) * 1000);
  }

  function buildMeta(char, zoneRole, overflow = false) {
    return {
      id: char.id,
      kind: char.kind,
      state: char.state,
      name: char.name,
      label: truncateName(char.name),
      headline: char.headline ?? null,
      detail: char.detail ?? null,
      since: char.since,
      deadlineAt: char.deadlineAt ?? null,
      // เส้นตายที่ derive จาก browserQueue.waiting[] (P4) — แยกจาก deadlineAt ข้างบนซึ่งเป็นค่าดิบจาก
      // snapshot (ต้องเป็น null เสมอตอนรอคิว Browser ตาม spec §4.1 ข้อ 2) ใช้เฉพาะตอน Run รอคิว (§5.6)
      browserDeadlineAt: zoneRole.deadlineAt ?? null,
      threadId: char.threadId ?? null,
      threadUrl: char.threadUrl ?? null,
      workspace: char.workspace ?? null,
      model: char.model ?? null,
      approvals: char.approvals || [],
      outcome: char.outcome ?? null,
      zone: zoneRole.zone,
      role: zoneRole.role ?? null,
      queuePos: zoneRole.queuePos ?? null,
      browserBadge: !!zoneRole.browserBadge,
      // true = โซนนี้มีตัวละครมากกว่าที่นั่ง ตัวนี้เลยไม่มีที่นั่งของตัวเอง ⇒ ไม่วาดป้ายชื่อ นับเป็น +n แทน
      overflow,
    };
  }

  function placeEntity(char, slot, zoneRole, now, overflow = false) {
    const target = worldPos(slot, tilePx);
    const meta = buildMeta(char, zoneRole, overflow);
    let cache = posCache.get(char.id);
    if (!cache) {
      // เกิด: เดินเข้ามาจากประตูเสมอ (spec §7.4) ไม่ใช่ fade-in อยู่กับที่
      const doorPos = worldPos(door, tilePx);
      const distTiles = Math.hypot(target.x - doorPos.x, target.y - doorPos.y) / tilePx;
      cache = {
        from: { ...doorPos },
        to: { ...target },
        cur: { ...doorPos },
        t0: now,
        dur: Math.max(MIN_GLIDE_MS, Math.min(SPAWN_MS, (distTiles / GLIDE_TILES_PER_SEC) * 1000)),
        dir: slot.dir || "down",
        spawning: true,
        despawning: false,
        despawnT0: 0,
        meta,
      };
      posCache.set(char.id, cache);
      return;
    }
    cache.despawning = false;
    cache.meta = meta;
    cache.dir = slot.dir || cache.dir;
    if (cache.to.x !== target.x || cache.to.y !== target.y) {
      glideTo(cache, target, now);
    }
  }

  /**
   * จุดเข้าเดียวที่แตะ state ทั้งหมด — วาง snapshot ใหม่ทับ cache (ไม่ reconcile บางส่วน)
   * @param {object} snapshot payload เต็มก้อนตาม spec §4
   * @param {number} now เวลาปัจจุบัน (epoch ms — หน่วยเดียวกับ snapshot.now)
   */
  function applySnapshot(snapshot, now) {
    clockOffsetMs = (snapshot.now ?? now) - now;

    const browserQueue = snapshot.browserQueue || { holder: null, waiting: [] };
    const charsById = collectCharacters(snapshot);

    const byZone = {};
    for (const char of charsById.values()) {
      const zoneRole = zoneAndRoleFor(char, browserQueue);
      (byZone[zoneRole.zone] ||= []).push({ char, zoneRole });
    }

    for (const zoneId of Object.keys(zones)) {
      const list = byZone[zoneId] || [];
      if (zoneId === "browser") {
        const waiters = zones.browser.waiterSlots;
        for (const { char, zoneRole } of list) {
          const isHolder = zoneRole.role === "holder";
          const queueIdx = zoneRole.queuePos - 1;
          const slot = isHolder ? zones.browser.holderSlot : waiters[Math.min(queueIdx, waiters.length - 1)];
          placeEntity(char, slot, zoneRole, now, !isHolder && queueIdx >= waiters.length);
        }
      } else {
        const slotCount = zones[zoneId].slots.length;
        const ids = list.map((x) => x.char.id);
        const assignment = assignSlots(slotMemory[zoneId] || {}, ids, slotCount);
        slotMemory[zoneId] = assignment;
        for (const { char, zoneRole } of list) {
          const idx = assignment[char.id] ?? slotCount - 1;
          placeEntity(char, zones[zoneId].slots[Math.min(idx, slotCount - 1)], zoneRole, now, idx >= slotCount);
        }
      }
    }

    // ตัวที่หายจาก snapshot นี้ = despawn — meta ถูกแช่แข็งอัตโนมัติ (ไม่ถูกเขียนทับอีกเพราะ
    // ลูป placeEntity() ข้างบนไม่เรียก id นี้แล้ว) เดินออกทางประตูก่อนลบออกจริง
    for (const [id, cache] of posCache) {
      if (!charsById.has(id) && !cache.despawning) {
        glideTo(cache, worldPos(door, tilePx), now);
        cache.dur = Math.max(cache.dur, DESPAWN_MS); // ให้เวลาเดินออก+จางหายอย่างน้อย ~1 วินาที
        cache.despawning = true;
        cache.despawnT0 = now;
      }
    }
  }

  /** คำนวณลิสต์วาด ณ เวลา `now` — เรียงชั้นตาม y (painter's algorithm) และลบตัวที่จางหายหมดแล้วออกจาก cache */
  function getDrawList(now) {
    const list = [];
    for (const [id, cache] of posCache) {
      // syncCurrent() ตั้ง dur=0 ทันทีที่ leg จบ ⇒ dur>0 หลังเรียก = "ยังเดินอยู่จริง ณ เวลานี้"
      const pos = syncCurrent(cache, now);
      const moving = cache.dur > 0;
      // ระหว่างเดินให้หันตามเวกเตอร์การเคลื่อนที่ (spec §7.4) ไม่ใช่ทิศของที่นั่งปลายทาง —
      // ถึงที่แล้วค่อยกลับไปหันตาม slot.dir ที่ cache.dir เก็บไว้
      const dir =
        (moving ? directionFromVector(cache.to.x - cache.from.x, cache.to.y - cache.from.y) : null) ||
        cache.dir;
      let alpha = 1;
      let scale = 1;
      if (cache.despawning) {
        const dt = (now - cache.despawnT0) / DESPAWN_MS;
        alpha = Math.max(0, 1 - dt);
        scale = 1 - 0.3 * Math.min(1, dt);
        if (dt >= 1) {
          posCache.delete(id);
          continue;
        }
      } else if (cache.spawning) {
        const dt = (now - cache.t0) / cache.dur;
        alpha = Math.min(1, dt);
        scale = 0.6 + 0.4 * Math.min(1, dt);
        if (dt >= 1) cache.spawning = false;
      }
      list.push({
        id,
        x: pos.x,
        y: pos.y,
        alpha,
        scale,
        dir,
        // `moving` + `animMs` คือทุกอย่างที่ render.js ต้องใช้เลือกท่า/เฟรม (เดิน = walk เล่นวน,
        // อยู่นิ่ง = ท่าตาม manifest.states เฟรมเดียว) — เวลานับจากจุดเริ่ม leg ปัจจุบัน
        moving,
        animMs: Math.max(0, now - cache.t0),
        meta: cache.meta,
      });
    }
    list.sort((a, b) => a.y - b.y);
    return list;
  }

  /** เวลาของ Host โดยประมาณ ณ เวลาท้องถิ่น `localNow` — ใช้ offset ที่คำนวณครั้งเดียวต่อ snapshot (spec §3.4) */
  function estimateHostNow(localNow) {
    return localNow + clockOffsetMs;
  }

  return {
    applySnapshot,
    getDrawList,
    estimateHostNow,
    /** เปิดเผยไว้สำหรับเทสต์/debug เท่านั้น — โค้ด production ไม่ควรแก้ cache ตรง ๆ */
    _posCache: posCache,
  };
}
