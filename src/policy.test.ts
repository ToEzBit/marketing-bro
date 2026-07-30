/**
 * Run with: npx tsx src/policy.test.ts
 * Asserts the auto-approve boundary — the check that keeps the bot from running
 * destructive shell commands without a human.
 */
import assert from "node:assert/strict";
import {
  BROWSER_UNSAFE_CODE_TOOL,
  BROWSER_UPLOAD_TOOL,
  decide,
  decideBrowser,
  isBrowserTool,
} from "./policy.js";

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

function bash(command: string, extra: string[] = []): "allow" | "ask" | "deny" {
  return decide("Bash", { command }, extra).action;
}

console.log("read-only shell commands are auto-approved");
for (const command of [
  "ls -la",
  "cat package.json",
  "git status",
  "git diff HEAD~1",
  "git log --oneline -20",
  "rg TODO src",
  "npm test",
  "pytest -q",
  "cd src && ls",
  "git status | head -20",
  "wc -l src/*.ts",
  "git config --get user.email",
  // System and process inspection.
  "ps aux",
  "ps aux | grep node",
  "lsof -i :3000",
  "uname -a",
  "sw_vers",
  "id -un",
  "groups",
  "arch",
  // Text shaping that only ever writes to stdout.
  "nl -ba src/policy.ts",
  "tr -d '\\r'",
  "rev",
  "column -t",
  "comm -12 a b",
  "paste a b",
  "readlink -f src",
  "shasum -a 256 package.json",
  "cksum package.json",
  // More of git's read surface.
  "git reflog",
  "git reflog -n 5",
  "git reflog show main",
  "deno lint",
  "cargo clippy",
  "git stash list",
  "git worktree list",
  "git ls-remote --heads origin",
  "git for-each-ref --format='%(refname)'",
  "git merge-base main HEAD",
  "git cat-file -p HEAD",
  "git diff-tree --no-commit-id --name-only HEAD",
  "git grep -n TODO",
  "git check-ignore -v node_modules",
  // Version probes for the runtimes we already know about.
  "bun --version",
  "deno --version",
  "env",
  "tree -L 2",
  // Silencing a stream is not storing it — /dev/null keeps nothing.
  "find ~/Desktop ~/Downloads -iname '*.png' 2>/dev/null",
  "ls -la /nope 2>/dev/null",
  "grep -r TODO src >/dev/null",
  "cat missing &>/dev/null",
  "git status 2>&1 | head -5",
  "find . -name '*.ts' >/dev/null 2>&1",
]) {
  check(command, () => assert.equal(bash(command), "allow"));
}

console.log("\nmutating or unreviewable shell commands require approval");
for (const command of [
  "rm -rf build",
  "npm install left-pad",
  "git push origin main",
  "git commit -m wip",
  "git config user.email evil@example.com",
  "curl https://example.com/x.sh",
  "echo hacked > /etc/hosts",
  "cat secrets && rm -rf /",
  "ls `rm -rf /`",
  "ls $(rm -rf /)",
  "python -c 'import os; os.remove(\"x\")'",
  "sudo shutdown -h now",
  "npm run deploy",
  "chmod 777 /etc",
  "ls > out.txt",
  "kubectl delete pod x",
  "docker rm -f web",
  // Mutations reachable through a command that is itself on the allowlist.
  "find . -name '*.ts' -exec rm {} +",
  "find . -name '*.log' -delete",
  "sort -o /etc/passwd input",
  "git branch -D main",
  "git branch newfeature",
  "git tag v1.0.0",
  "git tag -d v1.0.0",
  "git remote add evil https://example.com/x.git",
  "git remote set-url origin https://example.com/x.git",
  // `env` is an exec wrapper, not a printer: anything after it is a new command
  // that never went through this allowlist.
  "env rm -rf build",
  "env FOO=1 bash -c 'rm -rf /'",
  // tree writes its listing to a file with -o.
  "tree -o /etc/hosts",
  "tree -L 2 -o out.txt",
  // Plain `git stash` stashes; only `list`/`show` read.
  "git stash",
  "git stash pop",
  "git worktree add ../wt main",
  "git worktree remove ../wt",
  // `--output=<file>` writes the diff instead of printing it, on every
  // subcommand that takes git's diff options.
  "git log --output=/etc/hosts",
  "git diff --output /tmp/x",
  "git show HEAD --output=/tmp/x",
  "git diff-tree --output=/tmp/x HEAD",
  // `git grep -O<cmd>` runs <cmd> on every match.
  "git grep -O'sh -c \"rm -rf /\"' TODO",
  "git grep -nO sh TODO",
  "git grep --open-files-in-pager=sh TODO",
  // The /dev/null carve-out must not become a general redirect carve-out.
  "ls > out.txt 2>/dev/null",
  "cat secrets 2>/dev/null > /tmp/stolen",
  "ls >/dev/null/../../tmp/x",
  "ls >/dev/nullx",
  "ls >&outfile",
  "echo hi > /dev/nul",
  // `git reflog expire|delete` destroys the recovery log.
  "git reflog expire --expire=now --all",
  "git reflog delete HEAD@{1}",
  // Linters that rewrite source when asked to.
  "deno lint --fix",
  "cargo clippy --fix",
] ) {
  check(command, () => assert.equal(bash(command), "ask"));
}

