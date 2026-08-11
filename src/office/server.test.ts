/**
 * Run with: npx tsx src/office/server.test.ts
 *
 * ยืนยันสัญญาของ Office UI server (spec §3) โดยไม่ต้องมี Bot จริง — ใช้ `snapshot: () => fake`
 * ที่แก้ค่าได้ระหว่างเทสต์ และ port 0 (ให้ OS เลือกให้) เพื่อไม่ให้ชนกับอะไรบนเครื่อง
 *
 * สองข้อที่เป็นเกณฑ์ read-only ตาม ADR 0002 (spec §2 ข้อ 5) และห้ามหายไปจากไฟล์นี้:
 *  - `POST /state` (และ method อื่นที่เปลี่ยนสถานะ) ต้องได้ `405`
 *  - เส้นทางที่ชี้ออกนอกโฟลเดอร์ `office/` ต้องได้ `404` ทั้งแบบดิบและแบบ percent-encoded
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startOfficeUi } from "./server.js";
import { SNAPSHOT_VERSION, type Character, type OfficeSnapshot } from "./types.js";

let failures = 0;

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── ไฟล์หน้าเว็บ ────────────────────────────────────────────────────────────────
// หน้าเว็บจริงเป็นงานของ ticket อื่น เทสต์นี้จึงวางไฟล์ชั่วคราวให้เองเมื่อยังไม่มี แล้วเก็บกวาดตอนจบ
// (ถ้าของจริงมาแล้วจะไม่แตะไฟล์ของใครเลย)
const officeRoot = resolve(fileURLToPath(new URL("../../office/", import.meta.url)));
const indexFile = join(officeRoot, "index.html");
const madeRoot = !existsSync(officeRoot);
if (madeRoot) mkdirSync(officeRoot, { recursive: true });
const madeIndex = !existsSync(indexFile);
if (madeIndex) writeFileSync(indexFile, "<!doctype html>\n<title>office ui</title>\n");

process.on("exit", () => {
  if (madeIndex) rmSync(indexFile, { force: true });
  if (madeRoot) rmSync(officeRoot, { recursive: true, force: true });
});

// ── ตัวช่วยยิง request ดิบ ──────────────────────────────────────────────────────
// ใช้ `node:http` ตรง ๆ ไม่ใช้ `fetch` เพราะ WHATWG URL ยุบ `..` และ `%2e%2e` ทิ้งตั้งแต่ฝั่ง client
// (เทสต์ path traversal จะกลายเป็นเทสต์หลอกทันที) และ `agent: false` กัน keep-alive ค้างข้ามเคส
type RawResponse = { status: number; headers: IncomingHttpHeaders; body: string };

function raw(port: number, method: string, path: string): Promise<RawResponse> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () =>
        done({ status: res.statusCode ?? 0, headers: res.headers, body }),
      );
    });
    req.on("error", fail);
    req.end();
  });
}

/** สาย SSE หนึ่งเส้นที่อ่านทีละเฟรม (คั่นด้วยบรรทัดว่าง) */
type SseClient = {
  /** เฟรมถัดไป หรือ `undefined` เมื่อครบเวลาแล้วยังเงียบอยู่ */
  next(timeoutMs: number): Promise<string | undefined>;
  close(): void;
};

function openSse(port: number): Promise<SseClient> {
  return new Promise((done, fail) => {
    const pending: string[] = [];
    let waiter: ((frame: string) => void) | undefined;
    let buffer = "";

    const req = httpRequest(
      { host: "127.0.0.1", port, method: "GET", path: "/events", agent: false },
      (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(String(res.headers["content-type"]), /text\/event-stream/);
        assert.equal(res.headers["cache-control"], "no-store");
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          for (let cut = buffer.indexOf("\n\n"); cut !== -1; cut = buffer.indexOf("\n\n")) {
            const frame = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const hand = waiter;
            waiter = undefined;
            if (hand) hand(frame);
            else pending.push(frame);
          }
        });
        done({
          next: (timeoutMs) => {
            const buffered = pending.shift();
            if (buffered !== undefined) return Promise.resolve(buffered);
            return new Promise((settle) => {
              const timer = setTimeout(() => {
                waiter = undefined;
                settle(undefined);
              }, timeoutMs);
              timer.unref();
              waiter = (frame) => {
                clearTimeout(timer);
                settle(frame);
              };
            });
          },
          close: () => req.destroy(),
        });
      },
    );
    req.on("error", fail);
    req.end();
  });
}

/** เฟรม snapshot ถัดไป (ข้าม `retry:` กับ `:ping` ที่ไม่ใช่ snapshot) */
async function nextSnapshot(
  client: SseClient,
  timeoutMs: number,
): Promise<OfficeSnapshot | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;
    const frame = await client.next(remaining);
    if (frame === undefined) return undefined;
    if (!frame.startsWith("event: snapshot")) continue;
    const data = frame.split("\n").find((line) => line.startsWith("data: "));
    if (!data) continue;
    return JSON.parse(data.slice("data: ".length)) as OfficeSnapshot;
  }
}

