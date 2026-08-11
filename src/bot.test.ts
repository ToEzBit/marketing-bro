/**
 * Run with: npx tsx src/bot.test.ts
 * The `/task` race of issue #3, driven through the real Bot: a Member's
 * message lands in the thread while `/task` is still posting its intro
 * message. Discord and the Claude Code subprocess are faked; the routing
 * between `/task`, a thread message and `/stop` is the bot's own code.
 *
 * The bug this pins down: while `/task` awaited Discord, the thread had a
 * TaskRecord but no session, so the message built one — and `/task` then
 * overwrote it, leaving the first session orphaned (holding a subprocess that
 * `/stop`, the idle sweeper and shutdown could no longer reach).
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionHooks, TurnSummary } from "./agent-session.js";
import { Bot } from "./bot.js";
import type { Config } from "./config.js";
import type { OfficeServerHandle, OfficeSnapshot } from "./office/types.js";
import type { ScheduleRecord } from "./schedule-store.js";
import type { RunOutcome } from "./scheduler.js";

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

/** Positive expectations poll until they hold (or time out and fail)… */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** …while "nothing else happened" gets a settle window. */
function settle(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const MEMBER = "member-1";
const PROMPT = "ช่วยสรุปไฟล์ในโฟลเดอร์นี้";
const FOLLOW_UP = "อ๋อ เอาเฉพาะไฟล์ md พอ";

/** Stands in for an AgentSession: records what it was told, spawns nothing. */
type FakeSession = {
  /** Prompts handed over with send(). */
  sent: string[];
  /** Messages injected into a running turn with steer(). */
  steered: string[];
  isBusy: boolean;
  idleForMs: number;
  interrupted: boolean;
  /** close() was entered — i.e. the hand-over has begun. */
  closeStarted: boolean;
  closed: boolean;
  /** When set, close() hangs on it — a slow hand-over. */
  closeGate?: Promise<void>;
};

type Harness = {
  bot: Bot;
  /** Every session the bot built, in order. A second one is the bug. */
  sessions: FakeSession[];
  thread: { id: string; sent: string[] };
  /** Lets `/task`'s intro message finish posting. */
  releaseIntro: () => void;
  runTask: () => Promise<void>;
  deliver: (content: string) => Promise<void>;
  stop: () => Promise<void>;
  /** The session the register holds for the thread, if any. */
  registered: () => FakeSession | undefined;
  registeredCount: () => number;
  // ── Office UI (ticket #19) ────────────────────────────────────────────────
  /** The room as the page would see it, straight off the live objects. */
  snapshot: () => OfficeSnapshot;
  /** The hooks a Task session runs under — where three of the five feed writes live. */
  hooks: (options: { threadId: string; persist: boolean }) => SessionHooks;
  /** What `startEngine()` does about the page, on its own. */
  openOfficeUi: () => Promise<void>;
  officeUi: () => OfficeServerHandle | undefined;
  /** The login path in full, page included. */
  startEngine: () => Promise<void>;
  /** Counts writes to the outcome feed from the moment it is called. */
  countFeedWrites: () => () => number;
  /** Counts Discord channel fetches — the snapshot must never make one. */
  countChannelFetches: () => () => number;
  /** Pretends a Task already got its once-per-Task browser Approval (ADR 0003). */
  preapproveBrowser: (threadId: string) => void;
  /** Makes every schedule thread lookup fail, the way a deleted channel does. */
  loseScheduleThreads: () => void;
  /** One round of a schedule, driven through the bot's own code. */
  runScheduled: (record: ScheduleRecord) => Promise<RunOutcome>;
};

async function harness(options: { officeUiPort?: number } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "bot-race-test-"));
  const config: Config = {
    discordToken: "token",
    discordAppId: "app",
    discordGuildId: "guild",
    oauthToken: "oauth",
    allowedUserIds: [MEMBER],
    operatorUserId: MEMBER,
    defaultWorkspace: dir,
    defaultModel: "sonnet",
    extraBashAllow: [],
    approvalTimeoutMs: 1000,
    sessionIdleTimeoutMs: 1000,
    sessionStatePath: join(dir, "sessions.json"),
    scheduleStatePath: join(dir, "schedules.json"),
    browserProfileDir: join(dir, "browser-profile"),
    browserAutoApprove: false,
    skillsDir: join(dir, "skills"),
    skillsPluginDir: join(dir, "skills-plugin"),
    // Off by default: the race tests below are about the bot, not the
    // read-only web page (ADR 0002). The Office UI tests opt in per case.
    officeUiPort: options.officeUiPort,
  };
  const bot = new Bot(config);
  // The bot's private surface is what the race lives in; the test drives it
  // directly rather than standing up a real Discord gateway.
  const inner = bot as unknown as Record<string, (...args: unknown[]) => unknown>;
  // Bound by name, so a rename would quietly turn the stub below into a dead
  // property and let this test spawn real Claude Code subprocesses. Fail loudly
  // instead.
  const proto = Object.getPrototypeOf(bot) as Record<string, unknown>;
  for (const name of ["createSession", "onTask", "onMessage", "onStop"]) {
    assert.equal(
      typeof proto[name],
      "function",
      `Bot.${name} was renamed — point this test at the new name before it spawns real sessions`,
    );
  }
  // Same trick for the Office UI wiring (ticket #19): renaming one of these
  // would leave the checks below asserting against undefined instead of code.
  for (const name of [
    "buildHooks",
    "describeThread",
    "fetchScheduleThread",
    "officeSnapshot",
    "openOfficeUi",
    "runScheduledOnce",
    "startEngine",
    "waitForBrowser",
  ]) {
    assert.equal(typeof proto[name], "function", `Bot.${name} was renamed — update this test`);
  }

  const intro = deferred();
  const thread = {
    id: "thread-1",
    sent: [] as string[],
    isThread: () => true,
    send: async (content: string) => {
      thread.sent.push(String(content));
      // `/task` announcing the new task: the await that used to leave the
      // thread session-less.
      await intro.promise;
      return { id: `msg-${thread.sent.length}` };
    },
  };

  const sessions: FakeSession[] = [];
  const reporter = {
    clearStatus: async () => undefined,
    say: async () => undefined,
    addActivity: () => undefined,
    setHeadline: () => undefined,
    attach: async () => undefined,
    // The read-only side the Office UI snapshot reads off a reporter (spec §6.5).
    threadName: "เธรดทดสอบ",
    threadUrl: undefined,
    currentHeadline: "",
  };
  inner.createSession = (_thread: unknown, record: unknown) => {
    const state: FakeSession = {
      sent: [],
      steered: [],
      isBusy: false,
      idleForMs: 0,
      interrupted: false,
      closeStarted: false,
      closed: false,
    };
    sessions.push(state);
    const session = {
      /** Back-reference, so the test can tell which session got registered. */
      state,
      get isBusy() {
        return state.isBusy;
      },
      get idleForMs() {
        return state.idleForMs;
      },
      // The read-only getters the Office UI snapshot reads off a session
      // (spec §6.2). Which zone each combination lands in is
      // src/office/snapshot.test.ts's job, not this file's.
      get isStopping() {
        return state.isBusy && state.interrupted;
      },
      get isClosed() {
        return state.closed;
      },
      startedAt: Date.now(),
      pendingApprovals: [],
      send: async (text: string) => {
        if (state.isBusy) {
          state.steered.push(text);
          return;
        }
        state.sent.push(text);
      },
      steer: (text: string) => state.steered.push(text),
      interrupt: async () => {
        state.interrupted = true;
      },
      close: async () => {
        state.closeStarted = true;
        if (state.closeGate) await state.closeGate;
        state.closed = true;
      },
    };
    return { session, reporter, record };
  };

  const interaction = {
    id: "interaction-1",
    user: { id: MEMBER },
    channel: thread,
    options: {
      getString: (name: string) => (name === "prompt" ? PROMPT : null),
      getBoolean: () => null,
    },
    reply: async () => undefined,
    fetchReply: async () => ({ id: "reply-1" }),
  };

  /** The bot's own register — asserted against directly, no shadow copy. */
  const registry = () =>
    (
      bot as unknown as {
        sessions: {
          get: (id: string) => { session: { state: FakeSession } } | undefined;
          size: number;
        };
      }
    ).sessions;

  return {
    bot,
    sessions,
    thread,
    releaseIntro: intro.release,
    runTask: () => inner.onTask!(interaction) as Promise<void>,
    deliver: (content: string) =>
      inner.onMessage!({
        author: { id: MEMBER, bot: false },
        content,
        channel: thread,
        react: async () => undefined,
      }) as Promise<void>,
    stop: () =>
      inner.onStop!({
        user: { id: MEMBER },
        channel: thread,
        reply: async () => undefined,
      }) as Promise<void>,
    registered: () => registry().get(thread.id)?.session.state,
    registeredCount: () => registry().size,
    snapshot: () => inner.officeSnapshot!() as OfficeSnapshot,
    hooks: ({ threadId, persist }) =>
      inner.buildHooks!({
        reporter,
        channel: thread,
        record: {
          threadId,
          ownerId: MEMBER,
          workspace: dir,
          model: "sonnet",
          createdAt: new Date().toISOString(),
        },
        persist,
      }) as SessionHooks,
    openOfficeUi: () => inner.openOfficeUi!() as Promise<void>,
    officeUi: () => (bot as unknown as { officeUi?: OfficeServerHandle }).officeUi,
    startEngine: () => inner.startEngine!() as Promise<void>,
    countFeedWrites: () => {
      const feed = (bot as unknown as { outcomeFeed: { record: (entry: unknown) => void } })
        .outcomeFeed;
      const original = feed.record.bind(feed);
      let count = 0;
      feed.record = (entry: unknown) => {
        count += 1;
        original(entry);
      };
      return () => count;
    },
    countChannelFetches: () => {
      const channels = (bot as unknown as { client: { channels: { fetch: unknown } } }).client
        .channels;
      let count = 0;
      channels.fetch = async () => {
        count += 1;
        return null;
      };
      return () => count;
    },
    preapproveBrowser: (threadId: string) => {
      (bot as unknown as { browserApproved: Set<string> }).browserApproved.add(threadId);
    },
    loseScheduleThreads: () => {
      // Stubbed rather than left to discord.js: with no gateway there is no
      // thread to find anyway, and a real REST attempt would only be slower.
      inner.fetchScheduleThread = async () => {
        throw new Error("both its thread and its channel are gone");
      };
    },
    runScheduled: (record: ScheduleRecord) =>
      inner.runScheduledOnce!(record) as Promise<RunOutcome>,
  };
}

