/**
 * The one place the agent's browser and the operator's login browser agree on
 * how to open the shared Chrome profile (ADR 0003).
 *
 * They must agree exactly. Playwright launches Chrome with
 * `--use-mock-keychain --password-store=basic`, so its cookies are encrypted
 * with a key derived from the mock keychain — not the macOS Keychain that a
 * directly-launched Chrome uses. Two browsers can therefore share a profile
 * directory and still see two disjoint sets of logins. Every launch goes
 * through this module so that cannot drift apart again.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";

/** Chrome itself, not bundled Chromium — closer to a human's browser. */
const CHANNEL = "chrome";

/**
 * Resolved from the pinned dependency rather than run through `npx`, so the
 * version never depends on which workspace the session runs in. The package
 * exports only its root, so cli.js is reached via its package.json.
 */
export const PLAYWRIGHT_MCP_CLI = join(
  dirname(createRequire(import.meta.url).resolve("@playwright/mcp/package.json")),
  "cli.js",
);

/** Command line for the Playwright MCP server the agent drives. */
export function playwrightMcpArgs(options: {
  profileDir: string;
  outputDir: string;
}): string[] {
  return [
    PLAYWRIGHT_MCP_CLI,
    "--browser", CHANNEL,
    "--user-data-dir", options.profileDir,
    "--output-dir", options.outputDir,
  ];
}

/**
 * Opens the agent's profile in a visible window for a human to log in. Uses
 * Playwright — not the Chrome binary — so the sessions it stores are the ones
 * the agent's browser can actually read.
 */
export function openProfileForLogin(profileDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir, {
    channel: CHANNEL,
    headless: false,
    // Let the window size itself, like a browser a person opened.
    viewport: null,
  });
}
