/**
 * Run with: npx tsx src/policy.test.ts
 * Asserts the auto-approve boundary — the check that keeps the bot from running
 * destructive shell commands without a human.
 */
import assert from "node:assert/strict";
import { decide } from "./policy.js";

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

function bash(command: string, extra: string[] = []): "allow" | "ask" {
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

console.log(failures === 0 ? "\nall policy checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
