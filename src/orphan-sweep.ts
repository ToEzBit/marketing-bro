/**
 * Reaps orphaned `claude` CLI subprocesses — and everything still running
 * under them: shell, MCP servers, Chrome — left behind after the bot's own
 * process is killed hard (SIGKILL, or the machine crashes) while an Agent
 * Session has a tool call in flight.
 *
 * Measured against SDK 0.3.220 (issue #6, verified live): a CLI that is
 * mid-tool-call when its parent dies survives past 115s, reparented to PID 1
 * — an idle CLI instead exits itself within ~5s, so the leak only happens
 * mid-tool-call. The SDK's own cleanup runs on `process.on("exit")`, which
 * never fires under SIGKILL, so nothing inside the process can fix this; it
 * has to be swept the next time the bot starts, before anything else touches
 * the Browser (ADR 0003): a leaked Chrome still holds the profile's
 * ProcessSingleton lock, so the next Task/Run to open a browser fails until
 * the old process is gone. Unlocking is a side effect of that process dying —
 * this module never touches the Chrome lock file directly.
 *
 * Targeting is deliberately narrow. A process is only ever touched when BOTH
 * hold:
 *   1. its command line names this project's own copy of the SDK's platform
 *      binary — under `<this repo>/node_modules/@anthropic-ai/claude-agent-sdk-*`
 *      (one such package per OS/arch: darwin-arm64, linux-x64, …; never
 *      hardcode a single platform). Matched as "appears in the command line"
 *      rather than "is the first token", because `ps` does not reliably show
 *      an absolute path there — a shell-launched `claude` shows up as the
 *      bare word `claude`, argv[0] as the caller passed it. The looser check
 *      still cannot match a *different* binary: the string it looks for is
 *      this repo's own absolute path, which no other install shares.
 *   2. its parent is dead — ppid is 1 (reparented to init). This is also
 *      exactly what keeps two overlapping bot instances safe: a second
 *      bot's own live CLI children have ppid == that bot's own pid, never 1,
 *      so a fresh startup can never reap a session that is still supervised.
 * Anything matching only one of the two — including a Claude Code the
 * Operator runs for themselves, always a different binary path (ADR 0003 /
 * CONTEXT.md) — is left alone. Once a root process qualifies, its whole live
 * subtree is closed, not just the root: the CLI's children are never
 * reparented themselves (they simply keep running under it for as long as it
 * stays alive), and none of them are themselves an SDK binary, so anything
 * left behind after the root dies could never be found by a later sweep.
 */
import { dirname, join, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * This project's own repo root, from this file's location — `dist/` mirrors
 * `src/` one level deep (tsconfig: rootDir "src", outDir "dist"), so this
 * resolves correctly whether running via `tsx src/…` or compiled `dist/…`.
 * Deliberately per-install: a git worktree's REPO_ROOT points at its own
 * `node_modules`, not the main checkout's — each copy only ever sweeps its
 * own orphans, by construction, not because anything filters them apart.
 */
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export type ProcessInfo = {
  pid: number;
  ppid: number;
  /** Full command line as `ps` reports it: the executable, then its args. */
  command: string;
};

export type ListProcesses = () => ProcessInfo[];
export type KillProcess = (pid: number, signal: NodeJS.Signals) => void;

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(.*)$/;

/** Real process snapshot via `ps`, parsed into `{ pid, ppid, command }`. */
function listHostProcesses(): ProcessInfo[] {
  // -A (POSIX, not BSD-only like -x) so this works on both supported Hosts
  // (macOS, Linux — CONTEXT.md). Verified identical listings to `-ax` on macOS.
  const output = execFileSync("ps", ["-Ao", "pid=,ppid=,command="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const processes: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    processes.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! });
  }
  return processes;
}

