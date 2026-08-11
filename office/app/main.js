// office/app/main.js
//
// Bootstrap: โหลด asset → ต่อ SSE (หรือโหลด dev-snapshot.json ตอน ?demo=1) → applySnapshot →
// requestAnimationFrame loop → วาด — เป็นจุดเดียวที่แตะ DOM/canvas/network (spec §7.1)
//
// ADR 0002: ห้ามมี fetch()/XHR ที่ไม่ใช่ GET, ห้ามมี <form>, ห้ามมี WebSocket — ไฟล์นี้มีแค่
// fetch() แบบ GET (dev-snapshot.json / asset manifest ผ่าน assets.js) กับ EventSource (อ่านอย่างเดียว)

"use strict";

import { buildZones, warnZoneOverlaps, DOOR_SLOT, worldPos } from "./layout.js";
import { createRoomState } from "./state.js";
import { loadAssets } from "./assets.js";
import { createRenderer, getClockInfo } from "./render.js";

const params = new URLSearchParams(location.search);
const isDemo = params.get("demo") === "1";

const zones = buildZones();
warnZoneOverlaps(zones); // self-check ตอน dev — เตือนเฉย ๆ ไม่ throw (spec §7.2)

const room = createRoomState(zones);

const canvas = document.getElementById("room");
const connStatusEl = document.getElementById("connStatus");
const overlayEl = document.getElementById("disconnectedOverlay");
const infocardEl = document.getElementById("infocard");
const cardBodyEl = document.getElementById("cardBody");
const btnCloseCard = document.getElementById("btnCloseCard");

let renderer = null;
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
} else {
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

// ---------------- โหลด asset แล้วเริ่ม render loop ----------------
loadAssets().then((assets) => {
  renderer = createRenderer({ canvas, zones, assets });
  requestAnimationFrame(loop);
});

function loop(t) {
  requestAnimationFrame(loop);
  if (!renderer) return;
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

// เผื่อโค้ดภายนอก/เทสต์ manual อยากอ่านตำแหน่งประตูจริงที่ใช้ (ไม่ได้ใช้ในแอปเอง)
void DOOR_SLOT;
void worldPos;
