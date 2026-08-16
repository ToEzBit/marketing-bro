// office/app/render.js
//
// วาดห้อง + ตัวละคร + ป้าย + เอฟเฟกต์ลง canvas 2D ล้วน (ไม่มี library — spec §7.1)
// รับ drawList จาก state.js (ตำแหน่งคำนวณแล้ว) แล้ววาดเป็นชั้น ๆ ตามลำดับที่ spec §7.2 บังคับ:
//   พื้น/เฟอร์นิเจอร์ → ตัวละคร (เรียงตาม y) → ป้ายชื่อโซน+ตัวละคร (pass สุดท้ายเสมอ กันตัวละครบัง)
//
// โหมด asset: ถ้า assets.mode === "sprites" ใช้ drawImage จาก manifest จริง (ห้อง = tileset + map.json,
// ตัวละคร = ชีตจริง) ถ้าไม่ใช่ (placeholder) วาดห้องเป็นสี่เหลี่ยมโซน + เฟอร์นิเจอร์เวกเตอร์ และวาด
// ตัวละครเป็นรูปทรงเรขาคณิตในกรอบ 64x64/tile 32px เดิมเป๊ะ — สองโหมดนี้ต้องใช้งานได้เท่ากันทุกฟีเจอร์
//
// **ห้าม assume ขนาดใด ๆ** (spec §8.2): px ต่อ tile มาจาก assets.tilePx, ขนาดห้องมาจาก map.json,
// เฟรม/แถว/จุด anchor ของตัวละครมาจาก manifest — ค่าคงที่ TILE ใช้เป็นแค่ "หน่วยอ้างอิง" ของรูปทรง
// เวกเตอร์ที่วาดด้วยมือ (ดู UNIT ข้างล่าง) เท่านั้น

"use strict";

import {
  TILE,
  ROOM,
  ZONE_IDS,
  DEFAULT_DIRECTIONS,
  pickCharacterFolder,
  tileLayersOf,
  animationFrameIndex,
  characterLabelBox,
  clampBoxInto,
  fixedLabels,
  LABEL_LINE_H,
  LABEL_PLATE_H,
  LABEL_PLATE_PAD_X,
} from "./layout.js";

const STATE_META = {
  idle: { label: "ว่าง", icon: "💤", color: "#5aa9e6" },
  working: { label: "กำลังทำงาน", icon: "💻", color: "#4caf7d" },
  approval: { label: "รอ Approval", icon: "✋", color: "#f5b83d" },
  failed: { label: "ล้มเหลว", icon: "🐞", color: "#e5484d" },
  stopped: { label: "ถูกสั่งหยุด", icon: "⏸", color: "#9096a3" },
};
const ROLE_META = {
  holder: { icon: "🌐", color: "#8b6cff" },
  waiter: { icon: "⏳", color: "#8b6cff" },
};

/** งบ (px) ขั้นต่ำที่ต้องเหลือให้ headline ถึงจะยอมพิมพ์ต่อท้ายนาฬิกา — น้อยกว่านี้พิมพ์ไปก็ได้แค่ "…"
 *  (และห้ามปล่อยให้งบเป็น 0 เพราะ clipTextToWidth มองค่า falsy ว่า "ไม่จำกัด" แล้วข้อความจะล้นกล่อง) */
const MIN_HEADLINE_WIDTH = 20;
/** baseline ของข้อความบรรทัดแรก วัดจากขอบบนของกล่องป้าย (แผ่นรองสูง 15px ฟอนต์ ~10px) */
const LABEL_TEXT_BASELINE = 11;
/** ชื่อท่าเดินใน manifest.character.animations — ท่าเดียวที่เล่นเป็นอนิเมชัน (spec §8.2 ตั้งชื่อไว้แบบนี้) */
const WALK_ANIM = "walk";

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** จัดรูปนาฬิกาเป็นข้อความ mm:ss (หรือ h:mm:ss ถ้าเกิน 1 ชม.) — ปัดลบให้เป็น 0 เสมอ */
export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/**
 * ตัดสินว่าตัวละครนี้ควรนับถอยหลังหรือนับขึ้น (spec §5.6):
 * ถอยหลังเฉพาะโซน Approval (จาก `meta.deadlineAt` — ค่าจริงจาก snapshot) และ Run ที่รอคิว Browser
 * (จาก `meta.browserDeadlineAt` ที่ derive จาก `browserQueue.waiting[].deadlineAt` เท่านั้น — ห้ามอ่าน
 * `meta.deadlineAt` ตรงนี้เพราะ backend ส่ง `null` เสมอสำหรับเคสนี้ตาม spec §4.1 ข้อ 2) ที่เหลือนับขึ้น
 * (Task ที่รอคิว Browser มี `browserDeadlineAt: null` เสมอตาม ADR 0006 → นับขึ้นเหมือนกรณีทั่วไป)
 */
