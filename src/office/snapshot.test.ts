/**
 * Run with: npx tsx src/office/snapshot.test.ts
 * Asserts the snapshot assembler (Office UI spec §5.2, ticket #18) — the piece that
 * decides which zone every character stands in. One case per row of the precedence
 * table (P1, P2, P5–P9), plus the traps that are easy to get wrong: P1 beats P2, a
 * `/stop` while idle is *not* a stop, a Run can never reach `approval` (ADR 0004),
 * a live character beats its own ghost, the zone-5 cap, and — the load-bearing one —
 * that the result is pure and free of anything derived from the current time.
 */
import assert from "node:assert/strict";
import { assembleSnapshot, runCharacterId } from "./snapshot.js";
import type {
  AgentSessionView,
  LiveSessionView,
  ScheduleRecordView,
  SnapshotInput,
} from "./snapshot.js";
import type { OutcomeEntry } from "./feed.js";
import type { Character } from "./types.js";
import { FAILED_LINGER_MS, FAILED_ZONE_CAP, STOPPED_LINGER_MS } from "./types.js";
// Type-only: erased at runtime, so this costs the test nothing but keeps the narrow
// views honest — the day a real getter changes shape, this file stops compiling
// instead of T6 discovering it while wiring the bot.
import type { AgentSession } from "../agent-session.js";
import type { ThreadReporter } from "../discord/render.js";
import type { ScheduleRecord } from "../schedule-store.js";
import type { TaskRecord } from "../store.js";

type Assert<T extends true> = T;
type _RealSessionFits = Assert<AgentSession extends AgentSessionView ? true : false>;
type _RealLiveSessionFits = Assert<
  { session: AgentSession; reporter: ThreadReporter; record: TaskRecord } extends LiveSessionView
    ? true
    : false
>;
type _RealScheduleFits = Assert<ScheduleRecord extends ScheduleRecordView ? true : false>;

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

/** จุดอ้างอิงเวลาของทุกเทสต์ — ตัวเลขล้วน ไม่มี `Date.now()` ที่ไหนทั้งฝั่งเทสต์และฝั่งโค้ด */
const T0 = 1_700_000_000_000;
const NOW = T0 + 60 * 60_000;
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

/**
 * Fake ของ `AgentSession` — `isStopping` เป็นฟิลด์แยกโดยตั้งใจ ให้เทสต์จำลองสัญญาของ getter
 * ตัวจริง (`busy && stopRequested`) ได้เอง รวมทั้งเคส `/stop` ตอนไม่ busy ที่ `stopRequestedAt`
 * มีค่าแต่ `isStopping` เป็น false
 */
function session(overrides: Partial<AgentSessionView> = {}): AgentSessionView {
  return {
    isBusy: false,
    isStopping: false,
    isClosed: false,
    startedAt: T0,
    pendingApprovals: [],
    ...overrides,
  };
}

function live(
  threadId: string,
  sessionView: AgentSessionView,
  extra: {
    since?: number;
    threadName?: string;
    threadUrl?: string;
    headline?: string;
    workspace?: string;
    model?: string;
  } = {},
): SnapshotInput["sessions"][number] {
  return {
    threadId,
    state: "live",
    since: extra.since ?? T0,
    entry: {
      session: sessionView,
      reporter: {
        threadName: extra.threadName ?? `เธรด ${threadId}`,
        ...(extra.threadUrl !== undefined ? { threadUrl: extra.threadUrl } : {}),
        currentHeadline: extra.headline ?? "",
      },
      record: { workspace: extra.workspace ?? "/ws", model: extra.model ?? "sonnet" },
    },
  };
}

function pending(threadId: string, since = T0): SnapshotInput["sessions"][number] {
  return { threadId, state: "pending", since };
}

function schedule(overrides: Partial<ScheduleRecordView> = {}): ScheduleRecordView {
  return {
    id: "sch1",
    threadId: "9001",
    workspace: "/ws",
    model: "sonnet",
    paused: false,
    consecutiveFailures: 0,
    nextRunAt: new Date(NOW + 30 * 60_000).toISOString(),
    ...overrides,
  };
}

function ghost(overrides: Partial<OutcomeEntry> & Pick<OutcomeEntry, "id">): OutcomeEntry {
  return {
    kind: "task",
    name: "งานที่จบไปแล้ว",
    workspace: "/ws",
    model: "sonnet",
    status: "failed",
    endedAt: NOW - 60_000,
    ...overrides,
  };
}

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    now: NOW,
    approvalTimeoutMs: APPROVAL_TIMEOUT_MS,
    sessions: [],
    runs: [],
    browserQueue: { waiting: [] },
    feed: [],
    schedules: [],
    describeThread: () => ({}),
    ...overrides,
  };
}

