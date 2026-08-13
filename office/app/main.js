// office/app/main.js
//
// Bootstrap: โหลด asset → ต่อ SSE (หรือโหลด dev-snapshot.json ตอน ?demo=1) → applySnapshot →
// requestAnimationFrame loop → วาด — เป็นจุดเดียวที่แตะ DOM/canvas/network (spec §7.1)
//
// ADR 0002: ห้ามมี fetch()/XHR ที่ไม่ใช่ GET, ห้ามมี <form>, ห้ามมี WebSocket — ไฟล์นี้มีแค่
// fetch() แบบ GET (dev-snapshot.json / asset manifest ผ่าน assets.js) กับ EventSource (อ่านอย่างเดียว)

"use strict";

import {
  buildZones,
  warnZoneOverlaps,
  warnLabelFits,
  doorSlotFor,
  roomSizeFromMap,
  zoneRectsFromMap,
  chooseTilePx,
} from "./layout.js";
import { createRoomState } from "./state.js";
import { loadAssets, placeholderAssets } from "./assets.js";
import { createRenderer, getClockInfo } from "./render.js";

const params = new URLSearchParams(location.search);
const isDemo = params.get("demo") === "1";

const canvas = document.getElementById("room");
const stageEl = document.querySelector(".stage");
const connStatusEl = document.getElementById("connStatus");
const overlayEl = document.getElementById("disconnectedOverlay");
const infocardEl = document.getElementById("infocard");
const cardBodyEl = document.getElementById("cardBody");
const btnCloseCard = document.getElementById("btnCloseCard");
const btnFullscreen = document.getElementById("btnFullscreen");
const btnExitFullscreen = document.getElementById("btnExitFullscreen");

/** ทุกตัวนี้ถูกประกอบใน bootstrap() หลัง asset โหลดเสร็จเท่านั้น — ก่อนหน้านั้นยังไม่มีห้องให้แตะ */
let zones = null;
let room = null;
let renderer = null;
let assets = null;
let roomSize = null;
/** px ต่อ tile ที่ห้องกำลังวาดอยู่จริง (0 = ยังไม่ได้ประกอบห้อง) */
let tilePx = 0;
/** devicePixelRatio ตอนประกอบ renderer ครั้งล่าสุด — เปลี่ยนเมื่อไรต้องประกอบใหม่ (ดู relayoutRoom) */
let lastDpr = 0;
let latestSnapshot = null;
let currentHitboxes = [];
let selectedId = null;
let selectedKind = null; // "character" | "schedule"

function setConnected(ok) {
  overlayEl.hidden = ok;
  connStatusEl.textContent = ok ? "เชื่อมต่ออยู่" : "ขาดการเชื่อมต่อ";
  connStatusEl.classList.toggle("conn-ok", ok);
  connStatusEl.classList.toggle("conn-bad", !ok);
}

function handleSnapshot(snapshot) {
  latestSnapshot = snapshot;
  const now = Date.now();
  room.applySnapshot(snapshot, now);
  setConnected(true);
  if (selectedId) refreshInfoCard();
}

