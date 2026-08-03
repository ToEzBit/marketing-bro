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
import { readFileSync, writeFileSync } from "node:fs";
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

/**
 * Chrome records a killed browser as a crashed exit, and the next launch on
 * this profile then restores every tab that was left open — so the agent's
 * old tabs "follow it" into the next session. Rewriting the profile's
 * Preferences before each launch marks the last exit as clean and pins
 * startup to a fresh new-tab page, so every launch starts empty. Best-effort:
 * a missing Preferences file just means a first run with nothing to restore.
 */
function forgetOpenTabs(profileDir: string): void {
  const prefsPath = join(profileDir, "Default", "Preferences");
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8")) as {
      profile?: Record<string, unknown>;
      session?: Record<string, unknown>;
    };
    prefs.profile = { ...prefs.profile, exit_type: "Normal", exited_cleanly: true };
    // 5 = "open the New Tab page" (1 would mean "continue where you left off").
    prefs.session = { ...prefs.session, restore_on_startup: 5 };
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    return;
  }
}

/** Command line for the Playwright MCP server the agent drives. */
export function playwrightMcpArgs(options: {
  profileDir: string;
  outputDir: string;
}): string[] {
  // Building the command is the last stop before every agent-side launch
  // (ADR 0003), so the profile cleanup rides along here.
  forgetOpenTabs(options.profileDir);
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
  forgetOpenTabs(profileDir);
  return chromium.launchPersistentContext(profileDir, {
    channel: CHANNEL,
    headless: false,
    // Let the window size itself, like a browser a person opened.
    viewport: null,
  });
}