/** ตัวละครตัวเดียวที่คาดว่าจะมีใน `sessions[]` — เทสต์ส่วนใหญ่ดูตัวเดียว */
function onlySession(snapshot: { sessions: Character[] }): Character {
  assert.equal(snapshot.sessions.length, 1, "คาดว่ามีตัวละคร Task ตัวเดียว");
  const character = snapshot.sessions[0];
  assert.ok(character);
  return character;
}

console.log("ตาราง precedence §5.2 — หนึ่งเคสต่อหนึ่งแถว");

await check("P1 — isBusy && stopRequested → stopped, detail กำลังหยุด, since = stopRequestedAt", async () => {
  const snapshot = assembleSnapshot(
    input({
      sessions: [
        live(
          "111",
          session({
            isBusy: true,
            isStopping: true,
            turnStartedAt: NOW - 5_000,
            stopRequestedAt: NOW - 1_000,
          }),
        ),
      ],
    }),
  );

  const character = onlySession(snapshot);
  assert.equal(character.state, "stopped");
  assert.equal(character.detail, "กำลังหยุด");
  assert.equal(character.since, NOW - 1_000);
  assert.equal(character.deadlineAt, null);
  assert.equal(character.outcome, null, "ถูกสั่งหยุดสด ๆ ไม่ใช่ผลจบ จึงไม่มี outcome");
});

await check("P2 — มี approval ค้าง → approval, since = ตัวเก่าสุด, deadlineAt = since + timeout", async () => {
  const snapshot = assembleSnapshot(
    input({
      sessions: [
        live(
          "111",
          session({
            isBusy: true,
            turnStartedAt: NOW - 30_000,
            // ใส่สลับลำดับเข้ามา เพื่อยืนยันว่า assembler เรียงเก่าสุดก่อนเอง
            pendingApprovals: [
              { toolName: "Read", input: { file_path: "/ws/b.ts" }, since: NOW - 5_000 },
              { toolName: "Bash", input: { command: "rm -rf build" }, since: NOW - 20_000 },
            ],
          }),
        ),
      ],
    }),
  );

  const character = onlySession(snapshot);
  assert.equal(character.state, "approval");
  assert.equal(character.detail, null);
  assert.equal(character.since, NOW - 20_000, "since = คำขอที่เก่าสุด");
  assert.equal(character.deadlineAt, NOW - 20_000 + APPROVAL_TIMEOUT_MS);
  assert.deepEqual(
    character.approvals.map((a) => [a.tool, a.summary, a.since, a.deadlineAt]),
    [
      ["Bash", "`rm -rf build`", NOW - 20_000, NOW - 20_000 + APPROVAL_TIMEOUT_MS],
      ["Read", "/ws/b.ts", NOW - 5_000, NOW - 5_000 + APPROVAL_TIMEOUT_MS],
    ],
    "summary มาจาก describeTool() ของเดิม ไม่ใช่ input ดิบ",
  );
});

await check("P5 — slot ที่ยังเป็น pending → working + กำลังเข้ามา, since = เวลาที่จอง slot", async () => {
  const snapshot = assembleSnapshot(input({ sessions: [pending("111", NOW - 200)] }));

  const character = onlySession(snapshot);
  assert.equal(character.state, "working");
  assert.equal(character.detail, "กำลังเข้ามา");
  assert.equal(character.since, NOW - 200);
  assert.equal(character.headline, null);
  assert.deepEqual(character.approvals, []);
  assert.equal(character.workspace, "", "ยังไม่มี TaskRecord ให้อ่านในช่วงนี้");
  assert.equal(character.model, "");
});

await check("P6 — isBusy → working, detail null, since = turnStartedAt", async () => {
  const snapshot = assembleSnapshot(
    input({ sessions: [live("111", session({ isBusy: true, turnStartedAt: NOW - 9_000 }))] }),
  );

  const character = onlySession(snapshot);
  assert.equal(character.state, "working");
  assert.equal(character.detail, null);
  assert.equal(character.since, NOW - 9_000);
  assert.equal(character.deadlineAt, null);
});

await check("P7 — turn ล่าสุด interrupted ยังไม่พ้น 2 นาที → stopped, since = endedAt", async () => {
  const endedAt = NOW - 60_000;
  const snapshot = assembleSnapshot(
    input({
      sessions: [
        live("111", session({ lastTurn: { summary: { status: "interrupted" }, endedAt } })),
      ],
    }),
  );

  const character = onlySession(snapshot);
  assert.equal(character.state, "stopped");
  assert.equal(character.detail, null);
  assert.equal(character.since, endedAt);
  assert.deepEqual(character.outcome, { status: "interrupted", reason: "", endedAt });
});