// ---------------- แหล่งข้อมูล: demo mode หรือ SSE จริง ----------------
// เรียก **หลัง** ห้องถูกประกอบเสร็จเท่านั้น (handleSnapshot แตะ room ทันทีที่ snapshot แรกมาถึง)
function connectDataSource() {
  if (isDemo) {
    fetch("./dev-snapshot.json", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(handleSnapshot)
      .catch((err) => {
        console.error("[office-ui] โหลด dev-snapshot.json ไม่สำเร็จ:", err);
        setConnected(false);
      });
    return;
  }
  setConnected(false); // ยังไม่มี snapshot แรกจนกว่า SSE จะส่งมา
  const es = new EventSource("/events");
  es.addEventListener("snapshot", (evt) => {
    try {
      handleSnapshot(JSON.parse(evt.data));
    } catch (err) {
      console.error("[office-ui] parse snapshot จาก SSE ไม่สำเร็จ:", err);
    }
  });
  es.onerror = () => setConnected(false); // EventSource reconnect เองอัตโนมัติ
}

// ---------------- ขนาดห้อง: กินพื้นที่ที่มีให้เต็ม แล้วคำนวณใหม่ทุกครั้งที่พื้นที่เปลี่ยน ----------------
//
// ห้ามยืด canvas ด้วย CSS เด็ดขาด (ตัวหนังสือไทยจะเบลอ สระบน/ล่างเละก่อนใคร) — วิธีเดียวที่ถูกคือ
// เพิ่ม tilePx แล้ววาดใหม่ทั้งห้องที่ความละเอียดจริง แล้วให้ canvas มีขนาด CSS เท่าขนาดที่วาดพอดี 1:1
// (renderer.setupCanvas คูณ devicePixelRatio ให้อีกชั้นเอง)

/**
 * พื้นที่ว่างจริงที่ห้องมีให้ใช้ = กล่องของ .stage หัก padding/border ของมันเอง
 *
 * วัดจาก getBoundingClientRect() (กล่อง **border-box** ซึ่งไม่ขึ้นกับว่ามี scrollbar ไหม) ไม่ใช่
 * clientWidth — clientWidth จะหดลงเมื่อ scrollbar โผล่ ซึ่งทำให้ tilePx เล็กลง → scrollbar หาย →
 * tilePx โตขึ้น → วนไปมาไม่จบ (`.stage` ตั้ง min-width/min-height: 0 ไว้ กันไม่ให้กล่องโตตาม canvas)
 */
function availableRoomBox() {
  const rect = stageEl.getBoundingClientRect();
  const cs = getComputedStyle(stageEl);
  const num = (v) => parseFloat(v) || 0;
  const insetX = num(cs.paddingLeft) + num(cs.paddingRight) + num(cs.borderLeftWidth) + num(cs.borderRightWidth);
  const insetY = num(cs.paddingTop) + num(cs.paddingBottom) + num(cs.borderTopWidth) + num(cs.borderBottomWidth);
  return { availW: rect.width - insetX, availH: rect.height - insetY };
}

/** tilePx ที่ควรใช้กับพื้นที่ ณ ตอนนี้ — กติกาการเลือกอยู่ใน chooseTilePx() (pure, มีเทสต์) */
function pickTilePx() {
  const { availW, availH } = availableRoomBox();
  return chooseTilePx({
    availW,
    availH,
    cols: roomSize.cols,
    rows: roomSize.rows,
    baseTilePx: assets.tilePx,
  });
}

/**
 * ประกอบห้องใหม่ที่ tilePx ปัจจุบัน — เรียกซ้ำได้ตลอด (resize / เข้า-ออกโหมดเต็มจอ)
 * renderer สร้างใหม่ทั้งตัว (ไม่มี state ให้เสีย) ส่วน roomState แค่สเกลพิกัดในแคช ⇒ ตัวละคร
 * ไปโผล่ที่นั่งเดิมในห้องขนาดใหม่ทันที ไม่มี glide ไม่มีเดินเข้าประตูใหม่
 */
function relayoutRoom() {
  if (!zones || !room) return;
  const next = pickTilePx();
  const dpr = window.devicePixelRatio || 1;
  // dpr เปลี่ยนได้โดยขนาดห้องไม่เปลี่ยน (ลากหน้าต่างข้ามจอคนละความละเอียด / ผู้ใช้ซูมหน้าเว็บ) —
  // ต้องประกอบใหม่ด้วย ไม่งั้น backing store ค้างที่ความละเอียดของจอเดิมแล้วภาพเบลอ
  if (next === tilePx && dpr === lastDpr) return;
  tilePx = next;
  lastDpr = dpr;
  room.setTilePx(tilePx);
  renderer = createRenderer({ canvas, zones, assets, roomSize, tilePx });
}

let relayoutQueued = false;
/** รวบการเปลี่ยนขนาดหลาย ๆ ครั้งใน 1 เฟรม (ResizeObserver ยิงถี่มากตอนลากขอบหน้าต่าง) */
function scheduleRelayout() {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => {
    relayoutQueued = false;
    relayoutRoom();
  });
}