/** A schedule as the store would hold it. */
function schedule(id: string): ScheduleRecord {
  return {
    id,
    ownerId: MEMBER,
    channelId: "channel-1",
    threadId: `thread-of-${id}`,
    prompt: "สรุปยอดขายรายวัน",
    workspace: tmpdir(),
    model: "sonnet",
    recurrence: { kind: "clock", hour: 9, minute: 0, everyDays: 1 },
    browserGrant: false,
    paused: false,
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

/** A finished turn, as the SDK would report it. */
function turn(status: TurnSummary["status"], errors?: string[]): TurnSummary {
  return { status, durationMs: 1200, turns: 2, costUsd: 0, ...(errors ? { errors } : {}) };
}

console.log("`/task` racing a message in the same thread (issue #3)");

await check("a message arriving while /task is posting joins that task's session", async () => {
  const h = await harness();
  const task = h.runTask();
  // `/task` is inside thread.send now: the TaskRecord exists, the session does not.
  await until(() => h.thread.sent.length === 1);
  assert.equal(h.sessions.length, 0, "no session has been built yet");

  const incoming = h.deliver(FOLLOW_UP);
  await settle();
  assert.equal(h.sessions.length, 0, "the message must wait for /task, not build a rival session");

  h.releaseIntro();
  await task;
  await incoming;

  assert.equal(h.sessions.length, 1, "exactly one Agent Session was built for the thread");
  const session = h.sessions[0]!;
  assert.deepEqual(
    [...session.sent, ...session.steered].sort(),
    [PROMPT, FOLLOW_UP].sort(),
    "the task prompt and the member's message reached the same session",
  );
  assert.equal(h.registeredCount(), 1);
  assert.equal(h.registered(), session, "the one session is the registered one — nothing orphaned");

  // Nothing escaped the register: /stop reaches the session holding the subprocess.
  await h.stop();
  assert.equal(session.interrupted, true);
});

await check("a message that arrives after /task finished goes to the same session", async () => {
  const h = await harness();
  h.releaseIntro();
  await h.runTask();
  await h.deliver(FOLLOW_UP);
  assert.equal(h.sessions.length, 1);
  assert.deepEqual(h.sessions[0]!.sent, [PROMPT, FOLLOW_UP]);
});

await check("a message during a running turn is steered into it, not given a new session", async () => {
  const h = await harness();
  h.releaseIntro();
  await h.runTask();
  h.sessions[0]!.isBusy = true;
  await h.deliver(FOLLOW_UP);
  assert.equal(h.sessions.length, 1);
  assert.deepEqual(h.sessions[0]!.steered, [FOLLOW_UP]);
});

console.log("\n`/task` again in the same thread (start over)");

await check("the old session is closed before the new one takes the thread", async () => {
  const h = await harness();
  h.releaseIntro();
  await h.runTask();
  await h.runTask();
  assert.equal(h.sessions.length, 2, "the second /task built a new session");
  assert.equal(h.sessions[0]!.closed, true, "the old session was closed, not orphaned");
  assert.equal(h.registered(), h.sessions[1]);
  assert.equal(h.registeredCount(), 1);
});

await check("a message during a slow hand-over lands on the new session", async () => {
  const h = await harness();
  h.releaseIntro();
  await h.runTask();
  // The old session takes its time closing — the window a message used to
  // slip through.
  const closing = deferred();
  h.sessions[0]!.closeGate = closing.promise;

  const second = h.runTask();
  // Wait until the hand-over is actually under way: the old session is being
  // closed and the new one does not exist yet.
  await until(() => h.sessions[0]!.closeStarted);
  assert.equal(h.sessions[0]!.closed, false);
  const incoming = h.deliver(FOLLOW_UP);
  await settle();
  assert.equal(h.sessions.length, 1, "no third session while the old one is closing");

  closing.release();
  await second;
  await incoming;
  assert.equal(h.sessions.length, 2, "exactly one replacement session");
  assert.equal(h.sessions[0]!.closed, true);
  const fresh = h.sessions[1]!;
  assert.deepEqual([...fresh.sent, ...fresh.steered].sort(), [PROMPT, FOLLOW_UP].sort());
  assert.equal(h.registered(), fresh);
  assert.equal(h.registeredCount(), 1);
});

console.log("\nOffice UI ต่อสายเข้าบอทจริง (ticket #19)");

await check("/task แล้วห้องเห็นตัวละครทันที ตั้งแต่ slot ยังเป็น pending", async () => {
  const h = await harness();
  const task = h.runTask();
  // Inside thread.send: the slot is reserved, the session does not exist yet —
  // exactly the moment the room must already show someone walking in (spec §5.4).
  await until(() => h.thread.sent.length === 1);
  assert.equal(h.sessions.length, 0, "ยังไม่มี session — slot ยังเป็น pending");

  const room = h.snapshot();
  assert.equal(room.sessions.length, 1, "ตัวละครของเธรดโผล่ในห้องแล้ว");
  const character = room.sessions[0]!;
  assert.equal(character.id, h.thread.id);
  assert.equal(character.kind, "task");
  assert.equal(character.state, "working");
  assert.equal(character.detail, "กำลังเข้ามา");

  h.releaseIntro();
  await task;
});

await check("turn ที่จบแบบ failed ทิ้ง entry ไว้ใน feed และตัวละครขึ้น state failed", async () => {
  const h = await harness();
  // A thread the register does not hold, so the ghost is what the room shows —
  // a live character with the same id would win the assembler's dedupe.
  const hooks = h.hooks({ threadId: "thread-ghost", persist: true });
  await hooks.onTurnEnd(turn("failed", ["อ่านไฟล์ config ไม่ได้"]));

  const ghosts = h.snapshot().outcomeFeed;
  assert.equal(ghosts.length, 1, "ผีหนึ่งตัวใน feed");
  assert.equal(ghosts[0]!.id, "thread-ghost");
  assert.equal(ghosts[0]!.state, "failed");
  assert.equal(ghosts[0]!.outcome?.status, "failed");
  assert.equal(ghosts[0]!.outcome?.reason, "อ่านไฟล์ config ไม่ได้");

  // …and a turn that went fine sends the ghost home again (spec §5.5).
  await hooks.onTurnEnd(turn("ok"));
  assert.deepEqual(h.snapshot().outcomeFeed, [], "ตัวเดิมกลับมาทำงานได้ ผีถูกล้างทิ้ง");
});

await check("session ที่ตายแบบ wasResuming ไม่ทิ้งอะไรไว้ใน feed", async () => {
  const h = await harness();
  const hooks = h.hooks({ threadId: "thread-resuming", persist: true });
  // Recoverable by typing again, so it leaves the room quietly (spec §5.3).
  await hooks.onFatal(new Error("บริบทเดิมหมดอายุ"), true);
  assert.deepEqual(h.snapshot().outcomeFeed, [], "ไม่มีผีจากการตายแบบ resuming");

  // The same death that is not a resume does leave one — otherwise this test
  // would still pass with the feed write deleted entirely.
  await hooks.onFatal(new Error("เซสชันพัง"), false);
  const ghosts = h.snapshot().outcomeFeed;
  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0]!.id, "thread-resuming");
  assert.equal(ghosts[0]!.state, "failed");
});