export function getClockInfo(meta, hostNowMs) {
  const isApproval = meta.state === "approval";
  if (isApproval && meta.deadlineAt != null) {
    const remaining = meta.deadlineAt - hostNowMs;
    return { text: formatDuration(remaining), countdown: true, overdue: remaining <= 0 };
  }
  const isRunBrowserWaiter = meta.kind === "run" && meta.zone === "browser" && meta.role === "waiter";
  if (isRunBrowserWaiter && meta.browserDeadlineAt != null) {
    const remaining = meta.browserDeadlineAt - hostNowMs;
    return { text: formatDuration(remaining), countdown: true, overdue: remaining <= 0 };
  }
  return { text: formatDuration(hostNowMs - meta.since), countdown: false, overdue: false };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @param {{canvas:HTMLCanvasElement, zones:object, assets:object,
 *          roomSize?:{cols:number,rows:number}, tilePx?:number}} args
 *   `assets.tilePx` = ขนาด tile **ต้นฉบับ** บนจอจาก manifest, `tilePx` = ขนาดที่ห้องวาดจริงรอบนี้
 *   (มาจาก chooseTilePx() ตามพื้นที่ที่มี — ค่าเริ่มต้นคือขนาดต้นฉบับ),
 *   `roomSize` = ขนาดห้องจาก map.json (ค่าเริ่มต้น 32x16)
 *
 * renderer ไม่มี state ของตัวเอง (นอกจาก ctx) — เปลี่ยนขนาดห้องตอนรันด้วยการ **สร้างใหม่** ทั้งตัว
 */
export function createRenderer({ canvas, zones, assets, roomSize, tilePx: tilePxArg }) {
  const ctx = canvas.getContext("2d");
  /** px ต่อ tile ต้นฉบับตาม manifest (tileSize x scale) — ไม่ใช่ค่าคงที่ 32 (spec §8.2) */
  const baseTilePx = assets.tilePx > 0 ? assets.tilePx : TILE;
  /** px ต่อ tile ที่ใช้จริงทั้งไฟล์นี้ (ขยายให้เต็มพื้นที่จอแล้ว) */
  const tilePx = tilePxArg > 0 ? tilePxArg : baseTilePx;
  const cols = roomSize?.cols > 0 ? roomSize.cols : ROOM.cols;
  const rows = roomSize?.rows > 0 ? roomSize.rows : ROOM.rows;
  /** ตัวคูณของรูปทรงเวกเตอร์ที่เขียนด้วยตัวเลข px สมัย tile 32px (เฟอร์นิเจอร์/dais/สปอตไลต์) */
  const UNIT = tilePx / TILE;
  /** ตัวคูณของ "งานศิลป์ที่วาดตามขนาดต้นฉบับใน manifest" — สไปรต์ตัวละคร (เฟรม 64px) กับของที่ติดตัวมัน
   *  ต้องโตตามห้อง ไม่งั้นห้องขยายแล้วคนตัวเท่าเดิมจะกลายเป็นมดเดินในห้องยักษ์
   *  (ต่างจาก UNIT ที่อิงหน่วย 32px ของรูปทรงเวกเตอร์ — ชุด asset ที่ ship จริงสองค่านี้เท่ากันพอดี) */
  const zoom = tilePx / baseTilePx;
  const W = cols * tilePx;
  const H = rows * tilePx;
  /** เรขาคณิตของป้ายตำแหน่งตายตัว — คำนวณครั้งเดียวจาก layout.js (แหล่งเดียวกับที่ layout.test.js ตรวจ) */
  const labels = fixedLabels(zones, tilePx);
  /** ขอบเขตที่ป้ายตัวละครห้ามหลุดออกไป (ขอบ canvas หักกรอบดำ 3px ของห้อง) */
  const ROOM_LABEL_BOUNDS = { x1: 4, y1: 4, x2: W - 4, y2: H - 4 };

  function tileRect([x, y, w, h]) {
    return [x * tilePx, y * tilePx, w * tilePx, h * tilePx];
  }

  /** วาดรูปทรงเวกเตอร์รอบจุดกำเนิดที่ slot (พิกัด tile) โดยสเกลตาม tilePx ให้ได้สัดส่วนเดิมเสมอ */
  function atSlot(cx, cy, drawFn) {
    ctx.save();
    ctx.translate(cx * tilePx, cy * tilePx);
    ctx.scale(UNIT, UNIT);
    drawFn();
    ctx.restore();
  }

  function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  setupCanvas();

  // ---- เฟอร์นิเจอร์/ของประดับต่อโซน (วาดเสมอ ไม่ขึ้นกับว่ามีคนอยู่ไหม) ----
  // หมายเหตุ: ห้ามมี effect ที่ขึ้นกับเวลา (พัลส์/หมุน) นอกโซน Approval (spec §7.4) — จอมอนิเตอร์นี้
  // จึงเป็นสีนิ่ง ไม่ใช่ไฟกะพริบ
  function drawDesk(cx, cy) {
    atSlot(cx, cy, () => {
      ctx.fillStyle = "#5b4327";
      ctx.fillRect(-20, -30, 40, 18);
      ctx.strokeStyle = "#2c2116";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-20, -30, 40, 18);
      ctx.fillStyle = "#111318";
      ctx.fillRect(-8, -40, 16, 11);
      ctx.fillStyle = "rgba(120,200,255,0.45)";
      ctx.fillRect(-6, -38, 12, 7);
    });
  }
  function drawSofa(cx, cy) {
    atSlot(cx, cy, () => {
      ctx.fillStyle = "#3b6a8f";
      roundRectPath(ctx, -18, -16, 36, 20, 6);
      ctx.fill();
      ctx.fillStyle = "#2c4f6b";
      ctx.fillRect(-18, -16, 36, 6);
    });
  }
  function drawTable(cx, cy) {
    atSlot(cx, cy, () => {
      ctx.fillStyle = "#6b5220";
      ctx.beginPath();
      ctx.ellipse(0, 0, 34, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#3c2f13";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
  function drawScreenProp(cx, cy) {
    atSlot(cx, cy, () => {
      ctx.fillStyle = "#111318";
      ctx.fillRect(-14, -26, 28, 20);
      ctx.fillStyle = "rgba(139,108,255,0.55)";
      ctx.fillRect(-11, -23, 22, 14);
    });
  }
  function drawCracks(rect) {
    const [x, y, w, h] = tileRect(rect);
    ctx.strokeStyle = "rgba(0,0,0,.5)";
    ctx.lineWidth = 2 * UNIT;
    const paths = [
      [
        [x + w * 0.2, y + h * 0.3],
        [x + w * 0.35, y + h * 0.5],
        [x + w * 0.25, y + h * 0.8],
      ],
      [
        [x + w * 0.6, y + h * 0.2],
        [x + w * 0.7, y + h * 0.45],
        [x + w * 0.85, y + h * 0.55],
      ],
    ];
    for (const p of paths) {
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.stroke();
    }
  }
  function drawBarrier(rect) {
    const [x, y, w] = tileRect(rect);
    ctx.strokeStyle = "#d8b23a";
    ctx.lineWidth = 3 * UNIT;
    ctx.setLineDash([8 * UNIT, 6 * UNIT]);
    ctx.beginPath();
    ctx.moveTo(x + 8 * UNIT, y + 12 * UNIT);
    ctx.lineTo(x + w - 8 * UNIT, y + 12 * UNIT);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const ZONE_FLOOR = {
    lounge: "#25384a",
    stopped: "#2c2e35",
    approval: "#4a3a12",
    desks: "#1e3327",
    browser: "#2a2540",
    bug: "#3a2224",
  };

  /** จุดเด่นที่สุดในห้อง (spec §7.2): dais ยกพื้น + สปอตไลต์พัลส์ + วงแหวนหมุน — เฉพาะโซน Approval */
  function drawApprovalSpotlight(now) {
    const az = zones.approval;
    const pulse = 0.5 + 0.5 * Math.sin(now / 900);

    atSlot(az.center.x, az.center.y, () => {
      const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 130 + pulse * 14);
      grad.addColorStop(0, `rgba(255,214,120,${0.32 + pulse * 0.1})`);
      grad.addColorStop(1, "rgba(255,214,120,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 130 + pulse * 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.rotate(now / 4000);
      ctx.strokeStyle = `rgba(255,214,120,${0.55 + pulse * 0.25})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, 78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.fillStyle = "rgba(0,0,0,.25)";
      roundRectPath(ctx, -92, -52 + 6, 184, 108, 14);
      ctx.fill();
      ctx.fillStyle = "rgba(255,214,120,.18)";
      roundRectPath(ctx, -92, -52, 184, 108, 14);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,214,120,.55)";
      ctx.lineWidth = 2;
      roundRectPath(ctx, -92, -52, 184, 108, 14);
      ctx.stroke();
    });

    drawTable(az.center.x, az.center.y);
  }

  /**
   * ผังห้องจริงจาก tileset + map.json (spec §8.1/§8.2) — null เมื่อชุด asset ไม่มี map ให้วาด
   * (ตอนนั้นตกกลับไปใช้พื้นโซนสีทึบแบบ placeholder ซึ่งยังใช้งานได้ครบทุกฟีเจอร์)
   *
   * ขนาด tile ต้นฉบับที่ใช้ "หั่น" ชีต ยึด `manifest.room.tileSize` เป็นแหล่งเดียว (ไม่ใช่
   * `map.tilesets[].tilewidth`) ให้ tileSize เป็นปุ่มเดียวตามที่ spec §8.2 เขียนไว้ — จำนวนคอลัมน์
   * จึงคำนวณจากความกว้างจริงของรูป ไม่อ่าน `columns` ในไฟล์ map
   */
  const mapInfo = (() => {
    if (assets.mode !== "sprites" || !assets.tileset || !assets.map) return null;
    const layers = tileLayersOf(assets.map);
    if (!layers.length) return null;
    const src = Number(assets.tileSize);
    if (!(src > 0)) return null;
    const sheetW = assets.tileset.naturalWidth || assets.tileset.width || 0;
    const columns = Math.max(1, Math.floor(sheetW / src));
    const firstgid = Number(assets.map.tilesets?.[0]?.firstgid) || 1;
    return { layers, src, columns, firstgid };
  })();

  function drawTiledMap() {
    const { layers, src, columns, firstgid } = mapInfo;
    for (const layer of layers) {
      const stride = Number(layer.width) > 0 ? Math.floor(layer.width) : cols;
      const ox = Number(layer.x) || 0;
      const oy = Number(layer.y) || 0;
      const data = layer.data;
      for (let i = 0; i < data.length; i++) {
        const gid = data[i];
        if (!gid) continue; // 0 = ไม่มี tile ช่องนี้
        const index = gid - firstgid;
        if (index < 0) continue;
        ctx.drawImage(
          assets.tileset,
          (index % columns) * src,
          Math.floor(index / columns) * src,
          src,
          src,
          (ox + (i % stride)) * tilePx,
          (oy + Math.floor(i / stride)) * tilePx,
          tilePx,
          tilePx,
        );
      }
    }
  }

  /**
   * พื้นโซน — มีสองโหมด:
   *  - มีผังห้องจริง: เคลือบสีโซนแบบโปร่ง ให้ลายไม้/ผนังของ tileset ยังเห็นชัด แต่ยังแยกโซนออกด้วยสี
   *  - ไม่มีผังห้อง (placeholder): สี่เหลี่ยมทึบแบบเดิมเป๊ะ ๆ
   */
  function drawZoneFloors() {
    const tinted = Boolean(mapInfo);
    for (const id of ZONE_IDS) {
      const z = zones[id];
      const [x, y, w, h] = tileRect(z.rect);
      ctx.save();
      if (tinted) ctx.globalAlpha = 0.3;
      ctx.fillStyle = ZONE_FLOOR[id];
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = tinted ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.06)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }

  function drawDecorations(now) {
    drawApprovalSpotlight(now); // effect ที่ขึ้นกับเวลา (พัลส์/หมุน) มีได้เฉพาะจุดนี้จุดเดียว (spec §7.4)
    for (const s of zones.desks.slots) drawDesk(s.x, s.y);
    for (const s of zones.lounge.slots) drawSofa(s.x, s.y);
    drawScreenProp(zones.browser.holderSlot.x, zones.browser.holderSlot.y);
    drawCracks(zones.bug.rect);
    drawBarrier(zones.stopped.rect);
  }

  function drawDirNose(dir) {
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.beginPath();
    if (dir === "down") {
      ctx.moveTo(-4, -50);
      ctx.lineTo(4, -50);
      ctx.lineTo(0, -46);
    } else if (dir === "up") {
      ctx.moveTo(-4, -60);
      ctx.lineTo(4, -60);
      ctx.lineTo(0, -64);
    } else if (dir === "left") {
      ctx.moveTo(-10, -55);
      ctx.lineTo(-10, -49);
      ctx.lineTo(-14, -52);
    } else {
      ctx.moveTo(10, -55);
      ctx.lineTo(10, -49);
      ctx.lineTo(14, -52);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawBadge(dx, dy, glyph) {
    ctx.beginPath();
    ctx.arc(dx, dy, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#14161c";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, dx, dy + 1);
    ctx.textBaseline = "alphabetic";
  }

  /** วาดตัวละครหนึ่งตัว (ไม่รวมป้ายชื่อ — ป้ายวาดเป็น pass แยกท้ายสุดเสมอ spec §7.2) */
  function drawCharacterSprite(item) {
    const { x, y, alpha, scale, dir, meta, selected } = item;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    // `zoom` = ห้องถูกวาดใหญ่กว่าขนาดต้นฉบับกี่เท่า — ทุกอย่างในบล็อกนี้ (เงา/สไปรต์/badge/วงเลือก)
    // เขียนด้วยพิกัดขนาดต้นฉบับ จึงโตตามห้องพร้อมกันหมดด้วยการคูณตรงนี้ที่เดียว
    ctx.scale(scale * zoom, scale * zoom);

    ctx.beginPath();
    ctx.ellipse(0, -2, 15, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fill();

    const bodyColor = meta.role ? ROLE_META[meta.role].color : STATE_META[meta.state]?.color || "#888";

    if (assets.mode === "sprites") {
      drawSpriteFrame(item, dir);
    } else {
      // placeholder เรขาคณิต — สี่เหลี่ยมมนหัว+ตัว ในกรอบ 64x64 เดิมเป๊ะ (จะสลับเป็น drawImage
      // ทีหลังได้โดยไม่ต้องแก้ layout ใด ๆ ตามที่ prototype #11 พิสูจน์ไว้)
      roundRectPath(ctx, -16, -46, 32, 34, 6);
      ctx.fillStyle = bodyColor;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.stroke();

      roundRectPath(ctx, -10, -63, 20, 18, 6);
      ctx.fillStyle = "#f2d9b8";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      drawDirNose(dir);
    }

    const stateIcon = meta.role ? ROLE_META[meta.role].icon : STATE_META[meta.state]?.icon || "•";
    drawBadge(9, -63, stateIcon);
    if (meta.browserBadge) drawBadge(-9, -63, "🌐");
    if (meta.role === "waiter" && meta.queuePos) {
      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(String(meta.queuePos), 0, -30);
    }

    if (selected) {
      ctx.beginPath();
      ctx.arc(0, -30, 32, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /**
   * คลี่ชื่อท่า → ชีตจริงที่โหลดไว้ ตาม `fallback` ใน manifest (เช่น sleep → sit)
   * คืน null เมื่อไม่มีชีตให้ใช้จริง ๆ เพื่อให้ผู้เรียกตกกลับไปท่าอื่นได้แทนที่จะวาดไม่ออก
   */
  function resolveAnim(folder, name, depth = 0) {
    if (!name || depth > 3) return null; // depth กัน fallback วนกันเอง
    const def = assets.manifest.character.animations?.[name];
    if (!def) return null;
    if (def.fallback) return resolveAnim(folder, def.fallback, depth + 1);
    const img = assets.characterImages[folder]?.[name];
    return img ? { img, def } : null;
  }

  /**
   * โหมด sprite จริง — geometry ทั้งหมดอ่านจาก manifest เท่านั้น ห้าม assume ขนาด/จำนวนเฟรม (spec §8.2)
   *
   * ท่า (spec §7.4): กำลังย้ายโซน → `walk` เล่นวนตาม `frames`/`fps` ของ manifest และเลือกแถวจาก
   * ทิศการเคลื่อนที่ · อยู่นิ่ง → ท่าตาม `manifest.states[state].anim` **ตรึงเฟรมเดียว** โดยตั้งใจ
   * เพราะท่าอยู่นิ่งของ LPC ไม่ใช่ลูปเดิน (`sit.png` 3 "เฟรม" คือ 3 ท่านั่งคนละท่า เล่นวนแล้วจะกระตุก)
   */
  function drawSpriteFrame(item, dir) {
    const { manifest, folders } = assets; // ตัวชีตเองหยิบผ่าน resolveAnim()
    const meta = item.meta;
    const folder = folders[pickCharacterFolder(meta.id, folders.length)];
    const walking = item.moving ? resolveAnim(folder, WALK_ANIM) : null;
    const anim = walking || resolveAnim(folder, manifest.states?.[meta.state]?.anim || "idle");
    if (!anim) return; // ป้องกัน crash ถ้า manifest อ้างถึงไฟล์ที่โหลดไม่สำเร็จ

    const chr = manifest.character;
    const [fw, fh] = chr.frameSize;
    const dirIndex = Math.max(0, (chr.directions || DEFAULT_DIRECTIONS).indexOf(dir));
    const [offX, offY] = chr.offset || [0, 0];
    const anchor = chr.anchor || [];
    const anchorX = Number.isFinite(anchor[0]) ? anchor[0] : fw / 2;
    const anchorY = Number.isFinite(anchor[1]) ? anchor[1] : fh - 2;
    const frameIndex = walking ? animationFrameIndex(item.animMs, anim.def.frames, anim.def.fps) : 0;
    ctx.drawImage(
      anim.img,
      offX + frameIndex * fw,
      offY + dirIndex * fh,
      fw,
      fh,
      -anchorX,
      -anchorY,
      fw,
      fh,
    );
  }

  /**
   * ตัด text ด้วย "…" ให้พอดี maxWidth px จริง (วัดด้วย ctx.measureText ของ font ที่ตั้งไว้แล้ว)
   * นี่คือคนละชั้นกับ truncateName() ~24 ตัวอักษรใน state.js (ซึ่งยังเป็นค่าที่ใช้จริงในการ์ดข้อมูล/
   * meta.label เต็ม) — ชั้นนี้แค่บีบเฉพาะ "ป้ายบนจอ" เพิ่มอีกทีเมื่อที่นั่งชิดกันจนป้าย 24 ตัวอักษรจะทับ
   * ป้ายข้างเคียง (บั๊กที่เจอตอนทดสอบด้วย snapshot ที่เต็มทุกโซนพร้อมกัน — ป้ายในโซน grid 3 คอลัมน์
   * อย่าง stopped/bug และคิว Browser ชิดกันมากพอที่ป้าย 24 ตัวอักษรจะทับกันเอง)
   */
  function clipTextToWidth(ctx, text, maxWidth) {
    if (!maxWidth || ctx.measureText(text).width <= maxWidth) return text;
    let clipped = text;
    while (clipped.length > 0 && ctx.measureText(clipped + "…").width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    return clipped.length > 0 ? clipped + "…" : "…";
  }

  /**
   * วาดแผ่นรองสีทึบตามกล่องที่ให้มา **เป๊ะ ๆ** (spec §7.2 — แผ่นรองกันตัวหนังสือโดนลายพื้นห้องกลืน)
   * กล่องที่วาดกับกล่องที่ layout.js/เทสต์ตรวจต้องเป็นก้อนเดียวกันเสมอ ไม่ใช่คนละสูตร
   */
  function drawPlate(box, bg) {
    ctx.fillStyle = bg;
    roundRectPath(ctx, box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1, 5);
    ctx.fill();
  }

  /**
   * วาดข้อความหนึ่งบรรทัดกึ่งกลาง `cx` โดยรับประกันว่าไม่ล้นกล่อง: ตัดด้วย … ก่อน แล้วยังส่ง
   * `maxWidth` ให้ fillText เป็นตาข่ายชั้นสุดท้าย (ฟอนต์ที่ผู้ใช้มีไม่เท่ากันทุกเครื่อง)
   */
  function drawClippedLine(text, cx, baseline, budget, font, fill) {
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = "center";
    ctx.fillText(clipTextToWidth(ctx, text, budget), cx, baseline, budget);
  }

  /**
   * ป้ายที่ตำแหน่งตายตัว (หัวโซน / FIFO / ผู้ถือ Browser / auto-pause) — วาดจาก spec ของ layout.js
   * `spec.w` คือความกว้างสูงสุด; แผ่นรองย่อตามข้อความจริงแต่ไม่มีวันเกิน ⇒ อยู่ในกรอบโซนเสมอ
   */
  function drawFixedLabel(spec, lines, bg) {
    const budget = spec.w - LABEL_PLATE_PAD_X * 2;
    let widest = 0;
    const prepared = lines.map((line) => {
      ctx.font = line.font;
      // `suffix` คือส่วนที่ต้องรอดจากการตัดเสมอ (เช่น "(ถือ Browser)" ที่เป็นตัวบอกความหมายของป้าย) —
      // กันงบเหลือ 0 ด้วย MIN_HEADLINE_WIDTH เพราะ clipTextToWidth มองค่า falsy ว่า "ไม่จำกัด"
      const suffix = line.suffix || "";
      const head = suffix
        ? Math.max(MIN_HEADLINE_WIDTH, budget - ctx.measureText(suffix).width)
        : budget;
      const text = clipTextToWidth(ctx, line.text, head) + suffix;
      const w = Math.min(budget, ctx.measureText(text).width);
      if (w > widest) widest = w;
      return { ...line, text };
    });
    const plateW = Math.min(spec.w, widest + LABEL_PLATE_PAD_X * 2);
    drawPlate(
      { x1: spec.cx - plateW / 2, y1: spec.top, x2: spec.cx + plateW / 2, y2: spec.top + spec.h },
      bg,
    );
    // ตัดข้อความไปแล้วข้างบน (พร้อมกันที่ให้ suffix) — **ห้ามตัดซ้ำ** ไม่งั้นรอบสองจะกินจากท้าย
    // ซึ่งคือ suffix ที่เพิ่งอุตส่าห์กันไว้ · `maxWidth` ของ fillText ยังเป็นตาข่ายชั้นสุดท้ายอยู่
    ctx.textAlign = "center";
    prepared.forEach((line, i) => {
      ctx.font = line.font;
      ctx.fillStyle = line.fg;
      ctx.fillText(line.text, spec.cx, spec.top + i * LABEL_LINE_H + LABEL_TEXT_BASELINE, budget);
    });
  }

  /**
   * ป้ายหัวโซน — ต่อท้ายด้วย `+n` เมื่อโซนนั้นมีตัวละครมากกว่าที่นั่งที่ใส่ป้ายได้ (spec §7.2)
   * ยัดป้ายเพิ่มจนล้นโซนคือสิ่งที่ทำให้ห้องถูกบังทั้งห้องมาแล้ว — จำนวนที่เหลือบอกที่หัวโซนแทน
   */
  function drawZoneLabels(overflowByZone) {
    for (const id of ZONE_IDS) {
      const z = zones[id];
      const isApproval = id === "approval";
      const extra = overflowByZone[id] || 0;
      drawFixedLabel(
        labels.zoneHeader[id],
        [
          {
            text: `${z.icon} ${z.label}`,
            // `+n` เป็น suffix ไม่ใช่ส่วนหนึ่งของ text — ชื่อโซนยาว ๆ (หรือฟอนต์ที่กว้างกว่าปกติ)
            // ต้องไม่ตัดตัวเลขที่บอกว่ายังมีอีกกี่ตัวที่ไม่ได้แสดงทิ้ง
            suffix: extra > 0 ? `  +${extra}` : "",
            font: isApproval ? "bold 15px sans-serif" : "600 12px sans-serif",
            fg: isApproval ? "#ffe6a8" : "rgba(255,255,255,.92)",
          },
          isApproval
            ? { text: "จุดที่ต้องการคนตัดสินใจ", font: "11px sans-serif", fg: "rgba(255,230,168,.95)" }
            : null,
        ].filter(Boolean),
        isApproval ? "rgba(74,58,18,.78)" : "rgba(0,0,0,.6)",
      );
    }
    drawFixedLabel(
      labels.browserNote,
      [{ text: "FIFO: มาก่อนได้ก่อน", font: "10px sans-serif", fg: "rgba(255,255,255,.85)" }],
      "rgba(0,0,0,.5)",
    );
  }

  /** โต๊ะ Browser แสดงป้ายชื่อผู้ถือเสมอ แม้ตัวถือจะไปยืนที่โซน Approval (P2 > P3 — spec §7.3) */
  function drawBrowserHolderNameplate(holderMeta) {
    if (!holderMeta) return;
    if (holderMeta.zone === "browser") return; // อยู่ที่โต๊ะอยู่แล้ว ป้ายตัวละครพอ ไม่ต้องซ้ำ
    drawFixedLabel(
      labels.browserHolder,
      [
        {
          text: `🌐 ${holderMeta.label}`,
          suffix: " (ถือ Browser)", // ต้องรอดเสมอ ไม่งั้นป้ายกลายเป็นชื่อลอย ๆ ที่ไม่บอกว่าคือใคร
          font: "bold 10px sans-serif",
          fg: "rgba(255,255,255,.92)",
        },
      ],
      "rgba(139,108,255,.55)",
    );
  }

  // ป้าย/marker ของ Schedule auto-pause — สีนิ่ง ไม่พัลส์ (เอฟเฟกต์ที่ขึ้นกับเวลามีได้เฉพาะโซน Approval, spec §7.4)
  function drawAutoPausedMarkers(markers) {
    const hitboxes = [];
    if (!markers.length) return hitboxes;
    const spec = fixedLabels(zones, tilePx, markers.length);
    markers.forEach((m, i) => {
      const { cx, cy, r } = spec.autoPause.markers[i];
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(213,60,60,0.65)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText("⏸", cx, cy + 1);
      ctx.textBaseline = "alphabetic";
      hitboxes.push({ kind: "schedule", id: m.id, x1: cx - r - 2, y1: cy - r - 2, x2: cx + r + 2, y2: cy + r + 2 });
    });
    drawFixedLabel(
      spec.autoPause.plate,
      [{ text: "Schedule auto-pause", font: "9px sans-serif", fg: "rgba(255,255,255,.92)" }],
      "rgba(0,0,0,.6)",
    );
    return hitboxes;
  }

  /**
   * ป้ายชื่อตัวละคร — pass สุดท้ายเสมอ (spec §7.2)
   *
   * กล่องป้ายมี **ขนาดตายตัว** (characterLabelBox) ไม่ยืดตามความยาวชื่อ และที่นั่งถูกวางให้ห่างกันพอ
   * ตั้งแต่ใน buildZones แล้ว ⇒ ป้ายอยู่ในโซนของตัวเองและไม่ชนกันโดยเรขาคณิต ไม่ต้องมี pass หลบกันอีก
   * (pass "ดันป้ายที่ชนลงทีละแถว" ของรอบก่อนถูกถอดออกแล้ว — มันแก้ตามเกณฑ์ที่ผิด แล้วดันป้ายออกนอกโซน)
   *
   * บรรทัด 1 = ชื่อ (ตัดด้วย … ชื่อเต็มดูจากการ์ดตอนคลิก) · บรรทัด 2 = **นาฬิกาก่อนเสมอ** แล้วค่อยยัด
   * headline ในงบที่เหลือ — สลับลำดับเมื่อไรชื่อ/headline ยาว ๆ จะกินงบจนนาฬิกาหายทั้งห้อง (บั๊ก 77cf82c)
   */
  function drawCharacterLabels(items, hostNowMs) {
    const ordered = [...items].sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const item of ordered) {
      if (item.meta.overflow) continue; // ล้นที่นั่งของโซน — นับรวมเป็น +n ที่หัวโซนแทน
      // clamp ใช้ได้จริงเฉพาะช่วงเดินเข้า/ออกทางประตู (ประตูอยู่ติดผนังล่าง ป้ายจะตกใต้ canvas ทั้งใบ)
      // — กับที่นั่งทุกที่มันเป็น no-op เพราะป้ายอยู่ในโซนตั้งแต่แรก (ยืนยันไว้ใน layout.test.js)
      const box = clampBoxInto(characterLabelBox(item.x, item.y, tilePx), ROOM_LABEL_BOUNDS);
      const cx = (box.x1 + box.x2) / 2;
      const budget = box.x2 - box.x1 - LABEL_PLATE_PAD_X * 2;
      const clock = getClockInfo(item.meta, hostNowMs);
      const clockText = `${clock.countdown ? "⏳" : "⏱"}${clock.text}`;

      ctx.globalAlpha = item.alpha;
      drawPlate(box, "rgba(0,0,0,.62)");
      drawClippedLine(
        item.meta.label,
        cx,
        box.y1 + LABEL_TEXT_BASELINE,
        budget,
        "600 10px sans-serif",
        "rgba(255,255,255,.94)",
      );

      ctx.font = "10px sans-serif";
      const rest = budget - ctx.measureText(`${clockText} · `).width;
      const line2 =
        item.meta.headline && rest >= MIN_HEADLINE_WIDTH
          ? `${clockText} · ${clipTextToWidth(ctx, item.meta.headline, rest)}`
          : clockText;
      drawClippedLine(
        line2,
        cx,
        box.y1 + LABEL_LINE_H + LABEL_TEXT_BASELINE,
        budget,
        "10px sans-serif",
        clock.overdue ? "rgba(255,190,190,.95)" : "rgba(255,255,255,.82)",
      );
      ctx.globalAlpha = 1;
    }
  }

  /**
   * วาดหนึ่งเฟรมเต็ม แล้วคืน hitbox สำหรับ click (ตัวละคร + ป้าย auto-pause)
   * @param {ReturnType<import("./state.js").createRoomState>["getDrawList"]} drawList จาก state.getDrawList(now)
   * @param {number} hostNowMs เวลา host โดยประมาณ — ใช้คำนวณนาฬิกา (spec §5.6)
   * @param {{holder:string|null}} browserQueue
   * @param {object[]} autoPausedSchedules
   * @param {string|null} selectedId
   */
  function draw(drawList, hostNowMs, browserQueue, autoPausedSchedules, selectedId, now) {
    const t = now ?? performance.now();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#171a21";
    ctx.fillRect(0, 0, W, H);
    if (mapInfo) drawTiledMap(); // ผังห้องจริงจาก tileset ก่อน แล้วค่อยเคลือบสีโซนทับแบบโปร่ง
    drawZoneFloors();
    drawDecorations(t);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    const withSelection = drawList.map((item) => ({ ...item, selected: item.id === selectedId }));
    const hitboxes = [];
    for (const item of withSelection) {
      drawCharacterSprite(item);
      // กรอบคลิกล้อมตัวสไปรต์ ⇒ ต้องโตด้วย `zoom` เท่ากับตัวสไปรต์ ไม่งั้นห้องขยายแล้วคลิกไม่โดน
      hitboxes.push({
        kind: "character",
        id: item.id,
        x1: item.x - 22 * zoom,
        y1: item.y - 68 * zoom,
        x2: item.x + 22 * zoom,
        y2: item.y + 6 * zoom,
      });
    }

    const scheduleHitboxes = drawAutoPausedMarkers(autoPausedSchedules || []);

    const holderMeta = browserQueue?.holder
      ? withSelection.find((i) => i.id === browserQueue.holder)?.meta
      : null;
    drawBrowserHolderNameplate(holderMeta);

    // ป้ายชื่อ (โซน + ตัวละคร) เป็น pass สุดท้ายเสมอ กันตัวละครแถวแรกบัง (spec §7.2)
    // ตัวที่ล้นที่นั่งของโซนไม่ได้ป้าย แต่ถูกนับเป็น +n ที่หัวโซน (ต้องนับก่อนวาดหัวโซน)
    const overflowByZone = {};
    for (const item of withSelection) {
      if (!item.meta.overflow) continue;
      overflowByZone[item.meta.zone] = (overflowByZone[item.meta.zone] || 0) + 1;
    }
    drawZoneLabels(overflowByZone);
    drawCharacterLabels(withSelection, hostNowMs);

    return [...hitboxes, ...scheduleHitboxes];
  }

  return { draw, W, H };
}