await check("P8 — turn ล่าสุด failed ยังไม่พ้น 15 นาที → failed พร้อมเหตุผลสั้น", async () => {
  const endedAt = NOW - 10 * 60_000;
  const snapshot = assembleSnapshot(
    input({
      sessions: [
        live(
          "111",
          session({
            lastTurn: { summary: { status: "failed", errors: ["ต่อ workspace ไม่ได้"] }, endedAt },
          }),
        ),
      ],
    }),
  );

  const character = onlySession(snapshot);
  assert.equal(character.state, "failed");
  assert.equal(character.detail, "ต่อ workspace ไม่ได้");
  assert.equal(character.since, endedAt);
  assert.deepEqual(character.outcome, {
    status: "failed",
    reason: "ต่อ workspace ไม่ได้",
    endedAt,
  });
});

await check("P9 — live แต่ไม่เข้าข้อไหน → idle, since = lastTurn.endedAt ?? startedAt", async () => {
  const withTurn = assembleSnapshot(
    input({
      sessions: [
        live(
          "111",
          session({ lastTurn: { summary: { status: "ok" }, endedAt: NOW - 3 * 60_000 } }),
        ),
      ],
    }),
  );
  const first = onlySession(withTurn);
  assert.equal(first.state, "idle");
  assert.equal(first.detail, null);
  assert.equal(first.since, NOW - 3 * 60_000);

  const fresh = assembleSnapshot(
    input({ sessions: [live("111", session({ startedAt: NOW - 45_000 }))] }),
  );
  assert.equal(onlySession(fresh).since, NOW - 45_000, "ยังไม่เคยมี turn → ใช้ startedAt");
});

console.log("\nจุดที่พลาดง่ายของ precedence");

await check("P1 ชนะ P2 — สั่งหยุดระหว่างรออนุมัติได้ stopped ไม่ใช่ approval", async () => {
  const snapshot = assembleSnapshot(
    input({
      sessions: [
        live(
          "111",
          session({
            isBusy: true,
            isStopping: true,
            turnStartedAt: NOW - 60_000,
            stopRequestedAt: NOW - 2_000,
            pendingApprovals: [
              { toolName: "Bash", input: { command: "npm run build" }, since: NOW - 30_000 },
            ],
          }),
        ),
      ],
    }),
  );

  const character = onlySession(snapshot);
  assert.equal(character.state, "stopped", "approval ที่กำลังถูก abort จะถูก deny อยู่แล้ว");
  assert.equal(character.since, NOW - 2_000, "since มาจาก stopRequestedAt ไม่ใช่ approval");
  assert.equal(character.deadlineAt, null, "ไม่ใช่โซน approval แล้วจึงไม่มีเส้นตาย");
  assert.equal(character.approvals.length, 1, "แต่การ์ดข้อมูลยังบอกความจริงว่ามีคำขอค้างอยู่");
});

await check("/stop ตอนไม่ busy ไม่ใช่ stopped — ธงค้างไว้เฉย ๆ จนกว่าจะมี turn ใหม่", async () => {
  const snapshot = assembleSnapshot(
    input({
      sessions: [
        live(
          "111",
          // สัญญาของ getter ตัวจริง: `isStopping = busy && stopRequested` → false ทั้งที่ธงค้าง
          session({ isBusy: false, isStopping: false, stopRequestedAt: NOW - 1_000 }),
        ),
      ],
    }),
  );

  assert.equal(onlySession(snapshot).state, "idle");
});

await check("session ตายแล้ว (wasResuming) ไม่มีตัวละคร และไม่มีผีใน feed", async () => {
  const snapshot = assembleSnapshot(
    input({
      // `bot.ts` ไม่เขียน feed ให้เคส wasResuming (spec §5.5 จุดที่ 2) feed จึงว่างตามจริง
      sessions: [live("111", session({ isClosed: true }))],
      feed: [],
    }),
  );

  assert.deepEqual(snapshot.sessions, [], "หายไปเงียบ ๆ ไม่โผล่เป็นตัวหลับ/ตัวว่าง");
  assert.deepEqual(snapshot.outcomeFeed, []);
});

await check("linger ของตัวสดหมดอายุแล้วตกไป idle ที่ขอบเวลาพอดี", async () => {
  const stopped = (age: number) =>
    onlySession(
      assembleSnapshot(
        input({
          sessions: [
            live(
              "111",
              session({ lastTurn: { summary: { status: "interrupted" }, endedAt: NOW - age } }),
            ),
          ],
        }),
      ),
    ).state;
  assert.equal(stopped(STOPPED_LINGER_MS - 1), "stopped");
  assert.equal(stopped(STOPPED_LINGER_MS), "idle");

  const failed = (age: number) =>
    onlySession(
      assembleSnapshot(
        input({
          sessions: [
            live(
              "111",
              session({ lastTurn: { summary: { status: "failed" }, endedAt: NOW - age } }),
            ),
          ],
        }),
      ),
    ).state;
  assert.equal(failed(FAILED_LINGER_MS - 1), "failed");
  assert.equal(failed(FAILED_LINGER_MS), "idle");
});

console.log("\nRun (Schedule)");

