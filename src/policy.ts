/**
 * Decides which tool calls the bot auto-approves and which ones get an
 * Approve/Deny prompt in Discord.
 *
 * `canUseTool` only fires for calls Claude Code already decided to ask about
 * (file edits inside the workspace are auto-accepted by `acceptEdits` and never
 * reach here). This module narrows that set further: read-only Bash commands
 * are waved through, everything else goes to a human.
 */

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
const FLAG_GUARDS: Record<string, (args: string[]) => boolean> = {
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
 * task then holds the browser and later calls flow. A task that wants it while
 * another holds it is denied, not queued. Tools that reach past the browser
 * onto the host (file upload, arbitrary code) ask every time.
 */
export function decideBrowser(
  toolName: string,
  browser: { heldBy: string | undefined; requester: string },
): Decision {
  if (browser.heldBy !== undefined && browser.heldBy !== browser.requester) {
    return { action: "deny", reason: `browser is in use by task ${browser.heldBy}` };
  }
  if (BROWSER_ALWAYS_ASK.has(toolName)) {
    return {
      action: "ask",
      reason:
        toolName === BROWSER_UPLOAD_TOOL
          ? "uploads a file from this host to a web page"
          : "runs arbitrary code on this host, outside the browser",
    };
  }
  if (browser.heldBy === browser.requester) {
    return { action: "allow", reason: "browser already approved for this task" };
  }
  return { action: "ask", reason: "first browser use in this task" };
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

    // `cd /some/dir` on its own only moves the shell's cursor.
    if (tokens[0] === "cd") return true;

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
  });
}

export function decide(
  toolName: string,
  input: Record<string, unknown>,
  extraBashAllow: string[],
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
    return { action: "ask", reason: "shell command is not on the read-only allowlist" };
  }

  return { action: "ask", reason: `${toolName} can change the host` };
}