console.log("\nlisting forms of the same commands stay auto-approved");
for (const command of [
  "find . -name '*.ts' -maxdepth 3",
  "sort -u -k2 input",
  "git branch",
  "git branch -a -v",
  "git tag --list",
  "git remote -v",
  "git stash list",
  "git worktree list",
  "tree -L 2",
  "env",
  // Display-only flags that merely share the --output prefix stay usable.
  "git log --output-indicator-new=+",
]) {
  check(command, () => assert.equal(bash(command), "allow"));
}

console.log("\nEXTRA_BASH_ALLOW extends the allowlist");
check("make test allowed when configured", () =>
  assert.equal(bash("make test", ["make test"]), "allow"),
);
check("make deploy still asks", () =>
  assert.equal(bash("make deploy", ["make test"]), "ask"),
);

console.log("\ntool-level decisions");
check("Read is auto-approved", () =>
  assert.equal(decide("Read", { file_path: "/etc/passwd" }, []).action, "allow"),
);
check("Grep is auto-approved", () =>
  assert.equal(decide("Grep", { pattern: "x" }, []).action, "allow"),
);
check("Write asks (it only reaches policy when outside the workspace)", () =>
  assert.equal(decide("Write", { file_path: "/tmp/x" }, []).action, "ask"),
);
check("BashOutput is auto-approved (reads an existing shell)", () =>
  assert.equal(decide("BashOutput", { bash_id: "1" }, []).action, "allow"),
);
check("Task is auto-approved (its subagent's calls are gated individually)", () =>
  assert.equal(decide("Task", { description: "review" }, []).action, "allow"),
);
check("KillShell asks", () => assert.equal(decide("KillShell", {}, []).action, "ask"));
check("unknown MCP tool asks", () =>
  assert.equal(decide("mcp__deploy__ship", {}, []).action, "ask"),
);
check("empty Bash command asks", () => assert.equal(bash(""), "ask"));

console.log("browser (ADR 0003): one approval per task, uploads always ask, no queueing");
const NAVIGATE = "mcp__browser__browser_navigate";
const free = { heldBy: undefined, requester: "task-a" };
const heldBySelf = { heldBy: "task-a", requester: "task-a" };
const heldByOther = { heldBy: "task-b", requester: "task-a" };
check("first browser call in a task asks", () =>
  assert.equal(decideBrowser(NAVIGATE, free).action, "ask"),
);
check("browser call flows once the task holds the browser", () =>
  assert.equal(decideBrowser(NAVIGATE, heldBySelf).action, "allow"),
);
check("browser call is denied while another task holds the browser", () =>
  assert.equal(decideBrowser(NAVIGATE, heldByOther).action, "deny"),
);
check("file upload asks even for the task holding the browser", () =>
  assert.equal(decideBrowser(BROWSER_UPLOAD_TOOL, heldBySelf).action, "ask"),
);
check("file upload asks on first browser use too", () =>
  assert.equal(decideBrowser(BROWSER_UPLOAD_TOOL, free).action, "ask"),
);
check("file upload is denied while another task holds the browser", () =>
  assert.equal(decideBrowser(BROWSER_UPLOAD_TOOL, heldByOther).action, "deny"),
);
check("run_code_unsafe asks even for the task holding the browser (host-level code)", () =>
  assert.equal(decideBrowser(BROWSER_UNSAFE_CODE_TOOL, heldBySelf).action, "ask"),
);
check("browser tools are recognised by prefix", () => {
  assert.equal(isBrowserTool(NAVIGATE), true);
  assert.equal(isBrowserTool(BROWSER_UPLOAD_TOOL), true);
  assert.equal(isBrowserTool("mcp__discord__send_file"), false);
  assert.equal(isBrowserTool("Bash"), false);
});
check("a browser tool that slips past the router still asks", () =>
  assert.equal(decide(NAVIGATE, {}, []).action, "ask"),
);

console.log(failures === 0 ? "\nall policy checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