await check("Run ที่ยังไม่มี session → working + กำลังเริ่มรอบ และ id เป็น schedule:<id>", async () => {
  const snapshot = assembleSnapshot(
    input({ runs: [{ id: "sch1", since: NOW - 400, record: schedule() }] }),
  );

  const character = snapshot.scheduleRuns[0];
  assert.ok(character);
  assert.equal(character.id, "schedule:sch1");
  assert.equal(character.id, runCharacterId("sch1"), "คีย์เดียวกับที่ T6 ใช้เขียน feed");
  assert.equal(character.kind, "run");
  assert.equal(character.state, "working");
  assert.equal(character.detail, "กำลังเริ่มรอบ");
  assert.equal(character.since, NOW - 400);
  assert.equal(character.headline, null);
  assert.equal(character.workspace, "/ws");
});

await check("Run ที่มี reporter แล้วโชว์ headline เหมือน Task (spec §5: Run หน้าตาเหมือน Task)", async () => {
  const withHeadline = assembleSnapshot(
    input({
      runs: [
        {
          id: "sch1",
          since: NOW - 400,
          record: schedule(),
          session: session({ isBusy: true, turnStartedAt: NOW - 300 }),
          reporter: { threadName: "รอบเช้า", currentHeadline: "กำลังใช้ Bash" },
        },
      ],
    }),
  );
  assert.equal(withHeadline.scheduleRuns[0]?.headline, "กำลังใช้ Bash");

  // headline ว่างของ Run ต้องกลายเป็น null เหมือนของ Task ไม่ใช่สตริงเปล่า
  const blank = assembleSnapshot(
    input({
      runs: [
        {
          id: "sch1",
          since: NOW - 400,
          record: schedule(),
          reporter: { threadName: "รอบเช้า", currentHeadline: "" },
        },
      ],
    }),
  );
  assert.equal(blank.scheduleRuns[0]?.headline, null);
});

await check("Run ไม่มีทางได้ state approval แม้มีคำขอค้าง (ADR 0004)", async () => {
  const snapshot = assembleSnapshot(
    input({
      runs: [
        {
          id: "sch1",
          since: NOW - 60_000,
          record: schedule(),
          session: session({
            isBusy: true,
            turnStartedAt: NOW - 50_000,
            pendingApprovals: [
              { toolName: "Bash", input: { command: "ls" }, since: NOW - 10_000 },
            ],
          }),
        },
      ],
    }),
  );

  const character = snapshot.scheduleRuns[0];
  assert.ok(character);
  assert.equal(character.state, "working", "approval ใน Run ถูก deny เสมอ ห้ามขึ้นโซน 3");
  assert.equal(character.deadlineAt, null);
  assert.equal(character.since, NOW - 50_000);
});

await check("Run ใช้ตาราง precedence ชุดเดียวกับ Task (P1 กับ P8)", async () => {
  const stopping = assembleSnapshot(
    input({
      runs: [
        {
          id: "sch1",
          since: NOW - 60_000,
          record: schedule(),
          session: session({ isBusy: true, isStopping: true, stopRequestedAt: NOW - 3_000 }),
        },
      ],
    }),
  ).scheduleRuns[0];
  assert.equal(stopping?.state, "stopped");
  assert.equal(stopping?.since, NOW - 3_000);

  const failed = assembleSnapshot(
    input({
      runs: [
        {
          id: "sch1",
          since: NOW - 60_000,
          record: schedule(),
          session: session({
            lastTurn: {
              summary: { status: "failed", errors: ["รอคิว browser ไม่ทันเวลารอบถัดไป"] },
              endedAt: NOW - 30_000,
            },
          }),
        },
      ],
    }),
  ).scheduleRuns[0];
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.outcome?.reason, "รอคิว browser ไม่ทันเวลารอบถัดไป");
});

await check("Run ใช้ชื่อจาก describeThread ถ้ามี ไม่งั้นใช้ schedule id", async () => {
  const named = assembleSnapshot(
    input({
      runs: [{ id: "sch1", since: NOW, record: schedule() }],
      describeThread: (threadId) =>
        threadId === "9001" ? { name: "สรุปยอดขายรายวัน", url: "https://d/9001" } : {},
    }),
  ).scheduleRuns[0];
  assert.equal(named?.name, "สรุปยอดขายรายวัน");
  assert.equal(named?.threadUrl, "https://d/9001");

  const unknown = assembleSnapshot(
    input({ runs: [{ id: "sch1", since: NOW, record: schedule() }] }),
  ).scheduleRuns[0];
  assert.equal(unknown?.name, "sch1", "หาเธรดไม่เจอ → ใช้ schedule id");
  assert.equal(unknown?.threadUrl, null);
});

console.log("\nคิว Browser");

