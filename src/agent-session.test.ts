/**
 * Run with: npx tsx src/agent-session.test.ts
 * Asserts the turn lifecycle of an Agent Session: when it counts as busy, that
 * `/stop` reaches the SDK and reads as a stop rather than a failure, and that a
 * real failure never shows the SDK's internal diagnostics to a Member.
 *
 * No Claude Code subprocess is started — the session's SDK query is injected,
 * and the tests script the message stream by hand. That is why these run in
 * `npm test`: they cost no subscription quota.
 *
 * The wording a Member reads is asserted against the real `formatSummary`, so
 * this file imports bot.ts — which drags in discord.js and config.ts's
 * `loadEnv()`. Nothing here reads the environment; it just means this is the
 * one test in `npm test` that touches .env at all.
 *
 * MANUAL TEST (against the real SDK — costs quota, so it stays out of npm test)
 * The scripted messages below are modelled on a live run of SDK 0.3.220; to
 * confirm the real thing still behaves that way:
 *   1. `npm run dev`, then `/task prompt: นับ 1 ถึง 300 ช้า ๆ ทีละบรรทัด`
 *   2. While it is counting, `/stop` in that thread.
 *      Expect: "🛑 หยุดโดยผู้ใช้ (Xs)" — never "⚠️ จบแบบมีปัญหา", and no
 *      `[ede_diagnostic] …` text in the thread. The Host console keeps the
 *      full result (look for the `[agent] turn failed` line — it should NOT
 *      appear for a stop, only for a genuine failure).
 *   3. For the steer path: start a long task, and the moment the turn ends,
 *      type a follow-up in the thread (the bot reacts 👀 when it steers into a
 *      running turn, and answers normally when it opens a new one). While that
 *      new turn runs, `/status` must show 🟢 for the thread and `/stop` must
 *      end it — before this ticket both were silently wrong.
 *   4. If the SDK's result shape drifts, print the raw result message
 *      (`console.error(JSON.stringify(message))` in AgentSession.handle) and
 *      update the fixtures here. Only `terminal_reason` is read from it, and
 *      only as a secondary signal, so a rename degrades to "the flag decides".
 */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import type { CanUseTool, PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentSession,
  type AgentStream,
  type SessionHooks,
  type TurnSummary,
} from "./agent-session.js";
import { formatSummary } from "./bot.js";

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

