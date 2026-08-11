// office/app/render.js
//
// วาดห้อง + ตัวละคร + ป้าย + เอฟเฟกต์ลง canvas 2D ล้วน (ไม่มี library — spec §7.1)
// รับ drawList จาก state.js (ตำแหน่งคำนวณแล้ว) แล้ววาดเป็นชั้น ๆ ตามลำดับที่ spec §7.2 บังคับ:
//   พื้น/เฟอร์นิเจอร์ → ตัวละคร (เรียงตาม y) → ป้ายชื่อโซน+ตัวละคร (pass สุดท้ายเสมอ กันตัวละครบัง)
//
// โหมด asset: ถ้า assets.mode === "sprites" ใช้ drawImage จาก manifest จริง
// ถ้าไม่ใช่ (placeholder) วาดตัวละครเป็นรูปทรงเรขาคณิตในกรอบ 64x64/tile 32px เดิมเป๊ะ

"use strict";

import { TILE, ZONE_IDS, pickCharacterFolder } from "./layout.js";

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

/** กว้างสูงสุด (px) ของป้ายชื่อตัวละครบนจอ — เผื่อกันป้ายทับกันเองตอนที่นั่งชิดกัน (ดู clipTextToWidth)
 *  108px ≈ ระยะห่างจริงระหว่างที่นั่ง 2 คอลัมน์ของ lounge/desks (โซนที่คนน่าจะอยู่พร้อมกันเยอะสุด) —
 *  โซนที่ชิดกว่านี้ (stopped/bug 3 คอลัมน์, คิว Browser) จะยังมีป้ายเบียดกันบ้างตอนเต็มทุกที่พร้อมกัน
 *  (เคสสุดขั้วเกินขนาดที่ระบบออกแบบไว้ ~10 ตัวละคร — ดูหมายเหตุใน commit) */
const CHARACTER_LABEL_MAX_WIDTH = 108;
/** ป้ายชื่อผู้ถือ Browser ที่โต๊ะ (บรรทัดเดียว ยาวกว่าปกติเพราะมีคำนำ/ต่อท้าย) กว้างได้เกือบเต็มโซน */
const BROWSER_HOLDER_LABEL_MAX_WIDTH = 176;
/** งบ (px) ขั้นต่ำที่ต้องเหลือให้ตัวข้อความหลักเสมอ แม้ `suffix` จะกว้างผิดคาด — กัน budget เหลือ 0
 *  แล้ว clipTextToWidth มองว่า "ไม่จำกัด" (`!maxWidth`) ซึ่งจะทำให้ป้ายกลับไปทับกันเองอีก */
const MIN_LABEL_TEXT_WIDTH = 24;

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

function tileRect([x, y, w, h]) {
  return [x * TILE, y * TILE, w * TILE, h * TILE];
}