// ── snapshot ปลอม ──────────────────────────────────────────────────────────────
function fakeSnapshot(overrides: Partial<OfficeSnapshot> = {}): OfficeSnapshot {
  return {
    v: SNAPSHOT_VERSION,
    now: Date.now(),
    sessions: [],
    scheduleRuns: [],
    outcomeFeed: [],
    browserQueue: { holder: null, heldSince: null, waiting: [] },
    autoPausedSchedules: [],
    ...overrides,
  };
}

function fakeCharacter(id: string): Character {
  return {
    id,
    kind: "task",
    state: "working",
    detail: null,
    name: "แก้บั๊ก /status",
    headline: "กำลังใช้ Bash",
    threadId: id,
    threadUrl: null,
    since: 1_754_467_100_000,
    deadlineAt: null,
    workspace: "/tmp/workspace",
    model: "sonnet",
    approvals: [],
    outcome: null,
  };
}

type Fixture = {
  port: number;
  /** เปลี่ยน state ที่ `snapshot()` คืน — เหมือนบอทมีงานใหม่เข้ามา */
  set(next: OfficeSnapshot): void;
  close(): Promise<void>;
};

async function startFixture(initial: OfficeSnapshot = fakeSnapshot()): Promise<Fixture> {
  let current = initial;
  // ประทับ `now` ใหม่ทุกครั้งที่ถูกเรียก — ถ้า server ไม่ตัด `now` ก่อนเทียบ diff เทสต์
  // "state ไม่เปลี่ยน = ไม่มีก้อนใหม่" จะตกทันที (spec §3.4)
  const handle = await startOfficeUi({
    port: 0,
    snapshot: () => ({ ...current, now: Date.now() }),
  });
  assert.ok(handle, "server ต้องเปิดขึ้นได้ที่ port 0");
  return {
    port: handle.port,
    set: (next) => {
      current = next;
    },
    close: () => handle.close(),
  };
}

console.log("เสิร์ฟไฟล์หน้าเว็บ");

await check("GET / คืน index.html เป็น HTML และห้าม cache", async () => {
  const server = await startFixture();
  try {
    const res = await raw(server.port, "GET", "/");
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-type"]), /^text\/html/);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(res.body.length > 0, "ต้องมีเนื้อไฟล์จริง");
  } finally {
    await server.close();
  }
});

await check("HEAD / ได้ header เหมือนกันแต่ไม่มี body", async () => {
  const server = await startFixture();
  try {
    const res = await raw(server.port, "HEAD", "/");
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-type"]), /^text\/html/);
    assert.equal(res.body, "");
  } finally {
    await server.close();
  }
});

await check("path ที่ไม่มีจริงได้ 404 ไม่ fallback ไป index.html", async () => {
  const server = await startFixture();
  try {
    const res = await raw(server.port, "GET", "/assets/custom/manifest.json");
    assert.equal(res.status, 404, "loader ของ asset ใช้ 404 เป็นสัญญาณว่าไม่มีชุด custom/");
    assert.doesNotMatch(res.body, /<!doctype html>/i);
  } finally {
    await server.close();
  }
});

console.log("\nread-only ตาม ADR 0002");

await check("POST /state ได้ 405 พร้อมบอกว่ารับแค่ GET/HEAD", async () => {
  const server = await startFixture();
  try {
    const res = await raw(server.port, "POST", "/state");
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, "GET, HEAD");
  } finally {
    await server.close();
  }
});

await check("PUT / PATCH / DELETE ก็ได้ 405 เหมือนกันทุกเส้นทาง", async () => {
  const server = await startFixture();
  try {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      for (const path of ["/", "/state", "/events"]) {
        const res = await raw(server.port, method, path);
        assert.equal(res.status, 405, `${method} ${path} ต้องได้ 405`);
      }
    }
  } finally {
    await server.close();
  }
});

await check("/../package.json ออกไปนอก office/ ไม่ได้ (404)", async () => {
  const server = await startFixture();
  try {
    const res = await raw(server.port, "GET", "/../package.json");
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.body, /discord-claude-agent-bot/, "ห้ามหลุดเนื้อไฟล์นอก office/");
  } finally {
    await server.close();
  }
});

await check("/%2e%2e/package.json (encode มาแล้ว) ก็ยัง 404", async () => {
  const server = await startFixture();
  try {
    const res = await raw(server.port, "GET", "/%2e%2e/package.json");
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.body, /discord-claude-agent-bot/, "ห้ามหลุดเนื้อไฟล์นอก office/");
  } finally {
    await server.close();
  }
});

console.log("\nsnapshot ผ่าน /state และ /events");

