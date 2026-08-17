/**
 * Decides which tool calls the bot auto-approves and which ones get an
 * Approve/Deny prompt in Discord.
 *
 * `canUseTool` only fires for calls Claude Code already decided to ask about
 * (file edits inside the workspace are auto-accepted by `acceptEdits` and never
 * reach here). This module narrows that set further: read-only Bash commands
 * are waved through, everything else goes to a human.
 */

import { isAbsolute, relative, resolve } from "node:path";
import { SEND_FILE_TOOL } from "./attachment-tool.js";

/** Tools that only read or search, and never mutate the host. */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "NotebookRead",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  // Reads the output of an already-running shell; starting one is Bash's job.
  "BashOutput",
  // Spawns a subagent. Harmless by itself — the subagent's own tool calls come
  // back through this policy individually (canUseTool reports their agentID).
  "Task",
  // Loads a skill's instructions into context (ADR 0005). Same shape as Task:
  // anything the skill then does arrives here as its own tool call.
  "Skill",
]);

/**
 * Bash commands considered read-only. A key is matched against the leading
 * tokens of a command segment; `git` maps to the subcommands allowed after it.
 */
const BASH_ALLOWLIST: Record<string, true | string[]> = {
  ls: true,
  pwd: true,
  cat: true,
  head: true,
  tail: true,
  wc: true,
  echo: true,
  which: true,
  whoami: true,
  hostname: true,
  date: true,
  uptime: true,
  env: true,
  printenv: true,
  uname: true,
  sw_vers: true,
  arch: true,
  id: true,
  groups: true,
  ps: true,
  lsof: true,
  find: true,
  tree: true,
  grep: true,
  rg: true,
  fd: true,
  file: true,
  stat: true,
  du: true,
  df: true,
  sed: true, // print-range form only — see FLAG_GUARDS
  sort: true,
  uniq: true,
  cut: true,
  nl: true,
  tr: true,
  rev: true,
  column: true,
  comm: true,
  paste: true,
  diff: true,
  basename: true,
  dirname: true,
  realpath: true,
  readlink: true,
  shasum: true,
  md5: true,
  md5sum: true,
  sha1sum: true,
  sha256sum: true,
  cksum: true,
  jq: true,
  git: [
    "status",
    "diff",
    "log",
    "show",
    "branch",
    "remote",
    "blame",
    "describe",
    "rev-parse",
    "ls-files",
    "ls-remote",
    "shortlog",
    "tag",
    "config",
    "reflog",
    "stash",
    "worktree",
    "for-each-ref",
    "merge-base",
    "cat-file",
    "diff-tree",
    "grep",
    "check-ignore",
    "count-objects",
    "name-rev",
    "whatchanged",
  ],
  npm: ["test", "ls", "list", "outdated", "view", "why"],
  pnpm: ["test", "list", "why"],
  yarn: ["test", "why"],
  node: ["--version", "-v"],
  python: ["--version", "-V"],
  python3: ["--version", "-V"],
  tsc: ["--noEmit", "--version"],
  pytest: true,
  jest: true,
  vitest: true,
  bun: ["test", "--version", "-v"],
  deno: ["test", "check", "lint", "--version", "-V"],
  go: ["test", "vet", "version"],
  cargo: ["test", "check", "clippy", "--version"],
  docker: ["ps", "images", "version"],
  kubectl: ["get", "describe", "version"],
};

/**
 * Shell syntax that can write files or run a command we never inspected —
 * redirection, command substitution, and process substitution.
 */