export function createRenderer({ canvas, zones, assets }) {
  const ctx = canvas.getContext("2d");
  const W = 32 * TILE;
  const H = 16 * TILE;

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
    ctx.fillStyle = "#5b4327";
    ctx.fillRect(cx * TILE - 20, cy * TILE - 30, 40, 18);
    ctx.strokeStyle = "#2c2116";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx * TILE - 20, cy * TILE - 30, 40, 18);
    ctx.fillStyle = "#111318";
    ctx.fillRect(cx * TILE - 8, cy * TILE - 40, 16, 11);
    ctx.fillStyle = "rgba(120,200,255,0.45)";
    ctx.fillRect(cx * TILE - 6, cy * TILE - 38, 12, 7);
  }
  function drawSofa(cx, cy) {
    ctx.fillStyle = "#3b6a8f";
    roundRectPath(ctx, cx * TILE - 18, cy * TILE - 16, 36, 20, 6);
    ctx.fill();
    ctx.fillStyle = "#2c4f6b";
    ctx.fillRect(cx * TILE - 18, cy * TILE - 16, 36, 6);
  }
  function drawTable(cx, cy) {
    ctx.fillStyle = "#6b5220";
    ctx.beginPath();
    ctx.ellipse(cx * TILE, cy * TILE, 34, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3c2f13";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  function drawScreenProp(cx, cy) {
    ctx.fillStyle = "#111318";
    ctx.fillRect(cx * TILE - 14, cy * TILE - 26, 28, 20);
    ctx.fillStyle = "rgba(139,108,255,0.55)";
    ctx.fillRect(cx * TILE - 11, cy * TILE - 23, 22, 14);
  }
  function drawCracks(rect) {
    const [x, y, w, h] = tileRect(rect);
    ctx.strokeStyle = "rgba(0,0,0,.5)";
    ctx.lineWidth = 2;
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
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 12);
    ctx.lineTo(x + w - 8, y + 12);
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
    const cx = az.center.x * TILE;
    const cy = az.center.y * TILE;
    const pulse = 0.5 + 0.5 * Math.sin(now / 900);

    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 130 + pulse * 14);
    grad.addColorStop(0, `rgba(255,214,120,${0.32 + pulse * 0.1})`);
    grad.addColorStop(1, "rgba(255,214,120,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 130 + pulse * 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
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
    roundRectPath(ctx, cx - 92, cy - 52 + 6, 184, 108, 14);
    ctx.fill();
    ctx.fillStyle = "rgba(255,214,120,.18)";
    roundRectPath(ctx, cx - 92, cy - 52, 184, 108, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,214,120,.55)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, cx - 92, cy - 52, 184, 108, 14);
    ctx.stroke();

    drawTable(az.center.x, az.center.y);
  }

  function drawZoneFloors() {
    for (const id of ZONE_IDS) {
      const z = zones[id];
      const [x, y, w, h] = tileRect(z.rect);
      ctx.fillStyle = ZONE_FLOOR[id];
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(255,255,255,.06)";
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
    ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.ellipse(0, -2, 15, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fill();

    const bodyColor = meta.role ? ROLE_META[meta.role].color : STATE_META[meta.state]?.color || "#888";

    if (assets.mode === "sprites") {
      drawSpriteFrame(meta, dir);
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

  /** โหมด sprite จริง — geometry ทั้งหมดอ่านจาก manifest เท่านั้น ห้าม assume ขนาด/จำนวนเฟรม (spec §8.2) */
  function drawSpriteFrame(meta, dir) {
    const { manifest, characterImages, folders } = assets;
    const folder = folders[pickCharacterFolder(meta.id, folders.length)];
    const stateCfg = manifest.states?.[meta.state];
    const animName = stateCfg?.anim || "idle";
    const animDef = manifest.character.animations?.[animName];
    const resolvedAnimName = animDef?.fallback || animName;
    const img = characterImages[folder]?.[resolvedAnimName];
    if (!img) return; // ป้องกัน crash ถ้า manifest อ้างถึงไฟล์ที่โหลดไม่สำเร็จ
    const [fw, fh] = manifest.character.frameSize;
    const dirIndex = Math.max(0, (manifest.character.directions || []).indexOf(dir));
    const [offX, offY] = manifest.character.offset || [0, 0];
    const frameIndex = 0; // เฟรมแรกพอสำหรับ static snapshot (ไม่ animate ท่าเดินระหว่างยืนนิ่ง)
    const sx = offX + frameIndex * fw;
    const sy = offY + Math.max(0, dirIndex) * fh;
    ctx.drawImage(img, sx, sy, fw, fh, -fw / 2, -(manifest.character.anchor?.[1] ?? fh - 2), fw, fh);
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

  /** วาดป้ายเดี่ยว (ใช้ทั้งป้ายโซนและป้ายตัวละคร) — แผ่นรองสีทึบกันโดนบัง (spec §7.2 บั๊กที่เจอใน prototype)
   *  แต่ละบรรทัดตั้ง `maxWidth` (px) ได้เพื่อกันป้ายชนกันเองตอนที่นั่งชิดกัน (ดู clipTextToWidth ข้างบน) */
  function drawLabelPlate(cx, y, lines, opts = {}) {
    const { bold = false, sub = false, fg = "rgba(255,255,255,.92)", bg = "rgba(0,0,0,.6)" } = opts;
    ctx.textAlign = "center";
    let cursorY = y;
    for (const line of lines) {
      if (!line.text && !line.suffix) continue;
      ctx.font = line.font || (bold ? "bold 12px sans-serif" : sub ? "10px sans-serif" : "600 11px sans-serif");
      // `suffix` คือส่วนท้ายที่ต้องรอดจากการตัดเสมอ (นาฬิกา) — ตัดเฉพาะ `line.text` ในงบที่เหลือ
      // ถ้าเอาสองส่วนมาต่อกันก่อนแล้วค่อยตัด ชื่อเธรดภาษาไทยความยาวปกติจะกินงบ 108px หมดตั้งแต่ชื่อ
      // แล้วนาฬิกาซึ่งอยู่ท้ายสุดจะถูกตัดทิ้งทุกป้ายในห้อง (สังเกตว่า `ctx.font` ต้องถูกตั้งก่อนวัด)
      const suffix = line.suffix || "";
      const budget = line.maxWidth
        ? Math.max(MIN_LABEL_TEXT_WIDTH, line.maxWidth - ctx.measureText(suffix).width)
        : line.maxWidth;
      const text = clipTextToWidth(ctx, line.text || "", budget) + suffix;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = line.bg || bg;
      roundRectPath(ctx, cx - tw / 2 - 5, cursorY - 12, tw + 10, 15, 5);
      ctx.fill();
      ctx.fillStyle = line.fg || fg;
      ctx.fillText(text, cx, cursorY);
      cursorY += 14;
    }
    return cursorY;
  }

  function drawZoneLabels(now) {
    for (const id of ZONE_IDS) {
      const z = zones[id];
      const [x, y, w] = tileRect(z.rect);
      const isApproval = id === "approval";
      drawLabelPlate(x + w / 2, y + (isApproval ? 20 : 16), [
        {
          text: `${z.icon} ${z.label}`,
          font: isApproval ? "bold 15px sans-serif" : "600 12px sans-serif",
          fg: isApproval ? "#ffe6a8" : "rgba(255,255,255,.92)",
          bg: isApproval ? "rgba(74,58,18,.78)" : "rgba(0,0,0,.55)",
        },
        isApproval
          ? {
              text: "จุดที่ต้องการคนตัดสินใจ",
              font: "11px sans-serif",
              fg: "rgba(255,230,168,.95)",
              bg: "rgba(74,58,18,.65)",
            }
          : null,
      ].filter(Boolean));
    }
    {
      const [x, y, w, h] = tileRect(zones.browser.rect);
      drawLabelPlate(x + w / 2, y + h - 6, [
        { text: "FIFO: มาก่อนได้ก่อน", font: "10px sans-serif", bg: "rgba(0,0,0,.5)", fg: "rgba(255,255,255,.85)" },
      ]);
    }
  }

  /** โต๊ะ Browser แสดงป้ายชื่อผู้ถือเสมอ แม้ตัวถือจะไปยืนที่โซน Approval (P2 > P3 — spec §7.3) */
  function drawBrowserHolderNameplate(holderMeta) {
    if (!holderMeta) return;
    const slot = zones.browser.holderSlot;
    const cx = slot.x * TILE;
    const cy = slot.y * TILE;
    if (holderMeta.zone === "browser") return; // อยู่ที่โต๊ะอยู่แล้ว ป้ายตัวละครพอ ไม่ต้องซ้ำ
    drawLabelPlate(cx, cy + 30, [
      {
        text: `🌐 ${holderMeta.label} (ถือ Browser)`,
        font: "bold 10px sans-serif",
        bg: "rgba(139,108,255,.55)",
        maxWidth: BROWSER_HOLDER_LABEL_MAX_WIDTH,
      },
    ]);
  }

  // ป้าย/marker ของ Schedule auto-pause — สีนิ่ง ไม่พัลส์ (เอฟเฟกต์ที่ขึ้นกับเวลามีได้เฉพาะโซน Approval, spec §7.4)
  function drawAutoPausedMarkers(markers) {
    const hitboxes = [];
    const [bx, by] = zones.bug.rect;
    markers.forEach((m, i) => {
      const cx = (bx + 0.9 + i * 1.7) * TILE;
      const cy = (by + 0.7) * TILE;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
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
      hitboxes.push({ kind: "schedule", id: m.id, x1: cx - 14, y1: cy - 14, x2: cx + 14, y2: cy + 14 });
    });
    if (markers.length) {
      drawLabelPlate((bx + 0.9) * TILE, (by + 1.6) * TILE, [
        { text: "Schedule auto-pause", font: "9px sans-serif", bg: "rgba(0,0,0,.55)" },
      ]);
    }
    return hitboxes;
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
    drawZoneFloors();
    drawDecorations(t);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    const withSelection = drawList.map((item) => ({ ...item, selected: item.id === selectedId }));
    const hitboxes = [];
    for (const item of withSelection) {
      drawCharacterSprite(item);
      hitboxes.push({
        kind: "character",
        id: item.id,
        x1: item.x - 22,
        y1: item.y - 68,
        x2: item.x + 22,
        y2: item.y + 6,
      });
    }

    const holderMeta = browserQueue?.holder
      ? withSelection.find((i) => i.id === browserQueue.holder)?.meta
      : null;
    drawBrowserHolderNameplate(holderMeta);

    // ป้ายชื่อ (โซน + ตัวละคร) เป็น pass สุดท้ายเสมอ กันตัวละครแถวแรกบัง (spec §7.2)
    drawZoneLabels(t);
    for (const item of withSelection) {
      const clock = getClockInfo({ ...item.meta, zone: item.meta.zone }, hostNowMs);
      const clockGlyph = clock.countdown ? "⏳" : "⏱";
      ctx.globalAlpha = item.alpha;
      drawLabelPlate(item.x, item.y + 16, [
        {
          text: item.meta.label,
          // นาฬิกาเป็น `suffix` ไม่ใช่ส่วนหนึ่งของ text — ห้ามให้ชื่อเธรดยาว ๆ ตัดมันทิ้ง (spec §5.6)
          suffix: `  ${clockGlyph}${clock.text}`,
          font: "600 10px sans-serif",
          maxWidth: CHARACTER_LABEL_MAX_WIDTH,
        },
        item.meta.headline
          ? {
              text: item.meta.headline,
              font: "9px sans-serif",
              fg: "rgba(255,255,255,.75)",
              maxWidth: CHARACTER_LABEL_MAX_WIDTH,
            }
          : null,
      ].filter(Boolean));
      ctx.globalAlpha = 1;
    }

    const scheduleHitboxes = drawAutoPausedMarkers(autoPausedSchedules || []);
    return [...hitboxes, ...scheduleHitboxes];
  }

  return { draw, W, H };
}
