/**
 * HTTP + SSE server ของ Office UI (spec §3) — `node:http` ล้วน **ห้ามเพิ่ม dependency**
 * (repo ไม่มี HTTP framework อยู่ก่อนและไม่มี bundler)
 *
 * ข้อบังคับที่ไฟล์นี้ต้องผ่านทุกข้อ (spec §2 — read-only ตาม ADR 0002):
 *  1. รับเฉพาะ `GET` / `HEAD` — method อื่น**ทั้งหมด**จบที่ `405` ตั้งแต่บรรทัดแรกของ handler
 *     ไม่มี route table ของ POST/PUT/PATCH/DELETE อยู่ในไฟล์นี้เลยแม้แต่บรรทัดเดียว
 *  2. ทุก handler อ่านอย่างเดียว — ไฟล์นี้ไม่เคยเรียกอะไรที่เปลี่ยนสถานะบอท มีแค่ `snapshot()` ที่ส่งเข้ามา
 *  3. bind `127.0.0.1` **ตายตัว** ({@link HOST}) ไม่มี config ให้เปลี่ยน host เพราะหน้านี้ไม่มี auth
 *  4. static เสิร์ฟได้เฉพาะไฟล์ใต้ {@link OFFICE_ROOT} เท่านั้น (ดู {@link resolveStatic})
 *
 * fail-soft: `listen` ล้ม (เช่น `EADDRINUSE`) → `console.error` ดัง ๆ พร้อมชื่อ env กับ port แล้ว
 * resolve เป็น `undefined` — **ไม่ throw ไม่ retry** เพราะ Discord คือช่องทางหลัก UI เป็นของเสริม
 */
import { readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { POLL_INTERVAL_MS, type OfficeServerHandle, type OfficeSnapshot } from "./types.js";

/** host คงที่ตาม spec §2 ข้อ 3 — ไม่มี auth จึงห้าม expose ออกนอกเครื่อง Host */
const HOST = "127.0.0.1";

/** บอก EventSource ให้ต่อใหม่เร็ว ๆ เมื่อสายขาด (spec §3.3) */
const SSE_RETRY_MS = 2_000;

/** comment `:ping` กันสายตายเงียบ ๆ โดยไม่มีใครรู้ (spec §3.3) */
const PING_INTERVAL_MS = 20_000;

/**
 * โฟลเดอร์ `office/` ที่ root ของรีโป — resolve จากตำแหน่งโมดูลตายตัว ใช้ได้ทั้งตอนรันด้วย tsx
 * (`src/office/server.ts`) และตอน build แล้ว (`dist/office/server.js`) เพราะทั้งคู่ลึกจาก root สองชั้นเท่ากัน
 */
const OFFICE_ROOT = resolve(fileURLToPath(new URL("../../office/", import.meta.url)));

/** MIME map สั้น ๆ เขียนเอง (spec §3.3) — นอกรายการนี้เป็น `application/octet-stream` */
const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** Operator สลับไฟล์ art แล้ว refresh ต้องเห็นทันที (spec §3.3) — ไฟล์เล็กและอยู่บน localhost */
const NO_STORE = "no-store";

function contentTypeFor(file: string): string {
  return MIME_BY_EXT[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * เส้นทางดิบจาก request (ยังไม่ decode, ตัด query/fragment ออก)
 * **เจตนาไม่ใช้ `new URL()` normalize ให้** เพราะ WHATWG URL ยุบ `..` และ `%2e%2e` ทิ้งตั้งแต่ตอน parse
 * — ด่านกัน path traversal จะกลายเป็นโค้ดที่ไม่เคยถูกเรียกจริง ที่นี่จึงส่งของดิบให้ {@link resolveStatic} ตรวจเอง
 */
function rawPathOf(url: string | undefined): string {
  const path = (url ?? "/").split("?")[0]?.split("#")[0] ?? "/";
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * แปลงเส้นทางเป็นไฟล์จริงใต้ {@link OFFICE_ROOT} — คืน `undefined` เมื่อออกนอกโฟลเดอร์ (ตอบ 404)
 * ตาม spec §3.3: decode ก่อน แล้ว `resolve` (ซึ่งยุบ `..` ให้) แล้ว**ต้อง**ตรวจว่ายังขึ้นต้นด้วย root + sep
 */
function resolveStatic(rawPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return undefined; // เส้นทาง percent-encoding พัง = ไม่ต้องเดาใจ ตอบ 404
  }
  if (decoded.includes("\0")) return undefined;
  const target = resolve(OFFICE_ROOT, decoded.replace(/^\/+/, ""));
  if (target !== OFFICE_ROOT && !target.startsWith(OFFICE_ROOT + sep)) return undefined;
  return target;
}

/** ตัด `now` ออกก่อนเทียบ diff (spec §3.4) ไม่งั้น snapshot จะต่างทุกวินาทีและ broadcast รัวตลอด */
function comparableOf(snapshot: OfficeSnapshot): string {
  const { now: _now, ...rest } = snapshot;
  return JSON.stringify(rest);
}

/**
 * เปิด Office UI. คืน `undefined` เมื่อเปิดไม่ขึ้น (fail-soft) — ไม่ throw ไม่ว่ากรณีใด
 *
 * @param options.port พอร์ตที่จะผูก (มาจาก `OFFICE_UI_PORT`) — `0` = ให้ OS เลือกให้ (ใช้ในเทสต์)
 * @param options.snapshot ตัวประกอบ snapshot ของบอท — ต้อง synchronous และไม่มี side effect (spec §2 ข้อ 2)
 */
export function startOfficeUi(options: {
  port: number;
  snapshot: () => OfficeSnapshot;
}): Promise<OfficeServerHandle | undefined> {
  const { port, snapshot } = options;

  /** สาย SSE ที่เปิดอยู่ — ลบออกตอน close/error ให้ client ที่ตายไม่ทำ broadcast รอบถัดไปพัง */
  const clients = new Set<ServerResponse>();
  let lastComparable: string | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  let pingTimer: NodeJS.Timeout | undefined;
  let closing = false;

  /** เรียก snapshot() แบบไม่ให้ assembler พังลามมาทำ server ล้ม */
  function readSnapshot(): OfficeSnapshot | undefined {
    try {
      return snapshot();
    } catch (error) {
      console.error("[office] snapshot failed:", error);
      return undefined;
    }
  }

  function frameOf(payload: string): string {
    return `event: snapshot\ndata: ${payload}\n\n`;
  }

  /** เขียนลงสาย SSE เส้นเดียว — เส้นไหนตายก็ถอดออกจากทะเบียนตรงนั้นเลย */
  function writeTo(client: ServerResponse, chunk: string): void {
    if (client.writableEnded || client.destroyed) {
      clients.delete(client);
      return;
    }
    try {
      client.write(chunk);
    } catch {
      clients.delete(client);
      client.destroy();
    }
  }

  function broadcast(chunk: string): void {
    for (const client of [...clients]) writeTo(client, chunk);
  }

  function sendText(res: ServerResponse, status: number, body: string, headers = {}): void {
    res.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": NO_STORE,
      "Content-Length": String(Buffer.byteLength(body)),
      ...headers,
    });
    res.end(res.req.method === "HEAD" ? undefined : body);
  }

  function notFound(res: ServerResponse): void {
    // 404 จริงเสมอ — ไม่มี rewrite/fallback ไป index.html เพราะ loader ของ asset ใช้ 404
    // เป็นสัญญาณว่าไม่มีชุด custom/ (spec §3.3, §8.1)
    sendText(res, 404, "404 Not Found");
  }

  /** `GET /state` — snapshot ก้อนเดียวกับที่ SSE ส่ง ไว้ `curl` debug + fallback ของหน้าเว็บ */
  function sendState(res: ServerResponse): void {
    const current = readSnapshot();
    if (!current) {
      sendText(res, 500, "500 snapshot unavailable");
      return;
    }
    const body = JSON.stringify(current);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": NO_STORE,
      "Content-Length": String(Buffer.byteLength(body)),
    });
    res.end(res.req.method === "HEAD" ? undefined : body);
  }

  /** `GET /events` — SSE: `retry:` + snapshot เต็มก้อนทันที แล้วรอ broadcast รอบถัดไป */
  function openEvents(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": NO_STORE,
      Connection: "keep-alive",
    });
    res.socket?.setNoDelay(true);
    clients.add(res);
    const drop = (): void => {
      clients.delete(res);
    };
    res.on("close", drop);
    res.on("error", drop);

    writeTo(res, `retry: ${SSE_RETRY_MS}\n\n`);
    const current = readSnapshot();
    if (current) writeTo(res, frameOf(JSON.stringify(current)));
  }

  /** ไฟล์ static ใต้ `office/` เท่านั้น ไม่มี directory listing */
  async function sendStatic(res: ServerResponse, rawPath: string): Promise<void> {
    const file = resolveStatic(rawPath);
    if (!file) {
      notFound(res);
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) {
        notFound(res);
        return;
      }
      const headers = {
        "Content-Type": contentTypeFor(file),
        "Cache-Control": NO_STORE,
      };
      if (res.req.method === "HEAD") {
        res.writeHead(200, { ...headers, "Content-Length": String(info.size) });
        res.end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { ...headers, "Content-Length": String(body.byteLength) });
      res.end(body);
    } catch {
      notFound(res);
    }
  }

  const server = createServer((req, res) => {
    // ── ด่านเดียวของ method (spec §2 ข้อ 1): ทุกอย่างที่ไม่ใช่ GET/HEAD จบที่นี่ ─────────────
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "405 Method Not Allowed", { Allow: "GET, HEAD" });
      return;
    }

    const rawPath = rawPathOf(req.url);
    if (rawPath === "/state") {
      sendState(res);
      return;
    }
    if (rawPath === "/events") {
      if (req.method === "HEAD") {
        sendText(res, 200, "", { "Content-Type": "text/event-stream" });
        return;
      }
      openEvents(res);
      return;
    }
    void sendStatic(res, rawPath === "/" ? "/index.html" : rawPath);
  });

  async function close(): Promise<void> {
    if (closing) return;
    closing = true;
    if (pollTimer) clearInterval(pollTimer);
    if (pingTimer) clearInterval(pingTimer);
    // SSE ที่เปิดค้างอยู่จะกั้น server.close() ไว้ตลอดกาล — ต้อง end แล้ว destroy ทุกเส้น
    // ไม่งั้น Bot.shutdown() ค้าง (spec §3.5)
    for (const client of [...clients]) {
      clients.delete(client);
      try {
        client.end();
      } catch {
        // สายที่ตายไปแล้วไม่ต้องสน — ยังไงก็ destroy ต่อ
      }
      client.destroy();
    }
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections(); // เผื่อ keep-alive ของ request ธรรมดาที่ยังค้าง
    });
  }

  return new Promise<OfficeServerHandle | undefined>((settle) => {
    const onStartupError = (error: Error): void => {
      console.error(
        `[office] could not start Office UI on ${HOST}:${port} (OFFICE_UI_PORT=${port}): ${error.message}`,
      );
      console.error(
        "[office] the bot keeps running without Office UI — pick a free OFFICE_UI_PORT in .env and restart",
      );
      settle(undefined); // fail-soft: ไม่ throw ไม่ retry
    };
    server.once("error", onStartupError);

    server.listen(port, HOST, () => {
      server.off("error", onStartupError);
      // หลังเปิดได้แล้ว error ของ server ต้องไม่พาโปรเซสบอทตาย
      server.on("error", (error) => console.error("[office] server error:", error));

      const current = readSnapshot();
      if (current) lastComparable = comparableOf(current);

      // poll-and-diff (spec §3.4): ไม่ฝัง hook ในเส้นทางร้อนของบอทสักบรรทัด
      pollTimer = setInterval(() => {
        const next = readSnapshot();
        if (!next) return;
        const key = comparableOf(next);
        if (key === lastComparable) return;
        lastComparable = key;
        broadcast(frameOf(JSON.stringify(next)));
      }, POLL_INTERVAL_MS);
      pollTimer.unref();

      pingTimer = setInterval(() => broadcast(":ping\n\n"), PING_INTERVAL_MS);
      pingTimer.unref();

      const address = server.address() as AddressInfo | null;
      const bound = address?.port ?? port;
      // ไม่ log ตรงนี้: `bot.ts` เป็นคนประกาศว่าเปิดสำเร็จ (ticket #19 ข้อ 4)
      // ถ้า log ทั้งสองที่ Operator จะเห็นบรรทัดซ้ำสองภาษาทุกครั้งที่บอทขึ้น
      settle({ port: bound, close });
    });
  });
}