const UNINSPECTABLE_SHELL_SYNTAX = /[<>`]|\$\(|\$\{/;

/**
 * Redirections that discard output rather than store it: `>/dev/null`,
 * `2>/dev/null`, `&>/dev/null`. Stripped before the syntax check because
 * silencing stderr is how ordinary read-only commands are written, and
 * /dev/null cannot hold what is written to it.
 *
 * `(?!\S)` pins the target to exactly /dev/null — `>/dev/null/../../etc/x`
 * keeps its `>` and still goes to a human.
 */
const DEV_NULL_REDIRECT = /(?:\d+|&)?>>?\s*\/dev\/null(?!\S)/g;

/**
 * File-descriptor duplication (`2>&1`, `1>&2`). Points one stream at another
 * that is already open; never names a file. The trailing digit requirement is
 * what makes that true — bash reads `>&name` as a file redirect, and that form
 * is left alone.
 */
const FD_DUPLICATION = /\d*>&\d+(?!\S)/g;

/** Splits on operators that chain independent commands. */
const CHAIN_OPERATORS = /&&|\|\||[|;&\n]/;

/**
 * Commands on the allowlist that can still mutate through a flag — `find -exec`,
 * `sort -o`, `git branch -D`. Each guard receives the tokens after the command
 * (and after the subcommand, for `git`) and must confirm they are read-only.
 */
/** The only sed script shape we accept: a numeric print range like '1,12p'. */
const SED_PRINT_RANGE = /^["']?\d+(,\d+)?p["']?$/;

const FLAG_GUARDS: Record<string, (args: string[]) => boolean> = {
  /**
   * sed is allowed ONLY as `sed -n 'N[,M]p' [file…]` — the print-a-range
   * idiom agents reach for constantly. Every other form asks: sed scripts
   * can write files via the `w` command and `-i` edits in place. Position
   * matters: sed treats the FIRST non-option word as the script, so the
   * guard checks that word specifically — a hostile script cannot hide in
   * front while a file literally named "1,12p" satisfies a loose scan.
   */
  sed: (args) => {
    if (!args.includes("-n")) return false;
    const operands = args.filter((arg) => arg !== "-n");
    if (operands.some((arg) => arg.startsWith("-"))) return false;
    const [script, ...files] = operands;
    if (script === undefined || !SED_PRINT_RANGE.test(script)) return false;
    return files.every(isPlainWord);
  },
  /**
   * find writes only through its action predicates, and they are a closed set
   * that is always written as its own word — so naming them is exact, whereas
   * allowlisting find's very wide read surface would reject ordinary searches.
   */
  find: (args) =>
    !args.some((arg) =>
      ["-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(
        arg,
      ),
    ),
  /**
   * sort writes only via -o/--output. The pattern also catches it bundled into a
   * short-flag cluster (`-uo out`); no other sort short flag uses the letter o.
   */
  sort: (args) => !args.some((arg) => /^-[^-]*o/.test(arg) || arg.startsWith("--output")),
  /**
   * `env` prints the environment only in its bare form. With any argument it is
   * an exec wrapper — `env rm -rf x` runs a command this allowlist never saw.
   * Reading a single variable is `printenv NAME`, which cannot exec.
   */
  env: (args) => args.length === 0,
  /**
   * tree writes its listing to a file with -o; every other flag prints. Same
   * short-flag-cluster pattern as sort — no other tree short flag uses `o`.
   */
  tree: (args) => !args.some((arg) => /^-[^-]*o/.test(arg) || arg.startsWith("--output")),
};

/**
 * Every subcommand that accepts git's diff options also accepts
 * `--output=<file>`, which writes the diff instead of printing it. The exact
 * match keeps the unrelated `--output-indicator-*` display flags usable.
 */
function noDiffOutputFile(args: string[]): boolean {
  return !args.some((arg) => /^--output(=|$)/.test(arg));
}

/** Linters that read by default and rewrite source once given `--fix`. */
function noFixFlag(args: string[]): boolean {
  return !args.some((arg) => /^--fix(=|$)/.test(arg));
}

/**
 * Subcommands whose plain form reads but which mutate once given operands or
 * write flags, keyed by command then subcommand. Guards see the tokens after
 * the subcommand.
 */
const SUBCOMMAND_GUARDS: Record<string, Record<string, (args: string[]) => boolean>> = {
  deno: { lint: noFixFlag },
  cargo: { clippy: noFixFlag },
  git: {
    diff: noDiffOutputFile,
    log: noDiffOutputFile,
    show: noDiffOutputFile,
    "diff-tree": noDiffOutputFile,
    whatchanged: noDiffOutputFile,
    /**
     * `git grep -O<cmd>` opens each match in a pager of the caller's choosing —
     * that is arbitrary execution. `-O` is git grep's only uppercase-O flag, so
     * the short-flag-cluster pattern is exact.
     */
    grep: (args) =>
      !args.some((arg) => /^-[^-]*O/.test(arg) || arg.startsWith("--open-files-in-pager")),
    // `git config --get x` reads; `git config x y` writes.
    config: (args) =>
      args.some((arg) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(arg)),
    // `git branch` lists; `git branch foo` and `git branch -D foo` mutate.
    branch: (args) =>
      hasNoOperands(args) &&
      onlyKnownFlags(args, [
        "-a", "-r", "-v", "-vv", "--all", "--remotes", "--verbose", "--list",
        "--show-current", "--contains", "--no-contains", "--merged", "--no-merged",
        "--sort", "--format", "--points-at", "-i", "--ignore-case",
      ]),
    // `git tag` lists; `git tag v1` creates, `git tag -d v1` deletes.
    tag: (args) =>
      hasNoOperands(args) &&
      onlyKnownFlags(args, [
        "-l", "--list", "-n", "--contains", "--no-contains", "--merged", "--no-merged",
        "--sort", "--format", "--points-at", "-i", "--ignore-case",
      ]),
    // `git stash` (bare) and `pop`/`drop`/`apply` move work around; only these read.
    stash: (args) => args[0] === "list" || args[0] === "show",
    // `git worktree list` reads; `add`/`remove`/`prune` touch the filesystem.
    worktree: (args) => args[0] === "list",
    /**
     * `git reflog expire|delete` destroys the recovery log — the last way back
     * to a lost commit. reflog's subcommands are a closed set, so naming the two
     * destructive ones is exact; an allowlist of operands would reject ordinary
     * flag values like the `5` in `git reflog -n 5`.
     */
    reflog: (args) => !args.some((arg) => arg === "expire" || arg === "delete"),
    // `git remote` / `-v` lists; `git remote add|remove|set-url` mutates.
    remote: (args) => {
      const operands = args.filter((arg) => !arg.startsWith("-"));
      const first = operands[0];
      return (
        (first === undefined || first === "show" || first === "get-url") &&
        onlyKnownFlags(args, ["-v", "--verbose"])
      );
    },
  },
};

/**
 * ADR 0010 — commands that destroy work with no way back. In YOLO_MODE these
 * are the only Bash commands that still reach a human; with the flag off they
 * are irrelevant here (everything outside the read-only allowlist already asks)
 * and matter only to `decideScheduled`, which denies them outright.
 *
 * This is an ACCIDENT GUARD, not a security boundary: it reads the command as
 * written. A delete hidden inside `$(…)`, `python -c`, or a shell script the
 * agent wrote a moment ago goes straight through — see ADR 0010 Consequences.
 */
const DESTRUCTIVE_COMMANDS = new Set(["rm", "rmdir", "unlink", "shred", "srm", "truncate"]);

/**
 * Wrappers that run another command. The real command is the first bare word
 * after them, so the scan steps past the wrapper and its flags/assignments —
 * `find . | xargs rm` and `sudo rm -rf x` are the accidents worth catching.
 */
const COMMAND_WRAPPERS = new Set([
  "sudo", "doas", "xargs", "env", "time", "nohup", "nice", "command", "do", "then", "else",
]);

/** Commands that destroy only under specific flags. Args exclude the command. */
const DESTRUCTIVE_FLAGS: Record<string, (args: string[]) => boolean> = {
  /** `dd of=file` overwrites that file; without `of=` it writes to stdout. */
  dd: (args) => args.some((arg) => arg.startsWith("of=")),
  /** Every `--delete*` variant removes files from the destination. */
  rsync: (args) => args.some((arg) => arg.startsWith("--delete")),
  /**
   * `-delete` removes matches. The exec predicates run a command this scan
   * never sees, so they ask too — `find … -exec rm {} +` is exactly the shape
   * an accident takes, and plain searches don't use them.
   */
  find: (args) =>
    args.some((arg) =>
      ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(arg),
    ),
};

/** git subcommands that throw away work. Args exclude `git <subcommand>`. */
const DESTRUCTIVE_GIT: Record<string, (args: string[]) => boolean> = {
  /** Deletes untracked files. `-n`/`--dry-run` only lists them. */
  clean: (args) => !args.some((arg) => arg === "-n" || arg === "--dry-run"),
  /** `git rm` deletes; that is the whole subcommand. */
  rm: () => true,
  /** Only `--hard` discards the working tree; soft/mixed keep the files. */
  reset: (args) => args.includes("--hard"),
  /**
   * `git restore` overwrites the working tree from another source. The one
   * form that does not touch files is `--staged` alone (it just unstages).
   */
  restore: (args) => !(args.includes("--staged") && !args.includes("--worktree")),
  /**
   * `git checkout <path>` overwrites local edits, while `git checkout <branch>`
   * refuses to clobber them. git itself can only tell the two apart by looking
   * at the repo, so this asks on the shapes that name a path — `--`, `.`, a
   * slash, or forced. A branch whose name contains `/` asks needlessly; that is
   * the safe direction to be wrong in.
   */
  checkout: (args) =>
    args.some(
      (arg) => arg === "--" || arg === "." || arg === "-f" || arg === "--force" ||
        (!arg.startsWith("-") && arg.includes("/")),
    ),
  /** `drop`/`clear` throw stashed work away; `list`/`show`/`pop` do not. */
  stash: (args) => args[0] === "drop" || args[0] === "clear",
};

/** Strips wrappers, flags and `VAR=value` prefixes to find the real command. */
function realCommand(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (COMMAND_WRAPPERS.has(token) || token.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    return tokens.slice(index);
  }
  return [];
}

/**
 * True when any segment of the command destroys files or uncommitted work.
 * Checks every chained segment, so `npm test && rm -rf dist` still asks.
 */
export function isDestructiveBash(command: string): boolean {
  return command.split(CHAIN_OPERATORS).some((segment) => {
    const tokens = realCommand(tokenize(segment));
    const name = tokens[0];
    if (name === undefined) return false;
    if (DESTRUCTIVE_COMMANDS.has(name)) return true;

    if (name === "git") {
      const subcommand = tokens[1];
      if (subcommand === undefined) return false;
      const guard = DESTRUCTIVE_GIT[subcommand];
      return guard ? guard(tokens.slice(2)) : false;
    }

    const guard = DESTRUCTIVE_FLAGS[name];
    return guard ? guard(tokens.slice(1)) : false;
  });
}

export type Decision =
  | { action: "allow"; reason: string }
  | { action: "ask"; reason: string }
  | { action: "deny"; reason: string };

/**
 * The Playwright MCP server is registered under this key, so every browser
 * tool arrives here named `mcp__browser__browser_*`.
 */
export const BROWSER_MCP_NAME = "browser";
const BROWSER_TOOL_PREFIX = `mcp__${BROWSER_MCP_NAME}__`;

/** Moves a file off this host into a web page. */
export const BROWSER_UPLOAD_TOOL = `${BROWSER_TOOL_PREFIX}browser_file_upload`;

/**
 * Runs arbitrary JavaScript in the MCP server's Node process — host-level
 * code execution, not a browser action. One browser approval must not open
 * a path around the Bash allowlist.
 */
export const BROWSER_UNSAFE_CODE_TOOL = `${BROWSER_TOOL_PREFIX}browser_run_code_unsafe`;

/** Browser tools that escape the browser's scope and touch the host itself. */
const BROWSER_ALWAYS_ASK = new Set([BROWSER_UPLOAD_TOOL, BROWSER_UNSAFE_CODE_TOOL]);

export function isBrowserTool(toolName: string): boolean {
  return toolName.startsWith(BROWSER_TOOL_PREFIX);
}

/**
 * ADR 0003: the browser is a single shared resource whose profile carries the
 * operator's logins. The first browser call in a task asks a human once; the
 * approval then covers the rest of the task (`approved`). Contention is not
 * decided here: a task whose call is allowed still stands in the Browser
 * queue (ADR 0006) until the current holder lets go. Tools that reach past
 * the browser onto the host (file upload, arbitrary code) ask every time.
 */
export function decideBrowser(
  toolName: string,
  browser: { approved: boolean; yolo?: boolean },
): Decision {
  if (BROWSER_ALWAYS_ASK.has(toolName)) {
    // ADR 0010: YOLO_MODE waves through everything that cannot delete, so
    // uploading a file passes. `run_code_unsafe` still asks — it runs code
    // this policy never sees, which is the plainest delete path there is.
    if (browser.yolo && toolName === BROWSER_UPLOAD_TOOL) {
      return { action: "allow", reason: "YOLO_MODE: อัปโหลดไม่ได้ลบอะไรบนเครื่อง" };
    }
    return {
      action: "ask",
      reason:
        toolName === BROWSER_UPLOAD_TOOL
          ? "uploads a file from this host to a web page"
          : "runs arbitrary code on this host, outside the browser",
    };
  }
  if (browser.approved) {
    return { action: "allow", reason: "browser already approved for this task" };
  }
  return { action: "ask", reason: "first browser use in this task" };
}

/**
 * File tools whose write target the bot can see, mapped to the input field
 * naming it. These are the only writes the workspace boundary can be enforced
 * on (ADR 0004 records that Bash is out of its reach).
 */
const FILE_WRITE_PATH_FIELD: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  NotebookEdit: "notebook_path",
};

function isInsideWorkspace(path: string, workspace: string): boolean {
  const absolute = isAbsolute(path) ? path : resolve(workspace, path);
  const rel = relative(resolve(workspace), resolve(absolute));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * ADR 0004: a scheduled Run has no human to ask, so every decision resolves to
 * allow or deny on the spot. The creation-time grant covers reads, Bash, and
 * writes inside the Workspace; writes outside it and tools this policy does
 * not recognise are denied outright.
 */
export function decideScheduled(
  toolName: string,
  input: Record<string, unknown>,
  workspace: string,
): Decision {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return { action: "allow", reason: `${toolName} only reads` };
  }
  if (toolName === SEND_FILE_TOOL) {
    return { action: "allow", reason: "posts a file into the schedule thread" };
  }
  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    // ADR 0010: deleting is the one act that always needs a human, and a
    // scheduled Run has none to ask (ADR 0004) — so it can only be denied.
    if (isDestructiveBash(command)) {
      return {
        action: "deny",
        reason: "scheduled run ลบไฟล์หรือล้างงานที่ยังไม่ commit ไม่ได้ — ทำต่อด้วยวิธีอื่นหรือรายงานแทน",
      };
    }
    return { action: "allow", reason: "scheduled grant covers Bash" };
  }

  const pathField = FILE_WRITE_PATH_FIELD[toolName];
  if (pathField) {
    const path = typeof input[pathField] === "string" ? (input[pathField] as string) : "";
    if (path && isInsideWorkspace(path, workspace)) {
      return { action: "allow", reason: "writes inside the workspace" };
    }
    return {
      action: "deny",
      reason: "scheduled run เขียนไฟล์ได้เฉพาะใน workspace ของมันเท่านั้น",
    };
  }

  return {
    action: "deny",
    reason: `${toolName} ไม่ได้รับอนุญาตใน scheduled run — ทำต่อด้วยวิธีอื่นหรือรายงานแทน`,
  };
}

/**
 * ADR 0004: browser access in a scheduled Run comes from the creation-time
 * grant, not an approval prompt. Upload is part of the grant (posting needs
 * it); `browser_run_code_unsafe` stays shut because it is host-level code
 * execution, which no grant covers. Contention is not decided here — an
 * allowed call stands in the Browser queue (ADR 0006), waiting at most until
 * the schedule's own next round.
 */
export function decideScheduledBrowser(
  toolName: string,
  context: { granted: boolean },
): Decision {
  if (!context.granted) {
    return {
      action: "deny",
      reason: "schedule นี้ไม่ได้รับสิทธิ์ browser ตอนสร้าง — ทำงานต่อโดยไม่ใช้ browser หรือรายงานแทน",
    };
  }
  if (toolName === BROWSER_UNSAFE_CODE_TOOL) {
    return {
      action: "deny",
      reason: "รันโค้ดระดับ host ผ่าน browser ไม่ได้ใน scheduled run",
    };
  }
  return { action: "allow", reason: "browser granted at schedule creation" };
}

function tokenize(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean);
}

/** True when every flag-looking token is in `known`. Unknown flags mean "ask". */
function onlyKnownFlags(args: string[], known: string[]): boolean {
  return args
    .filter((arg) => arg.startsWith("-"))
    .every((arg) => known.includes(arg.split("=")[0]!));
}

/** True when no bare operand follows — the listing form of `git branch`/`tag`. */
function hasNoOperands(args: string[]): boolean {
  return !args.some((arg) => !arg.startsWith("-"));
}

/** True when every chained segment of the command is on the allowlist. */
function isReadOnlyBash(command: string, extraAllow: string[]): boolean {
  const stripped = command
    .replace(DEV_NULL_REDIRECT, " ")
    .replace(FD_DUPLICATION, " ");
  if (UNINSPECTABLE_SHELL_SYNTAX.test(stripped)) return false;

  const segments = stripped.split(CHAIN_OPERATORS);
  if (segments.length === 0) return false;

  return segments.every((segment) => {
    const tokens = tokenize(segment);
    if (tokens.length === 0) return false;
    return segmentAllowed(tokens, extraAllow);
  });
}

/** A word that cannot expand into a flag or assignment inside a later command. */
function isPlainWord(token: string): boolean {
  return !token.startsWith("-") && !token.includes("=");
}

const FOR_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function segmentAllowed(tokens: string[], extraAllow: string[]): boolean {
  // `cd /some/dir` on its own only moves the shell's cursor.
  if (tokens[0] === "cd") return true;

  // `for f in <plain words>` runs nothing by itself — it only sets up
  // iteration. The body arrives as its own `do …` segment (the chain split
  // cuts on `;`) and is checked like any command. The words may not look
  // like flags or assignments, so a loop variable can never smuggle an
  // option (e.g. f="-o") past a FLAG_GUARD in the body. `while`/`until`
  // still ask: their condition IS a command and they can loop forever.
  if (tokens[0] === "for") {
    return (
      tokens.length >= 4 &&
      FOR_VARIABLE.test(tokens[1] ?? "") &&
      tokens[2] === "in" &&
      tokens.slice(3).every(isPlainWord)
    );
  }

  // `do <command>` — unwrap and check the command itself.
  if (tokens[0] === "do") {
    return tokens.length > 1 && segmentAllowed(tokens.slice(1), extraAllow);
  }

  // Bare `done` closes a loop and runs nothing.
  if (tokens[0] === "done" && tokens.length === 1) return true;

  const joined = tokens.join(" ");
  if (extraAllow.some((prefix) => joined === prefix || joined.startsWith(`${prefix} `))) {
    return true;
  }

  const command = tokens[0]!;
  const allowed = BASH_ALLOWLIST[command];
  if (allowed === undefined) return false;

  if (allowed === true) {
    const guard = FLAG_GUARDS[command];
    return guard ? guard(tokens.slice(1)) : true;
  }

  const subcommand = tokens[1];
  if (subcommand === undefined) return false;
  if (!allowed.includes(subcommand)) return false;

  const guard = SUBCOMMAND_GUARDS[command]?.[subcommand];
  return guard ? guard(tokens.slice(2)) : true;
}

/**
 * ADR 0010: with `yolo` on, the question flips from "is this safe?" to "does
 * this destroy something?" — everything runs unasked except the commands in
 * `isDestructiveBash`. Read the Consequences of ADR 0010 before relying on it.
 */
export function decide(
  toolName: string,
  input: Record<string, unknown>,
  extraBashAllow: string[],
  yolo = false,
): Decision {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return { action: "allow", reason: `${toolName} only reads` };
  }

  // Posting a file into the thread the user is already in reveals nothing the
  // auto-approved Read tool could not already print as text.
  if (toolName === SEND_FILE_TOOL) {
    return { action: "allow", reason: "posts a file into this thread" };
  }

  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (command && isReadOnlyBash(command, extraBashAllow)) {
      return { action: "allow", reason: "read-only shell command" };
    }
    if (yolo) {
      return isDestructiveBash(command)
        ? { action: "ask", reason: "ลบไฟล์หรือล้างงานที่ยังไม่ commit — ด่านเดียวที่ YOLO_MODE ไม่ข้ามให้" }
        : { action: "allow", reason: "YOLO_MODE: ไม่ใช่คำสั่งลบ" };
    }
    return { action: "ask", reason: "shell command is not on the read-only allowlist" };
  }

  // Write/Edit outside the workspace, and any tool this policy does not know.
  // Neither can delete a file, so YOLO_MODE lets them through.
  if (yolo) {
    return { action: "allow", reason: "YOLO_MODE: ไม่ใช่คำสั่งลบ" };
  }
  return { action: "ask", reason: `${toolName} can change the host` };
}