/** A tick long enough for the session's message pump to drain what was emitted. */
function settle(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stands in for the SDK's query: a message stream the test writes into, plus
 * the interrupt control channel, which it counts calls on.
 */
class ScriptedStream implements AgentStream {
  private readonly pending: SDKMessage[] = [];
  private waiting: ((result: IteratorResult<SDKMessage>) => void) | undefined;
  private done = false;
  /** How many times the session asked the SDK to interrupt. */
  interrupts = 0;

  async interrupt(): Promise<undefined> {
    this.interrupts += 1;
    return undefined;
  }

  /** Pushes one message at the session and waits for it to be handled. */
  async emit(message: SDKMessage): Promise<void> {
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value: message, done: false });
    } else {
      this.pending.push(message);
    }
    await settle();
  }

  /** Ends the stream, the way a real query ends when its session is aborted. */
  end(): void {
    if (this.done) return;
    this.done = true;
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const next = this.pending.shift();
        if (next) return Promise.resolve({ value: next, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

type Harness = {
  session: AgentSession;
  stream: ScriptedStream;
  summaries: TurnSummary[];
  /**
   * The permission callback the session handed the SDK — the way a tool call
   * reaches it in production. Calling it directly is how these tests stand in
   * for a tool the policy escalated.
   */
  canUseTool: CanUseTool;
  /** Ends the scripted stream and closes the session. */
  finish: () => Promise<void>;
};

/** The hooks a test cares about; everything else keeps its silent default. */
type HarnessOptions = {
  decide?: SessionHooks["decide"];
  onApprovalNeeded?: SessionHooks["onApprovalNeeded"];
};

function startSession(overrides: HarnessOptions = {}): Harness {
  const stream = new ScriptedStream();
  const summaries: TurnSummary[] = [];
  // The executor of the SDK query runs synchronously in the constructor, so
  // this is set before any test can reach for it.
  let canUseTool!: CanUseTool;
  const session = new AgentSession(
    { workspace: tmpdir(), model: "sonnet", oauthToken: "" },
    {
      onText: () => undefined,
      onActivity: () => undefined,
      onHeadline: () => undefined,
      onSessionId: () => undefined,
      onFatal: (error) => console.error("  unexpected onFatal:", error),
      decide: overrides.decide ?? (() => ({ action: "deny", reason: "no tool calls in these tests" })),
      onApprovalNeeded:
        overrides.onApprovalNeeded ?? (async () => ({ behavior: "deny", message: "not used here" })),
      onSendFile: async () => undefined,
      onTurnEnd: (summary) => {
        summaries.push(summary);
      },
    },
    ({ options }) => {
      // A real query stops iterating when the session aborts it; close() waits
      // for the pump, so the scripted stream has to do the same.
      options.abortController?.signal.addEventListener("abort", () => stream.end());
      canUseTool = options.canUseTool!;
      return stream;
    },
  );
  return {
    session,
    stream,
    summaries,
    canUseTool,
    finish: async () => {
      stream.end();
      await session.close();
    },
  };
}

let nextToolUseId = 1;

/** The context the SDK passes a permission request; only the signal is read. */
function toolContext(signal = new AbortController().signal): Parameters<CanUseTool>[2] {
  const id = `tool-${nextToolUseId++}`;
  return { signal, toolUseID: id, requestId: id };
}

/**
 * The SDK's messages carry a dozen accounting fields the session never reads.
 * These fixtures fill in the ones it does and leave the rest off.
 */
function assistantText(text: string): SDKMessage {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  } as unknown as SDKMessage;
}

function resultSuccess(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 2000,
    num_turns: 2,
    total_cost_usd: 0.01,
    terminal_reason: "completed",
  } as unknown as SDKMessage;
}

/**
 * What SDK 0.3.220 actually reports after `interrupt()` (measured on a live
 * run): an execution error whose only detail is an internal diagnostic.
 */
function resultAfterInterrupt(): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    errors: ["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"],
    terminal_reason: "aborted_streaming",
    duration_ms: 4500,
    num_turns: 3,
    total_cost_usd: 0.02,
  } as unknown as SDKMessage;
}

/** The other failure shape: a "success" result the SDK flagged as an error. */
function resultSuccessButError(text: string): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: true,
    result: text,
    duration_ms: 900,
    num_turns: 1,
    total_cost_usd: 0.01,
  } as unknown as SDKMessage;
}

/** A turn that genuinely broke: same error shape, but nothing was aborted. */
function resultFailure(errors: string[]): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    errors,
    terminal_reason: "model_error",
    duration_ms: 1200,
    num_turns: 1,
    total_cost_usd: 0.01,
  } as unknown as SDKMessage;
}

console.log("a plain turn");

await check("send → messages → success result: summary ok, session idle again", async () => {
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("ทำงานหน่อย");
  assert.equal(session.isBusy, true, "the session is busy from the moment it is sent to");

  await stream.emit(assistantText("กำลังทำ"));
  assert.equal(session.isBusy, true);
  await stream.emit(resultSuccess());
  await sending;

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.status, "ok");
  assert.equal(session.isBusy, false, "the result ends the turn");
  await finish();
});

console.log("\na turn nobody called send() for (steer landing as the next turn)");

await check("messages arriving after a turn ended make the session busy again", async () => {
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("งานแรก");
  await stream.emit(assistantText("รับทราบ"));
  await stream.emit(resultSuccess());
  await sending;
  assert.equal(session.isBusy, false);

  // The classic race: the message is steered in just as the first turn ends,
  // so the SDK opens a new turn for it that nothing on our side started.
  session.steer("เปลี่ยนใจ ทำอีกอย่างแทน");
  await stream.emit(assistantText("ได้เลย เริ่มใหม่"));

  assert.equal(session.isBusy, true, "/status must show this thread as working");
  await session.interrupt();
  assert.equal(stream.interrupts, 1, "/stop must reach the SDK, not be swallowed");

  await stream.emit(resultAfterInterrupt());
  assert.equal(summaries.length, 2);
  assert.equal(summaries[1]?.status, "interrupted");
  assert.equal(session.isBusy, false);
  await finish();
});

