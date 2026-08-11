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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bot } from "./bot.js";
import type { Config } from "./config.js";

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
};

async function harness(): Promise<Harness> {
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
    // Office UI off — this harness tests the bot, not the read-only web page (ADR 0002).
    officeUiPort: undefined,
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
  };
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

if (failures > 0) {
  console.error(`\n${failures} bot test(s) failed`);
  process.exit(1);
}
console.log("\nall bot tests passed");
// discord.js's Client is built (never logged in) and may keep handles around;
// the assertions are done, so the run ends here instead of hanging npm test.
process.exit(0);