// ---------------- bootstrap: asset ก่อน แล้วค่อยประกอบห้อง แล้วค่อยรับข้อมูล ----------------
// ลำดับนี้บังคับตัวเอง: เรขาคณิตของห้อง (tileSize/scale จาก manifest + zone rect จาก map.json)
// ต้องรู้ผลก่อนสร้าง zones/roomState/renderer ไม่งั้นห้องถูกสร้างด้วยค่า default แล้วชุด custom
// ที่ประกาศ tileSize อื่นจะเพี้ยนทั้งห้อง (spec §8.2 "โค้ดห้าม assume ขนาด")
async function bootstrap() {
  try {
    assets = await loadAssets();
  } catch (err) {
    // loadAssets() ดัก error ของตัวเองหมดแล้ว มาถึงตรงนี้ได้แปลว่าเป็นบั๊ก — แต่ยังต้องไม่จอขาว
    console.error("[office-ui] bootstrap asset ล้มเหลวผิดคาด ใช้ placeholder แทน:", err);
    assets = placeholderAssets();
  }

  roomSize = roomSizeFromMap(assets.map);
  const door = doorSlotFor(roomSize.cols, roomSize.rows);

  zones = buildZones(zoneRectsFromMap(assets.map));
  warnZoneOverlaps(zones); // self-check ตอน dev — เตือนเฉย ๆ ไม่ throw (spec §7.2)
  // rect จาก map.json ที่เล็กกว่าที่กล่องป้ายขนาดตายตัวต้องการ จะทำให้ป้ายล้นออกนอกโซน — เตือนไว้
  // (layout.test.js ตรวจชุด rect ที่ ship จริงอยู่แล้ว อันนี้ครอบชุด custom ที่เทสต์มองไม่เห็น)
  // เช็คที่ขนาด tile ต้นฉบับเพราะเป็นค่าที่ "ตึง" ที่สุด — ห้องที่ขยายแล้วมีที่เหลือให้ป้ายมากกว่าเสมอ
  warnLabelFits(zones, assets.tilePx);

  restoreFullscreenPreference(); // ต้องทำก่อนวัดพื้นที่ ไม่งั้นวัดได้กล่องของโหมดที่ผู้ใช้ไม่ได้เลือก
  tilePx = pickTilePx();
  lastDpr = window.devicePixelRatio || 1;

  room = createRoomState(zones, { tilePx, door });
  renderer = createRenderer({ canvas, zones, assets, roomSize, tilePx });

  // ห้องขยาย/หดตามพื้นที่จริงของ .stage — ครอบทั้งย่อขยายหน้าต่างและการซ่อน header/แผงข้าง
  new ResizeObserver(scheduleRelayout).observe(stageEl);
  window.addEventListener("resize", scheduleRelayout);

  requestAnimationFrame(loop);
  connectDataSource();
}

bootstrap();

function loop(t) {
  requestAnimationFrame(loop);
  if (!renderer || !room) return;
  const now = Date.now();
  const hostNow = room.estimateHostNow(now);
  const drawList = room.getDrawList(now);
  currentHitboxes = renderer.draw(
    drawList,
    hostNow,
    latestSnapshot?.browserQueue ?? { holder: null, waiting: [] },
    latestSnapshot?.autoPausedSchedules ?? [],
    selectedId,
    t,
  );
}

// ---------------- คลิก: การ์ดข้อมูล read-only เท่านั้น (ห้ามมีปุ่มสั่งงานใด ๆ — ADR 0002) ----------------
function toCanvasCoords(evt) {
  const rect = canvas.getBoundingClientRect();
  const sx = renderer.W / rect.width;
  const sy = renderer.H / rect.height;
  return { x: (evt.clientX - rect.left) * sx, y: (evt.clientY - rect.top) * sy };
}

function findHit(pos) {
  for (let i = currentHitboxes.length - 1; i >= 0; i--) {
    const b = currentHitboxes[i];
    if (pos.x >= b.x1 && pos.x <= b.x2 && pos.y >= b.y1 && pos.y <= b.y2) return b;
  }
  return null;
}

canvas.addEventListener("mousemove", (evt) => {
  if (!renderer) return;
  const hit = findHit(toCanvasCoords(evt));
  canvas.style.cursor = hit ? "pointer" : "default";
});

canvas.addEventListener("click", (evt) => {
  if (!renderer) return;
  const hit = findHit(toCanvasCoords(evt));
  if (!hit) {
    hideInfoCard();
    return;
  }
  selectedId = hit.id;
  selectedKind = hit.kind;
  refreshInfoCard();
});