await check("/ask ไม่เป็นตัวละคร — hooks ที่ไม่ persist ไม่เขียน feed", async () => {
  const h = await harness();
  const hooks = h.hooks({ threadId: "ask:interaction-9", persist: false });
  await hooks.onTurnEnd(turn("failed", ["พัง"]));
  await hooks.onFatal(new Error("พังอีก"), false);
  assert.deepEqual(h.snapshot().outcomeFeed, [], "/ask ไม่มี identity ในห้อง (spec §1.1)");
});

await check("Run ที่หาเธรดไม่เจอ ลง feed ด้วยคีย์ schedule:<id> ไม่ใช่ id เปล่า", async () => {
  const h = await harness();
  h.loseScheduleThreads();
  const record = schedule("a1c9");

  assert.equal(await h.runScheduled(record), "failure");

  const ghosts = h.snapshot().outcomeFeed;
  assert.equal(ghosts.length, 1, "รอบที่ไม่มีเธรดให้โพสต์ เห็นได้ที่ห้องนี้ที่เดียว");
  // The load-bearing assertion: a bare schedule id here would not match the
  // live Run's character key, and the assembler's dedupe would quietly stop
  // working — a ghost standing next to the round that is still going.
  assert.equal(ghosts[0]!.id, "schedule:a1c9");
  assert.equal(ghosts[0]!.kind, "run");
  assert.equal(ghosts[0]!.state, "failed");
  assert.equal(ghosts[0]!.outcome?.reason, "หาเธรดของ schedule ไม่เจอ");
  assert.equal(ghosts[0]!.threadId, record.threadId);
});