await check("Run ในคิวมี deadlineAt ที่ arm ไว้จริง ส่วน Task ในคิวไม่มีเด็ดขาด", async () => {
  const snapshot = assembleSnapshot(
    input({
      browserQueue: {
        holder: "111",
        heldSince: NOW - 20_000,
        waiting: [
          // Task ที่ใส่ deadlineAt มาผิด ๆ ก็ต้องถูกลบทิ้ง (ADR 0006 — Task รอได้ไม่จำกัด)
          { requester: "222", since: NOW - 10_000, deadlineAt: NOW + 60_000 },
          { requester: "schedule:sch1", since: NOW - 5_000, deadlineAt: NOW + 300_000 },
          { requester: "schedule:sch2", since: NOW - 1_000 },
        ],
      },
    }),
  );

  assert.equal(snapshot.browserQueue.holder, "111");
  assert.equal(snapshot.browserQueue.heldSince, NOW - 20_000);
  assert.deepEqual(snapshot.browserQueue.waiting, [
    { id: "222", since: NOW - 10_000, deadlineAt: null },
    { id: "schedule:sch1", since: NOW - 5_000, deadlineAt: NOW + 300_000 },
    { id: "schedule:sch2", since: NOW - 1_000, deadlineAt: null },
  ]);
});

await check("คิวว่าง → holder กับ heldSince เป็น null ทั้งคู่", async () => {
  const snapshot = assembleSnapshot(input({ browserQueue: { heldSince: NOW, waiting: [] } }));
  assert.equal(snapshot.browserQueue.holder, null);
  assert.equal(snapshot.browserQueue.heldSince, null, "ไม่มีผู้ถือแล้วเวลาถือก็ต้องไม่มี");
});

await check("ผู้ถือ/ผู้รอ Browser ยังเป็น working — ไม่มี state ของ browser ต่อตัวละคร", async () => {
  const snapshot = assembleSnapshot(
    input({
      sessions: [live("111", session({ isBusy: true, turnStartedAt: NOW - 20_000 }))],
      browserQueue: { holder: "111", heldSince: NOW - 15_000, waiting: [] },
    }),
  );

  const character = onlySession(snapshot);
  assert.equal(character.state, "working", "โซน 4 ฝั่งเว็บ derive จาก browserQueue แหล่งเดียว");
  assert.equal(character.deadlineAt, null, "Task รอคิวได้ไม่จำกัด ไม่มีเส้นตายบนตัวละคร");
});

console.log("\nผีจาก outcome feed");

await check("ผีถูกวาดเป็นตัวละครเต็มตัว โดย failed → โซน 5 และ interrupted → โซน 6", async () => {
  const snapshot = assembleSnapshot(
    input({
      feed: [
        ghost({
          id: "111",
          name: "แก้บั๊ก /status",
          threadId: "111",
          threadUrl: "https://d/111",
          status: "failed",
          reason: "ต่อ workspace ไม่ได้",
          endedAt: NOW - 60_000,
        }),
        ghost({ id: "222", status: "interrupted", endedAt: NOW - 30_000 }),
      ],
    }),
  );

  assert.deepEqual(
    snapshot.outcomeFeed.map((c) => [c.id, c.state, c.detail, c.since]),
    [
      ["222", "stopped", null, NOW - 30_000],
      ["111", "failed", "ต่อ workspace ไม่ได้", NOW - 60_000],
    ],
    "เรียงใหม่สุดก่อน",
  );
  const failed = snapshot.outcomeFeed[1];
  assert.equal(failed?.name, "แก้บั๊ก /status");
  assert.equal(failed?.threadUrl, "https://d/111");
  assert.equal(failed?.headline, null);
  assert.deepEqual(failed?.approvals, []);
  assert.deepEqual(failed?.outcome, {
    status: "failed",
    reason: "ต่อ workspace ไม่ได้",
    endedAt: NOW - 60_000,
  });
});

await check("ตัวสดชนะผีที่ id เดียวกัน (dedupe) ทั้งฝั่ง Task และ Run", async () => {
  const snapshot = assembleSnapshot(
    input({
      sessions: [live("111", session({ isBusy: true, turnStartedAt: NOW - 1_000 }))],
      runs: [{ id: "sch1", since: NOW - 2_000, record: schedule() }],
      feed: [
        ghost({ id: "111", endedAt: NOW - 120_000 }),
        ghost({ id: runCharacterId("sch1"), kind: "run", endedAt: NOW - 120_000 }),
        ghost({ id: "333", endedAt: NOW - 120_000 }),
      ],
    }),
  );

  assert.deepEqual(
    snapshot.outcomeFeed.map((c) => c.id),
    ["333"],
    "ตัวเดิมเริ่ม turn ใหม่แล้ว ผีของมันต้องหายทันที",
  );
  assert.equal(onlySession(snapshot).state, "working");
});