console.log("\nstopping on purpose");

await check("a turn the user stopped is interrupted, not failed", async () => {
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("งานยาว");
  await stream.emit(assistantText("เริ่มแล้ว"));

  await session.interrupt();
  assert.equal(stream.interrupts, 1);
  await stream.emit(resultAfterInterrupt());
  await sending;

  assert.equal(summaries[0]?.status, "interrupted");
  assert.equal(session.isBusy, false);
  await finish();
});

await check("the stop shows up as a neutral message, with no SDK diagnostic in it", async () => {
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("งานยาว");
  await stream.emit(assistantText("เริ่มแล้ว"));
  await session.interrupt();
  await stream.emit(resultAfterInterrupt());
  await sending;

  const text = formatSummary(summaries[0]!);
  assert.match(text, /🛑/);
  assert.match(text, /หยุดโดยผู้ใช้/);
  assert.doesNotMatch(text, /⚠️/, "a stop is not a warning");
  assert.doesNotMatch(text, /ede_diagnostic/, "internal diagnostics stay on the Host");
  await finish();
});

await check("an abort nobody flagged is not blamed on the user", async () => {
  // terminal_reason is corroboration only (spec #4: ธงผู้ใช้เป็นสัญญาณหลัก) — an
  // abort that never went through interrupt() (a session closing under it,
  // say) must not render as "หยุดโดยผู้ใช้", because nobody pressed /stop.
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("งานยาว");
  await stream.emit(assistantText("เริ่มแล้ว"));
  await stream.emit(resultAfterInterrupt());
  await sending;

  assert.equal(summaries[0]?.status, "failed");
  const text = formatSummary(summaries[0]!);
  assert.doesNotMatch(text, /หยุดโดยผู้ใช้/, "no user asked for this stop");
  assert.doesNotMatch(text, /ede_diagnostic/, "internal diagnostics stay on the Host");
  await finish();
});

await check("a stop asked for while idle does not colour the next turn", async () => {
  const { session, stream, summaries, finish } = startSession();
  await session.interrupt();
  assert.equal(stream.interrupts, 1, "the brake works even with no turn running");

  const sending = session.send("งานใหม่");
  await stream.emit(assistantText("เริ่ม"));
  await stream.emit(resultSuccess());
  await sending;

  assert.equal(summaries[0]?.status, "ok", "the stale stop flag must not leak into this turn");
  await finish();
});

console.log("\ngenuine failures");
console.log("  (the `[agent] turn failed` lines below are the Host log these tests are about)");

await check("a turn that broke on its own is still a failure", async () => {
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("งานที่พัง");
  await stream.emit(assistantText("ลองดู"));
  await stream.emit(resultFailure(["Claude Code process exited with code 1"]));
  await sending;

  assert.equal(summaries[0]?.status, "failed");
  assert.deepEqual(summaries[0]?.errors, ["Claude Code process exited with code 1"]);
  assert.match(formatSummary(summaries[0]!), /⚠️/);
  await finish();
});

await check("a failure never shows the SDK's raw diagnostics to a Member", async () => {
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("งานที่พัง");
  await stream.emit(assistantText("ลองดู"));
  await stream.emit(
    resultFailure([
      "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use",
      "Claude Code process exited with code 1",
    ]),
  );
  await sending;

  const text = formatSummary(summaries[0]!);
  assert.match(text, /⚠️/);
  assert.doesNotMatch(text, /ede_diagnostic/, "the diagnostic tag stays on the Host");
  assert.match(text, /exited with code 1/, "what a human can act on still shows");
  await finish();
});

await check("a success result flagged as an error keeps its prose detail", async () => {
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("งานที่พัง");
  await stream.emit(assistantText("ลองดู"));
  await stream.emit(resultSuccessButError("อ่านไฟล์ config ไม่ได้"));
  await sending;

  assert.equal(summaries[0]?.status, "failed");
  assert.match(formatSummary(summaries[0]!), /อ่านไฟล์ config ไม่ได้/);
  await finish();
});

