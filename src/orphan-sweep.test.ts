/**
 * Run with: npx tsx src/orphan-sweep.test.ts
 * Asserts the two-criteria targeting (this project's own SDK binary + a dead
 * parent, ppid 1) and the whole-subtree kill that clears an orphaned Task's
 * Browser Profile lock (issue #6) — all through a fake process table, so this
 * never touches a real process.
 *
 * Manual test note (NOT run here — costs real subscription quota, so this is
 * a recipe for a human to run by hand, not part of `npm test`):
 *   1. `/task` something with a long-running tool call (a slow Bash command,
 *      or a browser action) so a tool call is genuinely in flight.
 *   2. From another terminal, hard-kill the bot: `kill -9 <bot pid>` — not
 *      `/stop`, and not Ctrl-C (those are graceful; this must be SIGKILL).
 *   3. `ps -Ao pid=,ppid=,command= | grep claude-agent-sdk` — the CLI (and,
 *      if the Task had opened one, Chrome underneath it) should still be
 *      running with ppid 1, well past the ~5s an idle CLI takes to exit
 *      itself — that persistence past 115s mid-tool-call is the bug.
 *   4. Start the bot again (`npm run dev` or however it normally runs). The
 *      sweep runs first thing in `Bot.start()`; the pid(s) from step 3 should
 *      be logged as reaped, and gone from `ps` afterwards.
 *   5. A fresh Task that opens the Browser should succeed with no
 *      ProcessSingleton / "profile already in use" error — nothing is left
 *      holding the lock.
 */
import assert from "node:assert/strict";
import { isProjectSdkBinary, REPO_ROOT, sweepOrphans, type ProcessInfo } from "./orphan-sweep.js";

let failures = 0;

function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** This project's own binary path, built from the real REPO_ROOT this test runs from. */
const PROJECT_BINARY = `${REPO_ROOT}/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`;

/** Captures console.warn/console.error calls made during `fn`, then restores them. */
function captureConsole(fn: () => void): { warn: string[]; error: string[] } {
  const warn: string[] = [];
  const error: string[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: unknown[]) => warn.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => error.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  return { warn, error };
}

type KillCall = { pid: number; signal: NodeJS.Signals };

/** Records every kill call instead of touching a real process. */
function killSpy(onCall?: (pid: number) => void): {
  calls: KillCall[];
  kill: (pid: number, signal: NodeJS.Signals) => void;
} {
  const calls: KillCall[] = [];
  return {
    calls,
    kill: (pid, signal) => {
      onCall?.(pid);
      calls.push({ pid, signal });
    },
  };
}

console.log("isProjectSdkBinary");

check("matches this project's own SDK binary (default repoRoot = REPO_ROOT)", () => {
  assert.equal(isProjectSdkBinary(`${PROJECT_BINARY} --resume abc`), true);
});

check("matches a different platform suffix too — never hardcode a single platform", () => {
  const command = `${REPO_ROOT}/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude --resume abc`;
  assert.equal(isProjectSdkBinary(command, REPO_ROOT), true);
});

check("does not match another project's copy at a different repo root", () => {
  const command =
    "/Users/someone/other-bot/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude";
  assert.equal(isProjectSdkBinary(command, REPO_ROOT), false);
});

check("does not match a claude installed globally, outside any node_modules", () => {
  assert.equal(isProjectSdkBinary("/usr/local/bin/claude --resume abc", REPO_ROOT), false);
});

check(
  "does not match a bare `claude` — the real shape of the Operator's own interactive session",
  () => {
    // Verbatim shape observed live: `ps -Ao pid=,ppid=,command=` on a claude
    // CLI launched by typing `claude` at a shell shows the command column as
    // just the word "claude" — the shell passes argv[0] as typed, not the
    // resolved absolute path. This is the actual, most dangerous case the
    // safety property in the module doc has to hold against, not a
    // synthetic path that only looks plausible.
    assert.equal(isProjectSdkBinary("claude", REPO_ROOT), false);
  },
);

console.log("\nsweepOrphans");

check("a project binary with a dead parent (ppid 1) is killed and logged", () => {
  const processes: ProcessInfo[] = [{ pid: 111, ppid: 1, command: PROJECT_BINARY }];
  const spy = killSpy();
  const { warn } = captureConsole(() => {
    sweepOrphans({ list: () => processes, kill: spy.kill });
  });
  assert.deepEqual(spy.calls, [{ pid: 111, signal: "SIGKILL" }]);
  assert.equal(warn.length, 1);
  assert.ok(warn[0]!.includes("111"));
  assert.ok(warn[0]!.includes(PROJECT_BINARY));
});

