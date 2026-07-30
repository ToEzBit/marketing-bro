/**
 * Pre-flight check: run with `npm run doctor`.
 * Verifies the Claude Agent SDK can start on this host and that authentication
 * works, before Discord is involved at all.
 */
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { config as loadEnv } from "dotenv";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { expandPath } from "./config.js";

loadEnv();

function report(ok: boolean, label: string, detail = ""): boolean {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function* onePrompt(text: string): AsyncIterable<SDKUserMessage> {
  yield { type: "user", parent_tool_use_id: null, message: { role: "user", content: text } };
  // Hold the input stream open so the query stays in streaming-input mode,
  // which is what the bot uses. The loop below breaks well before this settles.
  await new Promise((resolve) => setTimeout(resolve, 120_000));
}

async function main(): Promise<void> {
  console.log("— environment —");
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() ?? "";
  const hasToken = report(
    token.length > 0,
    "CLAUDE_CODE_OAUTH_TOKEN",
    token ? `set (${token.slice(0, 12)}…)` : "not set — run `claude setup-token` and put it in .env",
  );

  if (process.env.ANTHROPIC_API_KEY) {
    console.log(
      "⚠️  ANTHROPIC_API_KEY is set in this shell. The bot clears it for the agent so " +
        "requests bill against your subscription, not the API.",
    );
  }

  const workspace = expandPath(process.env.DEFAULT_WORKSPACE ?? homedir());
  report(
    existsSync(workspace) && statSync(workspace).isDirectory(),
    "DEFAULT_WORKSPACE",
    workspace,
  );

  for (const name of ["DISCORD_TOKEN", "DISCORD_APP_ID", "OPERATOR_USER_ID"]) {
    report(Boolean(process.env[name]?.trim()), name);
  }

  console.log("\n— browser —");
  try {
    createRequire(import.meta.url).resolve("@playwright/mcp/package.json");
    report(true, "@playwright/mcp");
  } catch {
    report(false, "@playwright/mcp", "not installed — run `npm install`");
  }
  const chromePath =
    platform() === "darwin"
      ? "/Applications/Google Chrome.app"
      : platform() === "linux"
        ? "/opt/google/chrome/chrome"
        : "";
  if (chromePath) {
    report(
      existsSync(chromePath),
      "Google Chrome",
      existsSync(chromePath)
        ? chromePath
        : "not found — the agent's browser runs on the chrome channel (ADR 0003)",
    );
  }
  const profileDir = expandPath(process.env.BROWSER_PROFILE_DIR ?? "./.state/browser-profile");
  report(
    true,
    "browser profile",
    existsSync(profileDir)
      ? profileDir
      : `${profileDir} (ยังไม่มี — รัน \`npm run browser:login\` เพื่อล็อกอินครั้งแรก)`,
  );

  console.log("\n— agent —");
  console.log("starting a one-turn query (no tools, no file access)…");

  const stream = query({
    prompt: onePrompt("Reply with exactly: OK"),
    options: {
      cwd: workspace,
      model: process.env.DEFAULT_MODEL?.trim() || "sonnet",
      permissionMode: "acceptEdits",
      ...(hasToken
        ? {
            env: {
              ...process.env,
              ANTHROPIC_API_KEY: undefined,
              ANTHROPIC_AUTH_TOKEN: undefined,
              CLAUDE_CODE_OAUTH_TOKEN: token,
            },
          }
        : {}),
      stderr: (data: string) => console.error("[claude-code]", data.trimEnd()),
    },
  });

  let answered = false;
  for await (const message of stream) {
    if (message.type === "system" && message.subtype === "init") {
      report(true, "session started", `session_id ${message.session_id}`);
    } else if (message.type === "assistant") {
      const blocks = message.message.content as unknown as Array<{ type: string; text?: string }>;
      for (const block of blocks) {
        if (block.type === "text" && block.text?.trim()) {
          report(true, "model replied", JSON.stringify(block.text.trim()));
          answered = true;
        }
      }
    } else if (message.type === "result") {
      const ok = message.subtype === "success" && !message.is_error;
      report(ok, "turn completed", `${(message.duration_ms / 1000).toFixed(1)}s, ${message.num_turns} turn(s)`);
      if (!ok && message.subtype !== "success") {
        console.error("   errors:", message.errors.join("; "));
      }
      break;
    }
  }

  console.log(
    answered
      ? `\n${hasToken ? "พร้อมใช้งาน" : "SDK ทำงานได้ แต่ยังไม่ได้ตั้ง CLAUDE_CODE_OAUTH_TOKEN"} — ` +
          "ต่อไปรัน `npm run dev`"
      : "\nไม่ได้รับคำตอบจากโมเดล ตรวจ auth แล้วลองใหม่",
  );
  process.exit(answered ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("\n❌ doctor failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