await check("a failure with nothing but diagnostics points at the Host log", async () => {
  const { session, stream, summaries, finish } = startSession();
  const sending = session.send("งานที่พัง");
  await stream.emit(assistantText("ลองดู"));
  await stream.emit(resultFailure(["[ede_diagnostic] result_type=user stop_reason=tool_use"]));
  await sending;

  const text = formatSummary(summaries[0]!);
  assert.match(text, /⚠️/);
  assert.doesNotMatch(text, /ede_diagnostic/);
  assert.match(text, /log ฝั่ง Host/, "the Member is told where the detail lives");
  await finish();
});

console.log("\nwhat the session can be asked about itself (read-only getters)");

await check("isStopping is true only while a running turn is being stopped", async () => {
  const { session, stream, finish } = startSession();
  assert.equal(session.isStopping, false, "a fresh session is not stopping");
  assert.equal(session.isClosed, false);

  const sending = session.send("งานยาว");
  await stream.emit(assistantText("เริ่มแล้ว"));
  assert.equal(session.isStopping, false, "busy, but nobody asked it to stop");

  await session.interrupt();
  assert.equal(session.isStopping, true);
  assert.equal(typeof session.stopRequestedAt, "number", "the clock counts up from here");

  await stream.emit(resultAfterInterrupt());
  await sending;
  assert.equal(session.isStopping, false, "the turn is over — nothing is being stopped");
  assert.equal(session.stopRequestedAt, undefined);

  await finish();
  assert.equal(session.isClosed, true);
});

await check("a /stop while idle is not a session being stopped", async () => {
  // The flag stays set for the next turn, but nothing is being stopped: this
  // session is simply idle, and reading the flag alone would say otherwise.
  const { session, finish } = startSession();
  await session.interrupt();
  assert.equal(session.isBusy, false);
  assert.equal(session.isStopping, false);
  await finish();
});

await check("startedAt and turnStartedAt frame the turn", async () => {
  const { session, stream, finish } = startSession();
  assert.ok(session.startedAt <= Date.now());
  // Read into a local before asserting it away: asserting on the getter itself
  // would narrow its type for the rest of this test.
  const betweenTurns = session.turnStartedAt;
  assert.equal(betweenTurns, undefined, "no turn is running yet");

  const sending = session.send("ทำงานหน่อย");
  const turnStartedAt = session.turnStartedAt;
  assert.equal(typeof turnStartedAt, "number");
  assert.ok(turnStartedAt! >= session.startedAt);

  await stream.emit(assistantText("กำลังทำ"));
  assert.equal(session.turnStartedAt, turnStartedAt, "same turn, same clock");

  await stream.emit(resultSuccess());
  await sending;
  assert.equal(session.turnStartedAt, undefined, "the turn is over");
  await finish();
});

await check("lastTurn keeps how the last turn ended, and when", async () => {
  const { session, stream, summaries, finish } = startSession();
  const beforeAnyTurn = session.lastTurn;
  assert.equal(beforeAnyTurn, undefined, "no turn has ended yet");

  const first = session.send("งานแรก");
  await stream.emit(assistantText("รับทราบ"));
  await stream.emit(resultSuccess());
  await first;
  assert.deepEqual(session.lastTurn?.summary, summaries[0]);
  assert.equal(session.lastTurn?.summary.status, "ok");
  const firstEndedAt = session.lastTurn!.endedAt;
  assert.ok(firstEndedAt <= Date.now());

  // The room shows the latest outcome, not a log: a second turn replaces it.
  const second = session.send("งานที่พัง");
  await stream.emit(assistantText("ลองดู"));
  await stream.emit(resultFailure(["Claude Code process exited with code 1"]));
  await second;
  assert.equal(session.lastTurn?.summary.status, "failed");
  assert.ok(session.lastTurn!.endedAt >= firstEndedAt);
  await finish();
});

console.log("\napprovals waiting on a human");

