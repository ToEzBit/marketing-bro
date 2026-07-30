import {
  query,
  type CanUseTool,
  type McpServerConfig,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createDiscordToolServer, type SendFile } from "./attachment-tool.js";
import { BROWSER_MCP_NAME } from "./policy.js";

/**
 * The agent's default assumption is a terminal where the user sees tool output.
 * In Discord they see only the text it writes, so reading a file is invisible to
 * them — hence the explicit rule about showing files.
 */
const DISCORD_CONTEXT = `You are running as a Discord bot. The person you are talking to is in a Discord thread and can only see the messages you write — they cannot see your tool calls, tool results, or any file you read.

Showing a file to the user means calling the \`mcp__discord__send_file\` tool with its path. Reading a file only shows it to you. Whenever the user asks to see, show, open, view, display, or send a file — an image, screenshot, PDF, chart, or any generated output — call \`mcp__discord__send_file\`. Do not answer such a request by describing the file in words; describe it only if they also ask what it contains, or after you have sent it.

Formatting: your messages render as Discord markdown. Bold, italics, inline code, code fences, and links work. Headings, tables, and footnotes do not — use short paragraphs and bullet lists instead. Keep individual messages under about 1500 characters; longer prose is automatically split or attached as a file.`;

/**
 * Appended when the session has browser tools. The profile carries real
 * logins, so the agent is told to treat them as the operator's property.
 */
const BROWSER_CONTEXT = `

You have browser tools (mcp__${BROWSER_MCP_NAME}__*) that drive a real, visible Chrome window on this machine. Its profile keeps the operator's logins (image-generation sites, social accounts) between tasks — use existing sessions, never log out of anything, and never change account settings unless that is the task. Screenshots are saved into the workspace; use mcp__discord__send_file to show them to the user.

If the browser fails to launch with a ProcessSingleton or "profile already in use" error, the profile is open elsewhere — tell the user to close the window left open by \`npm run browser:login\`, or to wait for the other task using the browser, then try again. Do not work around it by launching a browser yourself through Bash.`;

/** Content block shapes we render. Narrower than the SDK's full union. */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking" }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: string };

export type TurnSummary = {
  ok: boolean;
  durationMs: number;
  turns: number;
  costUsd: number;
  /** Error strings from the SDK, when the turn failed. */
  errors?: string[];
};

export type ToolApprovalRequest = {
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  title?: string;
  description?: string;
  blockedPath?: string;
  suggestions?: Parameters<CanUseTool>[2]["suggestions"];
  signal: AbortSignal;
};

export type SessionHooks = {
  /** Prose from the agent, ready to show the user. */
  onText: (text: string) => Promise<void> | void;
  /** A tool call started; one short line for the activity log. */
  onActivity: (line: string) => void;
  /** Current high-level state, e.g. "กำลังคิด". */
  onHeadline: (headline: string) => void;
  onTurnEnd: (summary: TurnSummary) => Promise<void> | void;
  /** Fired once Claude Code reports the session id, for resume-after-restart. */
  onSessionId: (sessionId: string) => Promise<void> | void;
  /**
   * The session died and cannot be used again. `wasResuming` distinguishes a
   * stale resume target (retryable with a fresh session) from a real failure.
   */
  onFatal: (error: unknown, wasResuming: boolean) => Promise<void> | void;
  /** Decides a tool call the policy escalated. */
  onApprovalNeeded: (request: ToolApprovalRequest) => Promise<PermissionResult>;
  /** Puts a file into the conversation as a real Discord attachment. */
  onSendFile: SendFile;
  /** Auto-approve, refuse outright, or escalate to a human. */
  decide: (
    toolName: string,
    input: Record<string, unknown>,
  ) =>
    | { action: "allow"; reason: string }
    | { action: "ask"; reason: string }
    | { action: "deny"; reason: string };
};

export type SessionConfig = {
  workspace: string;
  model: string;
  oauthToken: string;
  /** Claude Code session id to resume, when continuing after a restart. */
  resumeSessionId?: string;
  /** Restrict the agent to these tools. Omit for the full Claude Code toolset. */
  allowedTools?: string[];
  /** Playwright MCP server config. Omit and the session has no browser. */
  browserServer?: McpServerConfig;
};