await check("officeSnapshot อ่านชื่อเธรดจาก cache เท่านั้น ไม่เคย fetch", async () => {
  const h = await harness();
  const fetches = h.countChannelFetches();
  h.releaseIntro();
  await h.runTask();
  h.loseScheduleThreads();
  await h.runScheduled(schedule("b2d0"));

  // Called once a second by the server, so a fetch in here would mean a Discord
  // REST call every second for as long as a page is open (spec §6.6).
  h.snapshot();
  h.snapshot();
  assert.equal(fetches(), 0, "ไม่มี fetch สักครั้งจากการประกอบ snapshot");
});

await check("ไม่ตั้ง OFFICE_UI_PORT → ไม่มี server ไม่มี timer เพิ่มสักตัว", async () => {
  const h = await harness();
  const owned = (): number =>
    process
      .getActiveResourcesInfo()
      .filter((kind) => kind === "Timeout" || kind === "TCPSERVERWRAP").length;
  const before = owned();
  await h.openOfficeUi();
  assert.equal(h.officeUi(), undefined, "ไม่มี handle");
  assert.equal(owned(), before, "ไม่มี timer และไม่มี server socket เพิ่มขึ้นมา");
});

await check("ปิดบอทแล้ว handle ของ Office UI ถูกปิดด้วย", async () => {
  // Port 0 = let the OS pick, so a busy port on the dev machine cannot make
  // this flaky (the same trick src/office/server.test.ts uses).
  const h = await harness({ officeUiPort: 0 });
  await h.openOfficeUi();
  const handle = h.officeUi();
  assert.ok(handle, "server ต้องเปิดขึ้นเมื่อมี OFFICE_UI_PORT");
  const live = await fetch(`http://127.0.0.1:${handle.port}/state`);
  assert.equal(live.status, 200, "หน้าเว็บเสิร์ฟ snapshot ของบอทจริงอยู่");
  assert.equal(((await live.json()) as OfficeSnapshot).v, 1);

  await h.bot.shutdown();
  assert.equal(h.officeUi(), undefined, "handle ถูกปล่อยแล้ว");
  await assert.rejects(
    fetch(`http://127.0.0.1:${handle.port}/state`),
    "พอร์ตต้องปิดจริง ไม่ใช่แค่ลืม handle",
  );
});