await check("ผีหมดอายุ linger แล้วต้องหาย ที่ขอบเวลาเดียวกับ feed.ts", async () => {
  const ids = (feed: OutcomeEntry[]) =>
    assembleSnapshot(input({ feed })).outcomeFeed.map((c) => c.id);

  assert.deepEqual(ids([ghost({ id: "a", endedAt: NOW - (FAILED_LINGER_MS - 1) })]), ["a"]);
  assert.deepEqual(ids([ghost({ id: "a", endedAt: NOW - FAILED_LINGER_MS })]), []);
  assert.deepEqual(
    ids([ghost({ id: "b", status: "interrupted", endedAt: NOW - (STOPPED_LINGER_MS - 1) })]),
    ["b"],
  );
  assert.deepEqual(
    ids([ghost({ id: "b", status: "interrupted", endedAt: NOW - STOPPED_LINGER_MS })]),
    [],
  );
});

await check('entry สถานะ "ok" ไม่เคยกลายเป็นผี', async () => {
  const snapshot = assembleSnapshot(input({ feed: [ghost({ id: "a", status: "ok" })] }));
  assert.deepEqual(snapshot.outcomeFeed, []);
});

console.log("\ncap 20 ของโซนล้มเหลว");

await check("ไม่เกิน 20 ตัวไม่ตัดใครทิ้ง", async () => {
  const feed = Array.from({ length: FAILED_ZONE_CAP }, (_, i) =>
    ghost({ id: `g${i}`, endedAt: NOW - i * 1_000 }),
  );
  assert.equal(assembleSnapshot(input({ feed })).outcomeFeed.length, FAILED_ZONE_CAP);
});

await check("เกิน 20 ตัดตัวที่จบเก่าสุดทิ้ง แม้ตัวนั้นจะเป็นตัวสด", async () => {
  const liveEndedAt = NOW - 10 * 60_000;
  const feed = Array.from({ length: FAILED_ZONE_CAP }, (_, i) =>
    ghost({ id: `g${i}`, endedAt: NOW - i * 1_000 }),
  );
  const snapshot = assembleSnapshot(
    input({
      // ตัวสดที่ล้มเหลวไปนานกว่าผีทั้ง 20 ตัว — โควตานับรวมมันด้วย มันจึงเป็นตัวที่ถูกตัด
      sessions: [
        live(
          "111",
          session({ lastTurn: { summary: { status: "failed" }, endedAt: liveEndedAt } }),
        ),
      ],
      feed,
    }),
  );

  assert.deepEqual(snapshot.sessions, [], "ตัวสดที่เก่าสุดในโซน 5 ถูกตัดตามโควตา");
  assert.equal(snapshot.outcomeFeed.length, FAILED_ZONE_CAP);
});

await check("โควตาไม่แตะตัวละครที่ไม่ได้อยู่โซน 5", async () => {
  const feed = Array.from({ length: FAILED_ZONE_CAP + 5 }, (_, i) =>
    ghost({ id: `g${i}`, endedAt: NOW - i * 1_000 }),
  );
  const snapshot = assembleSnapshot(
    input({
      sessions: [
        live("111", session({ isBusy: true, turnStartedAt: NOW - 1_000 })),
        live("222", session({ lastTurn: { summary: { status: "interrupted" }, endedAt: NOW } })),
      ],
      feed,
    }),
  );

  assert.deepEqual(
    snapshot.sessions.map((c) => c.state),
    ["working", "stopped"],
    "โซน 2 กับโซน 6 ไม่เกี่ยวกับโควตาโซน 5",
  );
  assert.equal(snapshot.outcomeFeed.length, FAILED_ZONE_CAP);
});

console.log("\nSchedule ที่ auto-pause");

await check("โผล่เฉพาะ paused && consecutiveFailures >= 3 และแปลง nextRunAt เป็น epoch ms", async () => {
  const nextRunAt = new Date(NOW + 30 * 60_000).toISOString();
  const snapshot = assembleSnapshot(
    input({
      schedules: [
        schedule({ id: "auto", paused: true, consecutiveFailures: 3, nextRunAt }),
        schedule({ id: "byhand", paused: true, consecutiveFailures: 0 }),
        schedule({ id: "failing", paused: false, consecutiveFailures: 5 }),
      ],
      describeThread: () => ({ name: "สรุปยอดขายรายวัน", url: "https://d/9001" }),
    }),
  );

  assert.deepEqual(snapshot.autoPausedSchedules, [
    {
      id: "auto",
      name: "สรุปยอดขายรายวัน",
      threadId: "9001",
      threadUrl: "https://d/9001",
      consecutiveFailures: 3,
      nextRunAt: NOW + 30 * 60_000,
    },
  ]);
});

await check("nextRunAt ที่พังกลายเป็น 0 ไม่ใช่ NaN (JSON เขียน NaN เป็น null)", async () => {
  const snapshot = assembleSnapshot(
    input({
      schedules: [
        schedule({ id: "auto", paused: true, consecutiveFailures: 4, nextRunAt: "ไม่ใช่เวลา" }),
      ],
    }),
  );
  assert.equal(snapshot.autoPausedSchedules[0]?.nextRunAt, 0);
});

console.log("\nข้อมูลที่ห้ามหลุดออกไป (§4.1 ข้อ 3)");