function findCharacter(id) {
  const snap = latestSnapshot;
  if (!snap) return null;
  return (
    (snap.sessions || []).find((c) => c.id === id) ||
    (snap.scheduleRuns || []).find((c) => c.id === id) ||
    (snap.outcomeFeed || []).find((c) => c.id === id) ||
    null
  );
}

function findSchedule(id) {
  return (latestSnapshot?.autoPausedSchedules || []).find((s) => s.id === id) || null;
}

const STATE_LABEL = {
  idle: { text: "ว่าง", icon: "💤", color: "#5aa9e6" },
  working: { text: "กำลังทำงาน", icon: "💻", color: "#4caf7d" },
  approval: { text: "รอ Approval", icon: "✋", color: "#f5b83d" },
  failed: { text: "ล้มเหลว", icon: "🐞", color: "#e5484d" },
  stopped: { text: "ถูกสั่งหยุด", icon: "⏸", color: "#9096a3" },
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function fmtEpoch(ms) {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString("th-TH");
}

function refreshInfoCard() {
  if (selectedKind === "schedule") {
    const s = findSchedule(selectedId);
    if (!s) return hideInfoCard();
    cardBodyEl.innerHTML = `
      <div class="row"><span>Schedule</span><span>${escapeHtml(s.name)}</span></div>
      <div class="row"><span>id</span><span>${escapeHtml(s.id)}</span></div>
      <div class="row"><span>สถานะ</span><span>⏸ auto-pause (ล้มติดกัน ${s.consecutiveFailures} รอบ)</span></div>
      <div class="row"><span>รอบถัดไป</span><span>${fmtEpoch(s.nextRunAt)}</span></div>
      ${
        s.threadUrl
          ? `<a class="link" href="${escapeHtml(s.threadUrl)}" target="_blank" rel="noopener">🧵 เปิดเธรดใน Discord ↗</a>`
          : `<div class="legend-note">ไม่พบลิงก์เธรด</div>`
      }
    `;
    infocardEl.hidden = false;
    return;
  }

  const char = findCharacter(selectedId);
  if (!char) return hideInfoCard();

  const now = Date.now();
  const hostNow = room.estimateHostNow(now);
  // zone/role มาจาก cache ล่าสุด (มี browserBadge/queuePos ที่ derive แล้ว) ถ้าไม่มีให้ fallback เบา ๆ
  const cached = room._posCache.get(char.id)?.meta;
  const zoneMeta = cached || { zone: null, role: null, deadlineAt: char.deadlineAt, since: char.since };
  const clock = getClockInfo({ ...char, ...zoneMeta }, hostNow);
  const sm = STATE_LABEL[char.state] || { text: char.state, icon: "•", color: "#888" };
  const kindLabel = char.kind === "run" ? "🔁 Schedule Run" : "🧵 Task";

  const approvalsHtml = (char.approvals || [])
    .map(
      (a) => `<div class="approval-item"><b>${escapeHtml(a.tool)}</b><br>${escapeHtml(a.summary)}</div>`,
    )
    .join("");

  const outcomeHtml = char.outcome
    ? `<div class="row"><span>ผลจบ</span><span>${char.outcome.status === "failed" ? "ล้มเหลว" : "ถูกขัดจังหวะ"}</span></div>
       <div class="row"><span>เหตุผล</span><span>${escapeHtml(char.outcome.reason || "—")}</span></div>
       <div class="row"><span>จบเมื่อ</span><span>${fmtEpoch(char.outcome.endedAt)}</span></div>`
    : "";

  cardBodyEl.innerHTML = `
    <div class="row"><span>ชื่อ</span><span>${escapeHtml(char.name)}</span></div>
    <div class="row"><span>ประเภท</span><span>${kindLabel}</span></div>
    <div class="row"><span>สถานะ</span>
      <span class="state-chip" style="background:${sm.color}22;color:${sm.color}">${sm.icon} ${sm.text}</span>
    </div>
    ${char.detail ? `<div class="row"><span>รายละเอียด</span><span>${escapeHtml(char.detail)}</span></div>` : ""}
    ${char.headline ? `<div class="row"><span>Headline</span><span>${escapeHtml(char.headline)}</span></div>` : ""}
    <div class="row"><span>นาฬิกา</span><span>${clock.countdown ? "⏳ เหลือ " : "⏱ ผ่านมา "}${clock.text}</span></div>
    <div class="row"><span>Workspace</span><span>${escapeHtml(char.workspace || "—")}</span></div>
    <div class="row"><span>Model</span><span>${escapeHtml(char.model || "—")}</span></div>
    ${approvalsHtml}
    ${outcomeHtml}
    ${
      char.threadUrl
        ? `<a class="link" href="${escapeHtml(char.threadUrl)}" target="_blank" rel="noopener">🧵 เปิดเธรดใน Discord ↗</a>`
        : `<div class="legend-note">ไม่พบลิงก์เธรด (หาเธรดไม่เจอ)</div>`
    }
  `;
  infocardEl.hidden = false;
}

function hideInfoCard() {
  selectedId = null;
  selectedKind = null;
  infocardEl.hidden = true;
}

btnCloseCard.addEventListener("click", hideInfoCard);

// ---------------- โหมดเต็มจอ: ซ่อนหัวข้อ/แผงข้าง ให้ห้องกินทั้งหน้าต่าง ----------------
// สองชั้นแยกกันโดยตั้งใจ:
//   1. คลาส `room-fullscreen` บน <body> = ซ่อน header/แผงข้าง/footer — ทำงานได้เสมอ และ **จำไว้ได้**
//   2. Fullscreen API ของเบราว์เซอร์ (ซ่อนแถบ URL ด้วย) = ขอเพิ่มได้เฉพาะตอนมี user gesture
// ที่ต้องแยกเพราะเบราว์เซอร์ทุกเจ้าบล็อก requestFullscreen ที่ไม่ได้มาจากการกดของผู้ใช้ ⇒ ตอนโหลดหน้า
// ใหม่เราคืนได้แค่ชั้นที่ 1 (ซึ่งก็คือ "ห้องเต็มหน้าต่าง" ตามที่ขอไว้แล้ว)

const FULLSCREEN_KEY = "office-ui:room-fullscreen";

function isRoomFullscreen() {
  return document.body.classList.contains("room-fullscreen");
}

function rememberFullscreen(on) {
  try {
    localStorage.setItem(FULLSCREEN_KEY, on ? "1" : "0");
  } catch (err) {
    // โหมดส่วนตัว/ปิด storage — แค่จำข้ามรอบไม่ได้ ไม่ใช่เหตุให้โหมดเต็มจอใช้ไม่ได้
  }
}

function applyFullscreen(on) {
  document.body.classList.toggle("room-fullscreen", on);
  if (btnFullscreen) btnFullscreen.setAttribute("aria-pressed", String(on));
  scheduleRelayout(); // พื้นที่เพิ่ง (หด/ขยาย) → คำนวณ tilePx ใหม่ทันที
}

function setFullscreen(on) {
  applyFullscreen(on);
  rememberFullscreen(on);
  if (on) {
    // ปฏิเสธได้เป็นเรื่องปกติ (iframe / นโยบายเบราว์เซอร์) — ชั้นที่ 1 ทำงานไปแล้ว ไม่ต้องทำอะไรต่อ
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

function restoreFullscreenPreference() {
  let saved = null;
  try {
    saved = localStorage.getItem(FULLSCREEN_KEY);
  } catch (err) {
    saved = null;
  }
  if (saved === "1") applyFullscreen(true);
}

btnFullscreen?.addEventListener("click", () => setFullscreen(!isRoomFullscreen()));
btnExitFullscreen?.addEventListener("click", () => setFullscreen(false));

window.addEventListener("keydown", (evt) => {
  // ตอนอยู่ใน native fullscreen เบราว์เซอร์กิน Esc ไปเองและยิง fullscreenchange แทน (ดักไว้ข้างล่าง)
  // ที่นี่คือเคสโหมดเต็มหน้าต่างล้วน (คืนจาก localStorage หรือ requestFullscreen ถูกปฏิเสธ)
  if (evt.key === "Escape" && isRoomFullscreen()) setFullscreen(false);
});

document.addEventListener("fullscreenchange", () => {
  // ผู้ใช้กด Esc/ปุ่มของเบราว์เซอร์ออกจาก native fullscreen → ออกจากโหมดห้องเต็มจอตามให้สองชั้นตรงกัน
  if (!document.fullscreenElement && isRoomFullscreen()) {
    applyFullscreen(false);
    rememberFullscreen(false);
  }
});