check("a project binary whose parent is still alive is left alone", () => {
  const processes: ProcessInfo[] = [
    { pid: 900, ppid: 1, command: "/sbin/launchd" }, // the still-alive parent
    { pid: 222, ppid: 900, command: PROJECT_BINARY },
  ];
  const spy = killSpy();
  sweepOrphans({ list: () => processes, kill: spy.kill });
  assert.deepEqual(spy.calls, []);
});

check(
  "a different binary with a dead parent is left alone — e.g. the Operator's own global Claude Code",
  () => {
    const processes: ProcessInfo[] = [{ pid: 333, ppid: 1, command: "/usr/local/bin/claude" }];
    const spy = killSpy();
    sweepOrphans({ list: () => processes, kill: spy.kill });
    assert.deepEqual(spy.calls, []);
  },
);

check("the Operator's own session, even if it somehow had ppid 1, is never touched", () => {
  const processes: ProcessInfo[] = [{ pid: 444, ppid: 1, command: "claude" }];
  const spy = killSpy();
  sweepOrphans({ list: () => processes, kill: spy.kill });
  assert.deepEqual(spy.calls, []);
});

check("nothing qualifying means startup stays quiet — no kill, no log", () => {
  const processes: ProcessInfo[] = [
    { pid: 1, ppid: 0, command: "/sbin/launchd" },
    { pid: 50, ppid: 1, command: "/usr/sbin/some-daemon" },
  ];
  const spy = killSpy();
  const { warn, error } = captureConsole(() => {
    sweepOrphans({ list: () => processes, kill: spy.kill });
  });
  assert.deepEqual(spy.calls, []);
  assert.deepEqual(warn, []);
  assert.deepEqual(error, []);
});

check("closes the whole process tree, children before the root", () => {
  const processes: ProcessInfo[] = [
    { pid: 10, ppid: 1, command: PROJECT_BINARY }, // orphaned CLI (matches both criteria)
    { pid: 11, ppid: 10, command: "/bin/zsh" }, // its shell
    { pid: 12, ppid: 11, command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }, // Chrome, two hops down
    { pid: 13, ppid: 10, command: "node /path/to/mcp-server/cli.js" }, // an MCP server, direct child
  ];
  const spy = killSpy();
  captureConsole(() => {
    sweepOrphans({ list: () => processes, kill: spy.kill });
  });
  const killedPids = spy.calls.map((call) => call.pid);
  assert.deepEqual(new Set(killedPids), new Set([10, 11, 12, 13]));
  assert.ok(spy.calls.every((call) => call.signal === "SIGKILL"));
  // The root goes last: nothing only reachable through it (Chrome is two
  // hops down) is left behind un-killable once the CLI itself is gone.
  assert.equal(killedPids.at(-1), 10);
  assert.ok(killedPids.indexOf(11) < killedPids.indexOf(10));
  assert.ok(killedPids.indexOf(12) < killedPids.indexOf(10));
  assert.ok(killedPids.indexOf(13) < killedPids.indexOf(10));
});

check("a lister that throws is swallowed — this sweep must never fail bot startup", () => {
  const spy = killSpy();
  const { error } = captureConsole(() => {
    sweepOrphans({
      list: () => {
        throw new Error("ps not found");
      },
      kill: spy.kill,
    });
  });
  assert.deepEqual(spy.calls, []);
  assert.equal(error.length, 1);
});

check("a kill that throws does not stop the rest of the sweep", () => {
  const processes: ProcessInfo[] = [
    { pid: 20, ppid: 1, command: PROJECT_BINARY },
    { pid: 21, ppid: 20, command: `${PROJECT_BINARY}-helper` },
  ];
  const attempted: number[] = [];
  const spy = killSpy((pid) => {
    attempted.push(pid);
    if (pid === 21) throw new Error("EPERM");
  });
  captureConsole(() => {
    sweepOrphans({ list: () => processes, kill: spy.kill });
  });
  assert.deepEqual(new Set(attempted), new Set([20, 21]));
});

if (failures > 0) {
  console.error(`\n${failures} orphan-sweep test(s) failed`);
  process.exit(1);
}
console.log("\nall orphan-sweep tests passed");
