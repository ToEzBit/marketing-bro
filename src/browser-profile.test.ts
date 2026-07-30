/**
 * Run with: npm run test:browser  (needs Google Chrome; opens a window briefly)
 *
 * Locks the invariant that broke once already: a login done through
 * `npm run browser:login` must be visible to the browser the agent drives.
 * Both sides share one profile directory, but Chrome encrypts cookies with a
 * key that depends on how it was launched — a directly-launched Chrome uses
 * the macOS Keychain, while Playwright passes `--use-mock-keychain`. Mixing
 * the two silently produces two disjoint sets of logins in one directory.
 *
 * The agent's side of the test drives the real Playwright MCP server over
 * JSON-RPC, exactly as the bot does, so a change to `playwrightMcpArgs` that
 * stops the profile from persisting (`--isolated`, a different profile path)
 * fails here rather than in production.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProfileForLogin, playwrightMcpArgs } from "./browser.js";

const COOKIE_NAME = "bot_profile_probe";
const COOKIE_VALUE = "written-by-the-login-browser";

/** Serves back whatever cookie the browser sent, so the probe needs no network. */
async function startEchoServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const sent = /bot_profile_probe=([^;]+)/.exec(request.headers.cookie ?? "")?.[1] ?? "none";
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<h1>cookie:${sent}</h1>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Opens a page through the agent's own MCP server and returns its snapshot. */
function navigateAsAgent(options: {
  profileDir: string;
  url: string;
}): Promise<string> {
  const child = spawn(process.execPath, playwrightMcpArgs({
    profileDir: options.profileDir,
    outputDir: options.profileDir,
  }), { stdio: ["pipe", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const send = (message: object): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`MCP server never answered. stderr: ${stderr.slice(-500) || "(empty)"}`)),
      45_000,
    );
    let buffer = "";

    const finish = (error: Error | null, value = ""): void => {
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };

    child.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: { id?: number; result?: { content?: Array<{ text?: string }> } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "browser_navigate", arguments: { url: options.url } },
          });
        } else if (message.id === 2) {
          // Snapshots are written to a file, so read the page text directly.
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "browser_evaluate",
              arguments: { function: "() => document.body.innerText" },
            },
          });
        } else if (message.id === 3) {
          const text = (message.result?.content ?? []).map((part) => part.text ?? "").join("\n");
          finish(null, text);
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "browser-profile-test", version: "1.0" },
      },
    });
  });
}

const profileDir = await mkdtemp(join(tmpdir(), "bot-profile-test-"));
const echo = await startEchoServer();
let failed = false;

try {
  const login = await openProfileForLogin(profileDir);
  await login.addCookies([
    {
      name: COOKIE_NAME,
      value: COOKIE_VALUE,
      url: echo.url,
      // Session cookies are never written to disk; this one has to outlive Chrome.
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
  await login.close();

  const snapshot = await navigateAsAgent({ profileDir, url: echo.url });
  assert.ok(
    snapshot.includes(`cookie:${COOKIE_VALUE}`),
    "the agent's browser did not send the cookie the login browser stored — the two are not " +
      `sharing a profile. Page said: ${JSON.stringify(snapshot.slice(0, 400))}`,
  );
  console.log("  ok  a login written by browser:login reaches the agent's browser");
  console.log("\nbrowser profile check passed");
} catch (error) {
  failed = true;
  console.error("FAIL", error instanceof Error ? error.message : String(error));
} finally {
  await echo.close();
  // Chrome is still shutting down and writing into the profile as we delete it.
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

process.exit(failed ? 1 : 0);
