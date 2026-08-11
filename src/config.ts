import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv();

export type Config = {
  discordToken: string;
  discordAppId: string;
  /** Restrict command registration to one guild. Empty = register globally. */
  discordGuildId: string;
  oauthToken: string;
  /** Discord user IDs allowed to command the bot. */
  allowedUserIds: string[];
  /** Discord user ID of the host machine's owner. Can approve any request. */
  operatorUserId: string;
  defaultWorkspace: string;
  defaultModel: string;
  /** Extra Bash commands to auto-approve, beyond the built-in read-only set. */
  extraBashAllow: string[];
  /** How long an approval prompt waits before auto-denying. */
  approvalTimeoutMs: number;
  /** Idle time after which a session's subprocess is reaped (context is resumable). */
  sessionIdleTimeoutMs: number;
  sessionStatePath: string;
  /** Where Schedules are persisted, so they survive restarts. */
  scheduleStatePath: string;
  /** Chrome profile the agent's browser uses. Holds real logins — never commit. */
  browserProfileDir: string;
  /**
   * Skip the once-per-Task browser Approval in interactive Tasks (ADR 0008).
   * The two host-escape tools (file upload / run_code_unsafe) still ask.
   */
  browserAutoApprove: boolean;
  /** Central Skill folder the Operator drops skill folders into (ADR 0005). */
  skillsDir: string;
  /** Generated plugin scaffold the SDK loads the skills through. */
  skillsPluginDir: string;
  /**
   * Port for the read-only Office UI on `127.0.0.1`. `undefined` = off, which is the default:
   * no server, no timers, nothing. The page has no auth, so the host is hard-coded in
   * `src/office/server.ts` and deliberately not configurable (ADR 0002).
   */
  officeUiPort: number | undefined;
};

/** Default Skill folder when SKILLS_DIR is unset — doctor reads it too. */
export const DEFAULT_SKILLS_DIR = "./skills";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/** Reads a positive-integer env var, falling back on anything unparseable. */
function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[config] ${name}="${raw}" is not a positive number; using ${fallback}`);
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * Reads an optional positive-integer env var — undefined when unset or unusable.
 * `positiveInt` above always needs a fallback, so it cannot express "off by default".
 */
function optionalPositiveInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[config] ${name}="${raw}" is not a positive number; Office UI stays off`);
    return undefined;
  }
  return Math.floor(parsed);
}

/** Reads a boolean env var — "true" / "1" / "yes" (case-insensitive) mean on. */
function flag(name: string): boolean {
  return ["true", "1", "yes"].includes(process.env[name]?.trim().toLowerCase() ?? "");
}

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Expands a leading `~` and resolves to an absolute path. */
export function expandPath(input: string): string {
  const trimmed = input.trim();
  const expanded =
    trimmed === "~" || trimmed.startsWith("~/")
      ? resolve(homedir(), trimmed.slice(1).replace(/^[/\\]/, ""))
      : trimmed;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export function loadConfig(): Config {
  const operatorUserId = required("OPERATOR_USER_ID");
  const allowedUserIds = list("ALLOWED_USER_IDS");
  if (!allowedUserIds.includes(operatorUserId)) {
    allowedUserIds.push(operatorUserId);
  }

  return {
    discordToken: required("DISCORD_TOKEN"),
    discordAppId: required("DISCORD_APP_ID"),
    discordGuildId: process.env.DISCORD_GUILD_ID?.trim() ?? "",
    oauthToken: required("CLAUDE_CODE_OAUTH_TOKEN"),
    allowedUserIds,
    operatorUserId,
    defaultWorkspace: expandPath(process.env.DEFAULT_WORKSPACE ?? homedir()),
    defaultModel: process.env.DEFAULT_MODEL?.trim() || "sonnet",
    extraBashAllow: list("EXTRA_BASH_ALLOW"),
    approvalTimeoutMs: positiveInt("APPROVAL_TIMEOUT_MS", 600_000),
    sessionIdleTimeoutMs: positiveInt("SESSION_IDLE_TIMEOUT_MS", 1_800_000),
    sessionStatePath: expandPath(
      process.env.SESSION_STATE_PATH ?? "./.state/sessions.json",
    ),
    scheduleStatePath: expandPath(
      process.env.SCHEDULE_STATE_PATH ?? "./.state/schedules.json",
    ),
    browserProfileDir: expandPath(
      process.env.BROWSER_PROFILE_DIR ?? "./.state/browser-profile",
    ),
    browserAutoApprove: flag("BROWSER_AUTO_APPROVE"),
    skillsDir: expandPath(process.env.SKILLS_DIR ?? DEFAULT_SKILLS_DIR),
    skillsPluginDir: expandPath("./.state/skills-plugin"),
    officeUiPort: optionalPositiveInt("OFFICE_UI_PORT"),
  };
}