await check("outcome.reason กรอง internal diagnostic ทิ้งแล้ว truncate ที่ 200", async () => {
  const endedAt = NOW - 30_000;
  const character = onlySession(
    assembleSnapshot(
      input({
        sessions: [
          live(
            "111",
            session({
              lastTurn: {
                summary: {
                  status: "failed",
                  errors: ["[ede_diagnostic] result_type=user", "อ่านไฟล์ไม่ได้", "  "],
                },
                endedAt,
              },
            }),
          ),
        ],
      }),
    ),
  );
  assert.equal(character.outcome?.reason, "อ่านไฟล์ไม่ได้");

  const long = onlySession(
    assembleSnapshot(
      input({
        sessions: [
          live(
            "111",
            session({
              lastTurn: { summary: { status: "failed", errors: ["ก".repeat(500)] }, endedAt },
            }),
          ),
        ],
      }),
    ),
  );
  assert.equal(long.outcome?.reason.length, 200);
  assert.ok(long.outcome?.reason.endsWith("…"));
});

await check("ไม่มีฟิลด์ browser_holder / browser_wait / ตำแหน่งคิว / ค่าที่ derive จากเวลา", async () => {
  const snapshot = assembleSnapshot(
    input({
      sessions: [live("111", session({ isBusy: true, turnStartedAt: NOW - 1_000 }))],
      runs: [{ id: "sch1", since: NOW - 2_000, record: schedule() }],
      feed: [ghost({ id: "333" })],
      schedules: [schedule({ id: "auto", paused: true, consecutiveFailures: 3 })],
      browserQueue: {
        holder: "111",
        heldSince: NOW - 5_000,
        waiting: [{ requester: "222", since: NOW - 1_000 }],
      },
    }),
  );

  const json = JSON.stringify(snapshot);
  for (const forbidden of [
    "browser_holder",
    "browser_wait",
    "queuePos",
    "idleForMs",
    "elapsedMs",
    "remainingMs",
  ]) {
    assert.ok(!json.includes(forbidden), `snapshot ต้องไม่มีฟิลด์ ${forbidden}`);
  }

  const expectedKeys = [
    "approvals",
    "deadlineAt",
    "detail",
    "headline",
    "id",
    "kind",
    "model",
    "name",
    "outcome",
    "since",
    "state",
    "threadId",
    "threadUrl",
    "workspace",
  ];
  for (const character of [
    ...snapshot.sessions,
    ...snapshot.scheduleRuns,
    ...snapshot.outcomeFeed,
  ]) {
    assert.deepEqual(
      Object.keys(character).sort(),
      expectedKeys,
      `ตัวละคร ${character.id} มีฟิลด์เกิน/ขาดจากสัญญาใน types.ts`,
    );
  }
});

console.log("\nความบริสุทธิ์ของฟังก์ชัน (เกณฑ์รับของ ticket)");

/** input ก้อนใหญ่ที่แตะทุกโซน ใช้ร่วมกันในเทสต์ purity */
function busyRoom(now: number): SnapshotInput {
  return input({
    now,
    sessions: [
      live("111", session({ isBusy: true, turnStartedAt: T0 + 1_000 }), { headline: "กำลังใช้ Bash" }),
      live(
        "222",
        session({
          isBusy: true,
          turnStartedAt: T0 + 2_000,
          pendingApprovals: [
            { toolName: "Bash", input: { command: "rm -rf build" }, since: T0 + 3_000 },
          ],
        }),
      ),
      live(
        "333",
        session({
          lastTurn: { summary: { status: "failed", errors: ["พัง"] }, endedAt: NOW - 60_000 },
        }),
      ),
      pending("444", T0 + 4_000),
    ],
    runs: [
      {
        id: "sch1",
        since: T0 + 5_000,
        record: schedule(),
        session: session({ isBusy: true, turnStartedAt: T0 + 6_000 }),
      },
    ],
    browserQueue: {
      holder: "111",
      heldSince: T0 + 7_000,
      waiting: [
        { requester: "222", since: T0 + 8_000 },
        { requester: "schedule:sch1", since: T0 + 9_000, deadlineAt: NOW + 600_000 },
      ],
    },
    feed: [ghost({ id: "555", endedAt: NOW - 90_000 })],
    schedules: [schedule({ id: "auto", paused: true, consecutiveFailures: 3 })],
  });
}

await check("เรียกซ้ำด้วย input เดิมและ now เดิม ได้ผลเท่ากันทุกไบต์", async () => {
  const shared = busyRoom(NOW);
  assert.equal(JSON.stringify(assembleSnapshot(shared)), JSON.stringify(assembleSnapshot(shared)));
});