/** An approval the test answers by hand, the way a human answers one. */
function heldApproval(): {
  onApprovalNeeded: SessionHooks["onApprovalNeeded"];
  answer: (result: PermissionResult) => void;
} {
  let answer: (result: PermissionResult) => void = () => undefined;
  const answered = new Promise<PermissionResult>((resolve) => {
    answer = resolve;
  });
  return { onApprovalNeeded: () => answered, answer: (result) => answer(result) };
}

const escalate: SessionHooks["decide"] = () => ({ action: "ask", reason: "risky command" });

await check("a tool waiting on a human is listed, and gone once it is allowed", async () => {
  const held = heldApproval();
  const { session, canUseTool, finish } = startSession({
    decide: escalate,
    onApprovalNeeded: held.onApprovalNeeded,
  });
  const askedNobodyYet = session.pendingApprovals;
  assert.deepEqual(askedNobodyYet, [], "nothing has been asked yet");

  const before = Date.now();
  const deciding = canUseTool("Bash", { command: "rm -rf build" }, toolContext());
  await settle();

  const pending = session.pendingApprovals;
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.toolName, "Bash");
  assert.deepEqual(pending[0]?.input, { command: "rm -rf build" });
  assert.ok(pending[0]!.since >= before, "the approval's own clock starts when it is asked");

  held.answer({ behavior: "allow" });
  await deciding;
  assert.deepEqual(session.pendingApprovals, [], "answered — it leaves the list");
  await finish();
});

await check("a denied approval leaves the list too", async () => {
  const held = heldApproval();
  const { session, canUseTool, finish } = startSession({
    decide: escalate,
    onApprovalNeeded: held.onApprovalNeeded,
  });
  const deciding = canUseTool("Bash", { command: "rm -rf /" }, toolContext());
  await settle();
  assert.equal(session.pendingApprovals.length, 1);

  held.answer({ behavior: "deny", message: "ไม่อนุมัติ" });
  assert.deepEqual(await deciding, { behavior: "deny", message: "ไม่อนุมัติ" });
  assert.deepEqual(session.pendingApprovals, []);
  await finish();
});

await check("parallel tool calls each get their own entry", async () => {
  // Why this is a list and not one slot: the agent can call several tools at
  // once, and the second must not overwrite the first.
  const held = heldApproval();
  const { session, canUseTool, finish } = startSession({
    decide: escalate,
    onApprovalNeeded: held.onApprovalNeeded,
  });
  const first = canUseTool("Bash", { command: "rm -rf build" }, toolContext());
  const second = canUseTool("WebFetch", { url: "https://example.com" }, toolContext());
  await settle();

  assert.deepEqual(
    session.pendingApprovals.map((entry) => entry.toolName),
    ["Bash", "WebFetch"],
    "oldest first",
  );

  held.answer({ behavior: "allow" });
  await Promise.all([first, second]);
  assert.deepEqual(session.pendingApprovals, []);
  await finish();
});

await check("an approval killed by the tool call's abort leaves the list as well", async () => {
  // The path a plain `const result = await …` would leak: the approval never
  // gets an answer at all, it dies with the tool call it belongs to.
  const { session, canUseTool, finish } = startSession({
    decide: escalate,
    onApprovalNeeded: (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  });
  const abort = new AbortController();
  const deciding = canUseTool("Bash", { command: "sleep 999" }, toolContext(abort.signal));
  await settle();
  assert.equal(session.pendingApprovals.length, 1);

  abort.abort();
  await assert.rejects(deciding as Promise<unknown>, /aborted/);
  assert.deepEqual(session.pendingApprovals, [], "the removal runs on every way out");
  await finish();
});

await check("a tool the policy settles itself never shows up as waiting", async () => {
  const { session, canUseTool, finish } = startSession({
    decide: () => ({ action: "allow", reason: "read-only" }),
  });
  await canUseTool("Read", { file_path: "/tmp/x" }, toolContext());
  assert.deepEqual(session.pendingApprovals, [], "nobody was ever asked");
  await finish();
});

if (failures > 0) {
  console.error(`\n${failures} agent-session test(s) failed`);
  process.exit(1);
}
console.log("\nall agent-session tests passed");