await check("GET /state คืน JSON ที่ parse ได้", async () => {
  const server = await startFixture(fakeSnapshot({ sessions: [fakeCharacter("1417")] }));
  try {
    const res = await raw(server.port, "GET", "/state");
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-type"]), /^application\/json/);
    assert.equal(res.headers["cache-control"], "no-store");
    const payload = JSON.parse(res.body) as OfficeSnapshot;
    assert.equal(payload.v, SNAPSHOT_VERSION);
    assert.equal(payload.sessions[0]?.id, "1417");
    assert.equal(typeof payload.now, "number");
  } finally {
    await server.close();
  }
});

await check("GET /events ส่ง retry: 2000 แล้ว snapshot ก้อนแรกทันที", async () => {
  const server = await startFixture(fakeSnapshot({ sessions: [fakeCharacter("1417")] }));
  const stream = await openSse(server.port);
  try {
    const first = await stream.next(1_000);
    assert.equal(first, "retry: 2000", "ต้องบอก EventSource ให้ต่อใหม่เร็ว ๆ ก่อนเป็นอย่างแรก");
    const snapshot = await nextSnapshot(stream, 1_000);
    assert.ok(snapshot, "ต้องได้ snapshot เต็มก้อนทันทีที่ต่อ ไม่ต้องรอ poll รอบถัดไป");
    assert.equal(snapshot.sessions[0]?.id, "1417");
  } finally {
    stream.close();
    await server.close();
  }
});

await check("state เปลี่ยน → ได้ snapshot ก้อนใหม่ภายใน ~2 วินาที", async () => {
  const server = await startFixture();
  const stream = await openSse(server.port);
  try {
    const first = await nextSnapshot(stream, 1_000);
    assert.equal(first?.sessions.length, 0);

    server.set(fakeSnapshot({ sessions: [fakeCharacter("1417")] }));
    const next = await nextSnapshot(stream, 3_000);
    assert.ok(next, "poll ทุก 1 วินาทีต้องเห็นความเปลี่ยนแปลงแล้ว broadcast");
    assert.equal(next.sessions[0]?.id, "1417");
  } finally {
    stream.close();
    await server.close();
  }
});

await check("state ไม่เปลี่ยน → ไม่ broadcast อะไรเพิ่ม แม้ now จะเดินทุกวินาที", async () => {
  const server = await startFixture();
  const stream = await openSse(server.port);
  try {
    assert.ok(await nextSnapshot(stream, 1_000), "ก้อนแรกตอนต่อต้องมา");
    const extra = await nextSnapshot(stream, 2_500);
    assert.equal(extra, undefined, "`now` ต้องถูกตัดออกก่อนเทียบ diff (spec §3.4)");
  } finally {
    stream.close();
    await server.close();
  }
});

await check("client ที่ตายกลางทางไม่ทำให้ client อื่นพลาด broadcast รอบถัดไป", async () => {
  const server = await startFixture();
  const dying = await openSse(server.port);
  const alive = await openSse(server.port);
  try {
    assert.ok(await nextSnapshot(alive, 1_000));
    dying.close();
    server.set(fakeSnapshot({ sessions: [fakeCharacter("1417")] }));
    const next = await nextSnapshot(alive, 3_000);
    assert.equal(next?.sessions[0]?.id, "1417");
  } finally {
    alive.close();
    await server.close();
  }
});

console.log("\nfail-soft และการปิด");

await check("port ที่ถูกใช้อยู่แล้ว → คืน undefined ไม่ throw", async () => {
  const server = await startFixture();
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    const second = await startOfficeUi({ port: server.port, snapshot: () => fakeSnapshot() });
    assert.equal(second, undefined, "เปิดไม่ขึ้นต้องเป็น undefined ไม่ใช่ exception");
    const shouted = logged.join("\n");
    assert.match(shouted, /OFFICE_UI_PORT/, "ต้องบอกชื่อ env ให้ Operator รู้ว่าไปแก้ที่ไหน");
    assert.match(shouted, new RegExp(String(server.port)), "และต้องบอก port ที่ชนด้วย");
  } finally {
    console.error = original;
    await server.close();
  }
});

await check("close() จบเร็วแม้มี SSE ค้างอยู่ แล้วต่อใหม่ไม่ติด", async () => {
  const server = await startFixture();
  const stream = await openSse(server.port);
  assert.ok(await nextSnapshot(stream, 1_000));

  const startedAt = Date.now();
  await server.close();
  assert.ok(
    Date.now() - startedAt < 2_000,
    "shutdown ต้องไม่ค้างรอ SSE ที่เปิดอยู่ (spec §3.5)",
  );

  await assert.rejects(
    () => raw(server.port, "GET", "/state"),
    (error: NodeJS.ErrnoException) => error.code === "ECONNREFUSED",
    "ปิดแล้วต้องไม่รับ connection อีก",
  );
  stream.close();
});

await check("close() ซ้ำสองครั้งไม่พัง", async () => {
  const server = await startFixture();
  await server.close();
  await server.close();
});

if (failures > 0) {
  console.error(`\n${failures} office server test(s) failed`);
  process.exit(1);
}
console.log("\nall office server tests passed");