/** Real kill via the host process table. A pid that is already gone (ESRCH) is not an error. */
function killHostProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/**
 * True when `command` names this project's own copy of the SDK's platform
 * binary — somewhere under `repoRoot/node_modules/@anthropic-ai/claude-agent-sdk-*`.
 * Checked as a contained match rather than requiring it at position 0: `ps`'s
 * command column is not guaranteed to show an absolute path for argv[0] (a
 * shell-launched process keeps whatever the caller passed, e.g. the bare word
 * `claude`), so anchoring to "starts with" risks never matching the real
 * target. The safety property this function exists for — never matching a
 * *different* claude — does not depend on the anchor: the string being
 * searched for is this repo's own absolute path, which nothing else on the
 * Host shares.
 */
export function isProjectSdkBinary(command: string, repoRoot: string = REPO_ROOT): boolean {
  const scope = join(repoRoot, "node_modules", "@anthropic-ai") + sep;
  const at = command.indexOf(scope);
  if (at === -1) return false;
  return /^claude-agent-sdk-[^/\s]+\//.test(command.slice(at + scope.length));
}

/**
 * Every live process in `pid`'s subtree, `pid` itself first (BFS / level
 * order — a valid topological pre-order: a process always appears before any
 * of its descendants). `seen` guards against looping forever on a
 * malformed/cyclical process table, which real `ps` output never produces
 * but an injected fake in a test could.
 */
function subtreeOf(pid: number, processes: ProcessInfo[]): ProcessInfo[] {
  const byParent = new Map<number, ProcessInfo[]>();
  for (const proc of processes) {
    const siblings = byParent.get(proc.ppid);
    if (siblings) siblings.push(proc);
    else byParent.set(proc.ppid, [proc]);
  }
  const root = processes.find((proc) => proc.pid === pid);
  if (!root) return [];

  const seen = new Set<number>([root.pid]);
  const result: ProcessInfo[] = [];
  const queue: ProcessInfo[] = [root];
  while (queue.length > 0) {
    const proc = queue.shift()!;
    result.push(proc);
    for (const child of byParent.get(proc.pid) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      queue.push(child);
    }
  }
  return result;
}

/**
 * Closes every orphaned copy of this project's own `claude` CLI (ppid 1) and
 * its whole process tree — children before the process itself (reversing a
 * pre-order walk keeps that guarantee without needing a strict post-order),
 * so nothing is left behind still holding the Browser Profile lock or a
 * Discord connection once this returns. SIGKILL only, no SIGTERM grace
 * period: these are unsupervised orphans, so there is nothing to give a
 * graceful shutdown to, and Chrome's own "crashed exit" recovery is already
 * handled on next launch by `browser.ts`'s `forgetOpenTabs` — that is also
 * why the Browser Profile's `SingletonLock` is never touched here directly
 * (ADR 0003): losing it is a side effect of the process dying, on any signal.
 *
 * `list`/`kill` default to the real host and exist so tests can drive this
 * with a fake process table and never touch a real process. Both the listing
 * and each individual kill are best-effort: a failure here must never stop
 * the bot from starting, so errors are logged and swallowed rather than
 * thrown.
 */
export function sweepOrphans(overrides: { list?: ListProcesses; kill?: KillProcess } = {}): void {
  const list = overrides.list ?? listHostProcesses;
  const kill = overrides.kill ?? killHostProcess;

  let processes: ProcessInfo[];
  try {
    processes = list();
  } catch (error) {
    console.error("[orphan-sweep] could not list host processes, skipping:", error);
    return;
  }

  const roots = processes.filter((proc) => proc.ppid === 1 && isProjectSdkBinary(proc.command));

  for (const root of roots) {
    const tree = subtreeOf(root.pid, processes).reverse();
    for (const proc of tree) {
      console.warn(`[orphan-sweep] reaping orphaned pid ${proc.pid}: ${proc.command}`);
      try {
        kill(proc.pid, "SIGKILL");
      } catch (error) {
        console.error(`[orphan-sweep] failed to kill pid ${proc.pid}:`, error);
      }
    }
  }
}