await check("เวลาเดินไปแต่สถานะไม่เปลี่ยน → JSON (ตัด now ออก) ต้องเท่าเดิมเป๊ะ", async () => {
  // ข้อบังคับหลักของ poll-and-diff (§3.4): ถ้าค่าไหนขยับตามเวลาปัจจุบัน บอทจะ broadcast รัวทุกวินาที
  const strip = (now: number) => {
    const snapshot: Record<string, unknown> = { ...assembleSnapshot(busyRoom(now)) };
    delete snapshot.now;
    return JSON.stringify(snapshot);
  };
  assert.equal(strip(NOW), strip(NOW + 1_000));
  assert.equal(strip(NOW), strip(NOW + 30_000));
});

await check("JSON เปลี่ยนเมื่อสถานะเปลี่ยนจริง", async () => {
  const before = JSON.stringify(assembleSnapshot(busyRoom(NOW)));

  const stopping = busyRoom(NOW);
  stopping.sessions[0] = live("111", session({ isBusy: true, isStopping: true, stopRequestedAt: NOW }));
  assert.notEqual(JSON.stringify(assembleSnapshot(stopping)), before, "สั่งหยุดแล้วต้องต่างจากเดิม");

  const queued = busyRoom(NOW);
  queued.browserQueue.waiting = [...queued.browserQueue.waiting, { requester: "999", since: NOW }];
  assert.notEqual(JSON.stringify(assembleSnapshot(queued)), before, "คิว browser ยาวขึ้นต้องต่าง");
});

await check("assembleSnapshot ไม่แก้ input ที่รับเข้ามาเลย (ห้าม sort ทับของเดิม)", async () => {
  const shared = busyRoom(NOW);
  const snapshotOfInput = JSON.stringify({
    sessions: shared.sessions,
    runs: shared.runs,
    browserQueue: shared.browserQueue,
    feed: shared.feed,
    schedules: shared.schedules,
  });

  assembleSnapshot(shared);

  assert.equal(
    JSON.stringify({
      sessions: shared.sessions,
      runs: shared.runs,
      browserQueue: shared.browserQueue,
      feed: shared.feed,
      schedules: shared.schedules,
    }),
    snapshotOfInput,
  );
});

await check("ลำดับใน sessions/scheduleRuns ตามที่รับเข้ามาเป๊ะ ๆ (ที่นั่งฝั่งเว็บผูกกับ index)", async () => {
  const snapshot = assembleSnapshot(
    input({
      sessions: [pending("999"), live("111", session()), pending("222")],
      runs: [
        { id: "sZ", since: NOW, record: schedule({ id: "sZ" }) },
        { id: "sA", since: NOW, record: schedule({ id: "sA" }) },
      ],
    }),
  );

  assert.deepEqual(
    snapshot.sessions.map((c) => c.id),
    ["999", "111", "222"],
  );
  assert.deepEqual(
    snapshot.scheduleRuns.map((c) => c.id),
    ["schedule:sZ", "schedule:sA"],
  );
});

console.log("\nชื่อและลิงก์ของตัวละคร");

await check("Task ใช้ชื่อจาก reporter ก่อน แล้วค่อย describeThread แล้วค่อย threadId", async () => {
  const fromReporter = onlySession(
    assembleSnapshot(
      input({
        sessions: [live("111", session(), { threadName: "แก้บั๊ก /status", threadUrl: "https://d/111" })],
        describeThread: () => ({ name: "ชื่อจาก cache", url: "https://cache/111" }),
      }),
    ),
  );
  assert.equal(fromReporter.name, "แก้บั๊ก /status", "reporter ถือ thread ตัวจริงอยู่ ชนะ cache");
  assert.equal(fromReporter.threadUrl, "https://d/111");

  const fromCache = onlySession(
    assembleSnapshot(
      input({
        sessions: [live("111", session(), { threadName: "" })],
        describeThread: () => ({ name: "ชื่อจาก cache", url: "https://cache/111" }),
      }),
    ),
  );
  assert.equal(fromCache.name, "ชื่อจาก cache");
  assert.equal(fromCache.threadUrl, "https://cache/111", "reporter ไม่รู้ guild ก็ใช้ของ cache ได้");

  const unknown = onlySession(assembleSnapshot(input({ sessions: [pending("111")] })));
  assert.equal(unknown.name, "111", "ไม่รู้ชื่อเลยก็ยังต้องมีป้ายให้อ่าน");
  assert.equal(unknown.threadUrl, null);
});

await check("headline ว่างกลายเป็น null และค่าจริงถูกส่งต่อโดยไม่ตัดสิน state", async () => {
  const snapshot = assembleSnapshot(
    input({ sessions: [live("111", session(), { headline: "กำลังใช้ Bash" })] }),
  );
  const character = onlySession(snapshot);
  assert.equal(character.headline, "กำลังใช้ Bash");
  assert.equal(character.state, "idle", "headline เป็นข้อความโชว์เท่านั้น ห้ามใช้ตัดสินสถานะ");
});

if (failures > 0) {
  console.error(`\n${failures} office/snapshot test(s) failed`);
  process.exit(1);
}
console.log("\nall office/snapshot tests passed");
