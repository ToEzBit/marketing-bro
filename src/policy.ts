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
  diff: true,
  basename: true,
  dirname: true,
  realpath: true,
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
    "shortlog",
    "tag",
    "config",
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
};

/**
 * `git` subcommands whose plain form lists but which mutate once given operands
 * or write flags. Guards see the tokens after the subcommand.
 */
const GIT_SUBCOMMAND_GUARDS: Record<string, (args: string[]) => boolean> = {
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
  // `git remote` / `-v` lists; `git remote add|remove|set-url` mutates.
  remote: (args) => {
    const operands = args.filter((arg) => !arg.startsWith("-"));
    const first = operands[0];
    return (
      (first === undefined || first === "show" || first === "get-url") &&
      onlyKnownFlags(args, ["-v", "--verbose"])
    );
  },
};

export type Decision =
  | { action: "allow"; reason: string }
  | { action: "ask"; reason: string };

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
  if (UNINSPECTABLE_SHELL_SYNTAX.test(command)) return false;

  const segments = command.split(CHAIN_OPERATORS);
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

    if (command === "git") {
      const guard = GIT_SUBCOMMAND_GUARDS[subcommand];
      return guard ? guard(tokens.slice(2)) : true;
    }
    return true;
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