/** Async queue that feeds user messages into a streaming-input query. */
class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | undefined;
  private closed = false;

  push(text: string): void {
    if (this.closed) return;
    const message: SDKUserMessage = {
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: text },
    };
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value: message, done: false });
    } else {
      this.pending.push(message);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const next = this.pending.shift();
        if (next) return Promise.resolve({ value: next, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
      return: (): Promise<IteratorResult<SDKUserMessage>> => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

/**
 * One Claude Code conversation, held open so follow-up messages keep their
 * context. Owns the SDK query, drains its message stream into the hooks, and
 * routes permission prompts through them.
 */
export class AgentSession {
  private readonly queue = new MessageQueue();
  private readonly abortController = new AbortController();
  private readonly stream: Query;
  private readonly pump: Promise<void>;
  private sessionId: string | undefined;
  private busy = false;
  private closed = false;
  private turnEnded: (() => void) | undefined;
  private lastActivityAt = Date.now();

  constructor(
    private readonly config: SessionConfig,
    private readonly hooks: SessionHooks,
  ) {
    this.stream = query({ prompt: this.queue, options: this.buildOptions() });
    this.pump = this.drain();
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** Milliseconds since this session last sent or received anything. */
  get idleForMs(): number {
    return Date.now() - this.lastActivityAt;
  }

  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * Sends a message and resolves when the resulting turn finishes. If a turn is
   * already running the text is injected into it instead — see {@link steer}.
   */
  async send(text: string): Promise<void> {
    if (this.closed) throw new Error("session is closed");
    if (this.busy) {
      this.steer(text);
      return;
    }
    this.lastActivityAt = Date.now();
    this.busy = true;
    this.hooks.onHeadline("กำลังคิด");
    const finished = new Promise<void>((resolve) => {
      this.turnEnded = resolve;
    });
    this.queue.push(text);
    await finished;
  }

  /**
   * Injects a message into the running turn without waiting for it to end, so a
   * user can redirect the agent mid-task.
   */
  steer(text: string): void {
    if (this.closed) throw new Error("session is closed");
    this.lastActivityAt = Date.now();
    this.queue.push(text);
  }

  async interrupt(): Promise<void> {
    if (!this.busy) return;
    await this.stream.interrupt().catch((error: unknown) => {
      console.error("[agent] interrupt failed:", error);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queue.close();
    this.abortController.abort();
    await this.pump.catch(() => undefined);
  }

  private buildOptions(): Options {
    return {
      cwd: this.config.workspace,
      model: this.config.model,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: this.config.browserServer ? DISCORD_CONTEXT + BROWSER_CONTEXT : DISCORD_CONTEXT,
      },
      // Load the project's own settings and CLAUDE.md, but not the operator's
      // personal ~/.claude config — a bot should have a predictable tool set,
      // not whatever plugins and MCP servers happen to be on this machine.
      settingSources: ["project"],
      // File edits inside the workspace run without a prompt; anything the CLI
      // wants to ask about lands in canUseTool below.
      permissionMode: "acceptEdits",
      canUseTool: this.canUseTool,
      abortController: this.abortController,
      // Lets the agent attach real files to the thread instead of only
      // describing them. Runs in this process, not a separate server.
      mcpServers: {
        discord: createDiscordToolServer({
          workspace: this.config.workspace,
          sendFile: this.hooks.onSendFile,
        }),
        ...(this.config.browserServer
          ? { [BROWSER_MCP_NAME]: this.config.browserServer }
          : {}),
      },
      ...(this.config.resumeSessionId ? { resume: this.config.resumeSessionId } : {}),
      ...(this.config.allowedTools ? { allowedTools: this.config.allowedTools } : {}),
      // ANTHROPIC_API_KEY takes precedence over the OAuth token, so it is
      // cleared here: this bot must bill against the Claude subscription only.
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: undefined,
        CLAUDE_CODE_OAUTH_TOKEN: this.config.oauthToken,
      },
      stderr: (data: string) => {
        console.error("[claude-code]", data.trimEnd());
      },
    };
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    const verdict = this.hooks.decide(toolName, input);
    if (verdict.action === "allow") {
      this.hooks.onActivity(`auto-approved ${toolName}`);
      return { behavior: "allow" };
    }
    if (verdict.action === "deny") {
      this.hooks.onActivity(`denied ${toolName} — ${verdict.reason}`);
      return { behavior: "deny", message: verdict.reason };
    }

    this.hooks.onHeadline("รออนุมัติจากผู้ใช้");
    const result = await this.hooks.onApprovalNeeded({
      toolName,
      input,
      reason: verdict.reason,
      ...(options.title ? { title: options.title } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(options.blockedPath ? { blockedPath: options.blockedPath } : {}),
      ...(options.suggestions ? { suggestions: options.suggestions } : {}),
      signal: options.signal,
    });
    this.hooks.onHeadline("กำลังคิด");
    return result;
  };

  /** Reads the SDK message stream for the life of the session. */
  private async drain(): Promise<void> {
    try {
      for await (const message of this.stream) {
        await this.handle(message);
      }
    } catch (error) {
      if (!this.closed) {
        this.closed = true;
        await this.hooks.onFatal(error, Boolean(this.config.resumeSessionId));
      }
    } finally {
      this.finishTurn();
    }
  }

  private async handle(message: SDKMessage): Promise<void> {
    this.lastActivityAt = Date.now();
    switch (message.type) {
      case "system": {
        if (message.subtype === "init") {
          this.sessionId = message.session_id;
          await this.hooks.onSessionId(message.session_id);
        }
        return;
      }

      case "assistant": {
        const blocks = message.message.content as unknown as ContentBlock[];
        for (const block of blocks) {
          if (block.type === "text") {
            await this.hooks.onText((block as { text: string }).text);
          } else if (block.type === "tool_use") {
            const use = block as { name: string; input: Record<string, unknown> };
            this.hooks.onActivity(`${use.name}`);
            this.hooks.onHeadline(`กำลังใช้ ${use.name}`);
          } else if (block.type === "thinking") {
            this.hooks.onHeadline("กำลังคิด");
          }
        }
        return;
      }

      case "result": {
        const summary: TurnSummary =
          message.subtype === "success"
            ? {
                ok: !message.is_error,
                durationMs: message.duration_ms,
                turns: message.num_turns,
                costUsd: message.total_cost_usd,
              }
            : {
                ok: false,
                durationMs: message.duration_ms,
                turns: message.num_turns,
                costUsd: message.total_cost_usd,
                errors: message.errors,
              };
        await this.hooks.onTurnEnd(summary);
        this.finishTurn();
        return;
      }

      default:
        return;
    }
  }

  private finishTurn(): void {
    this.busy = false;
    const resolve = this.turnEnded;
    this.turnEnded = undefined;
    resolve?.();
  }
}
