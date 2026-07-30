/**
 * End-to-end test of the Discord attachment path: run with `npm run test:agent`.
 * Spends a small amount of subscription quota because it drives a real agent turn.
 * This is the only test that proves the agent chooses `send_file` over merely
 * reading a file — the behaviour that makes "show me this image" work.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession } from "./agent-session.js";
import { decide } from "./policy.js";
import { SEND_FILE_TOOL } from "./attachment-tool.js";

// Smallest valid PNG (1x1 transparent pixel).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main(): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "probe-attach-"));
  const imagePath = join(workspace, "pixel.png");
  writeFileSync(imagePath, PNG);

  const sent: Array<{ filename: string; bytes: number; caption?: string }> = [];
  const activity: string[] = [];

  const session = new AgentSession(
    { workspace, model: "sonnet", oauthToken: "" },
    {
      onText: (text) => console.log("  agent:", text.trim().slice(0, 160)),
      onActivity: (line) => activity.push(line),
      onHeadline: () => undefined,
      onSessionId: () => undefined,
      onFatal: (error) => console.error("  FATAL:", error),
      decide: (tool, input) => {
        const verdict = decide(tool, input, []);
        console.log(`  policy: ${tool} → ${verdict.action} (${verdict.reason})`);
        return verdict;
      },
      onApprovalNeeded: async ({ toolName }) => {
        console.log(`  ⚠️ unexpectedly asked approval for ${toolName}`);
        return { behavior: "deny", message: "probe denies" };
      },
      onSendFile: async (buffer, filename, caption) => {
        sent.push({ filename, bytes: buffer.length, ...(caption ? { caption } : {}) });
        console.log(`  📎 received ${filename} (${buffer.length} bytes)`);
      },
      onTurnEnd: () => undefined,
    },
  );

  console.log("=== asking the agent to show the image ===");
  await session.send(`Show me the image at ${imagePath}`);
  await session.close();

  console.log("\ntools used:", activity.join(", ") || "(none)");
  console.log("files delivered:", JSON.stringify(sent));

  const ok =
    sent.length === 1 && sent[0]!.filename === "pixel.png" && sent[0]!.bytes === PNG.length;
  console.log(
    ok
      ? `\n✅ PASS: agent called ${SEND_FILE_TOOL} and the exact bytes arrived`
      : "\n❌ FAIL: no file reached the Discord hook",
  );

  rmSync(workspace, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("probe failed:", error);
  process.exit(1);
});