await check("server เปิดไม่ขึ้น → บอทยังเข้า Discord และรับงานได้ตามปกติ", async () => {
  const blocker = createServer(() => undefined);
  await new Promise<void>((ready) => blocker.listen(0, "127.0.0.1", ready));
  const taken = (blocker.address() as AddressInfo).port;

  const h = await harness({ officeUiPort: taken });
  // startEngine() is the whole post-login path — it must not throw here.
  await h.startEngine();
  assert.equal(h.officeUi(), undefined, "fail-soft: ไม่มีหน้าเว็บ แต่ไม่ล้ม");

  h.releaseIntro();
  await h.runTask();
  assert.equal(h.sessions.length, 1, "บอทยังรับ /task ได้ตามปกติ");

  await h.bot.shutdown();
  await new Promise<void>((done) => blocker.close(() => done()));
});

await check("เส้นทางร้อนเดิมไม่แตะ outcome feed (decide / waitForBrowser / onApprovalNeeded)", async () => {
  const h = await harness();
  const writes = h.countFeedWrites();
  const hooks = h.hooks({ threadId: h.thread.id, persist: true });
  const { signal } = new AbortController();

  const read = await hooks.decide("Read", { file_path: join(tmpdir(), "x.md") }, { signal });
  assert.equal(read.action, "allow", "tool อ่านล้วนผ่านฉลุยเหมือนเดิม");

  // A browser call that already has its once-per-Task Approval goes through
  // waitForBrowser — the queue is empty, so it gets the browser straight away.
  h.preapproveBrowser(h.thread.id);
  const browser = await hooks.decide("mcp__browser__browser_navigate", { url: "https://x" }, { signal });
  assert.equal(browser.action, "allow", "ได้คิว browser ทันทีเมื่อไม่มีใครถือ");
  assert.equal(h.snapshot().browserQueue.holder, h.thread.id);

  assert.equal(writes(), 0, "ไม่มีการเขียน feed จากเส้นทางร้อนเลยสักครั้ง");

  // Belt and braces: the two paths the behaviour above cannot drive without a
  // real Discord approval button must not have gained an await into the feed.
  const proto = Object.getPrototypeOf(h.bot) as Record<string, () => string>;
  const built = proto.buildHooks!.toString();
  const beforeTurnEnd = built.slice(0, built.indexOf("onTurnEnd:"));
  assert.ok(
    beforeTurnEnd.includes("decide:") && beforeTurnEnd.includes("onApprovalNeeded:"),
    "ทั้งสองเส้นทางอยู่เหนือ onTurnEnd จริง — ไม่งั้นการตัดข้างล่างนี้ไม่ได้ตรวจอะไรเลย",
  );
  for (const source of [beforeTurnEnd, proto.waitForBrowser!.toString()]) {
    assert.ok(
      !/outcomeFeed|recordTaskOutcome|recordRunOutcome|officeSnapshot/.test(source),
      "เส้นทางร้อนต้องไม่มีโค้ดของ Office UI แทรกอยู่",
    );
  }
});

if (failures > 0) {
  console.error(`\n${failures} bot test(s) failed`);
  process.exit(1);
}
console.log("\nall bot tests passed");
// discord.js's Client is built (never logged in) and may keep handles around;
// the assertions are done, so the run ends here instead of hanging npm test.
process.exit(0);
