import {
  query,
  type CanUseTool,
  type McpServerConfig,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
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

When you are done with the browser for the current request, tidy up before closing: list the open tabs with mcp__${BROWSER_MCP_NAME}__browser_tabs (action "list") and close every extra tab (action "close" with its index) until one tab remains — leftover tabs from earlier tasks get carried into the next launch as clutter. Then call mcp__${BROWSER_MCP_NAME}__browser_close to close the window. Closing loses nothing: logins live in the profile on disk (web chats and their history live on the site's servers, not in tabs), and if a follow-up needs the browser again you can just reopen it (no new approval is needed within the same task). Only leave it open when you genuinely expect to continue on the same page within this turn.

The browser is shared by the whole bot, one task at a time. When another task is using it, your browser call simply takes longer to start — it is waiting in a queue and proceeds automatically the moment the browser frees up. Never schedule your own retries or wakeups for a busy browser; waiting inside the call IS the retry.

If the browser fails to launch with a ProcessSingleton or "profile already in use" error, the profile is open outside the bot — tell the user to close the window left open by \`npm run browser:login\`, then try again. Do not work around it by launching a browser yourself through Bash.`;

/** Content block shapes we render. Narrower than the SDK's full union. */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking" }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: string };

/**
 * How a turn ended. A stop the user asked for is its own outcome: the SDK
 * reports the abort it causes as an execution error, but nobody wants to read
 * their own `/stop` as something that broke.
 */
export type TurnStatus = "ok" | "failed" | "interrupted";

export type TurnSummary = {
  status: TurnStatus;
  durationMs: number;
  turns: number;
  costUsd: number;
  /**
   * Raw error strings from the SDK, when the turn failed. They can carry
   * internal diagnostics, so they are written for the Host's log — whoever
   * shows a summary to a Member filters them first (`formatSummary` in bot.ts).
   */
  errors?: string[];
};

/**
 * The slice of the SDK's query that a session drives: a stream of messages it
 * can interrupt. Narrow on purpose — a test can hand-write one of these.
 */
export type AgentStream = AsyncIterable<SDKMessage> & Pick<Query, "interrupt">;

/**
 * Starts the SDK query. Injected so a test can script a message stream instead
 * of spawning a real Claude Code subprocess; production always uses the SDK's
 * own `query`.
 */
export type StartQuery = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => AgentStream;

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

/**
 * An approval this session has asked a human about and is still waiting on.
 * Read-only bookkeeping — the answer still comes from the hook, never from here.
 */
export type PendingApproval = {
  toolName: string;
  input: Record<string, unknown>;
  /** When the request went out; the approval's own deadline counts from here. */
  since: number;
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
  /**
   * Auto-approve, refuse outright, or escalate to a human. May resolve slowly —
   * a browser call stands in the Browser queue in here (ADR 0006) — so the
   * abort signal of the underlying tool call is passed along for early exit.
   */
  decide: (
    toolName: string,
    input: Record<string, unknown>,
    context: { signal: AbortSignal },
  ) =>
    | Decision
    | Promise<Decision>;
};

type Decision =
  | { action: "allow"; reason: string }
  | { action: "ask"; reason: string }
  | { action: "deny"; reason: string };

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
  /**
   * Generated plugin scaffold that carries the bot's central Skill folder
   * (ADR 0005). Omit and the session has no skills.
   */
  skillsPluginPath?: string;
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
  private readonly stream: AgentStream;
  private readonly pump: Promise<void>;
  private sessionId: string | undefined;
  private busy = false;
  private closed = false;
  /**
   * Set when someone asked the running turn to stop. This flag, not the shape
   * of the SDK's error, is what makes the turn read as a stop instead of a
   * failure.
   */
  private stopRequested = false;
  /** Paired with {@link stopRequested}: set and cleared in the same places. */
  private stopRequestedAtMs: number | undefined;
  private turnEnded: (() => void) | undefined;
  private lastActivityAt = Date.now();
  private readonly createdAt = Date.now();
  private turnStartedAtMs: number | undefined;
  private lastTurnEnded: { summary: TurnSummary; endedAt: number } | undefined;
  /**
   * The approvals waiting on a human right now. A list, not one entry: the
   * agent can call several tools in parallel, so more than one can be pending
   * at a time (and the second must not overwrite the first).
   */
  private readonly waitingApprovals: PendingApproval[] = [];

  constructor(
    private readonly config: SessionConfig,
    private readonly hooks: SessionHooks,
    startQuery: StartQuery = query,
  ) {
    this.stream = startQuery({ prompt: this.queue, options: this.buildOptions() });
    this.pump = this.drain();
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * A turn is running and someone asked it to stop. Both halves matter: a
   * `/stop` while idle leaves the flag set until the next turn starts, and that
   * session is simply idle — nothing is being stopped.
   */
  get isStopping(): boolean {
    return this.busy && this.stopRequested;
  }

  /** Whether the session is done for good — closed, or dead of its own accord. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** When this session was created (epoch ms). */
  get startedAt(): number {
    return this.createdAt;
  }

  /** When the running turn began, or undefined between turns. */
  get turnStartedAt(): number | undefined {
    return this.turnStartedAtMs;
  }

  /**
   * When the stop was asked for, cleared as soon as a turn begins or ends.
   * A `/stop` while idle stamps it too, so pair it with {@link isStopping}:
   * on its own it says a stop was asked for, not that one is under way.
   */
  get stopRequestedAt(): number | undefined {
    return this.stopRequestedAtMs;
  }

  /** How the last finished turn ended, and when. Undefined until one has. */
  get lastTurn(): { summary: TurnSummary; endedAt: number } | undefined {
    return this.lastTurnEnded;
  }

  /** Copy of the approvals still waiting on a human, oldest first. */
  get pendingApprovals(): PendingApproval[] {
    return [...this.waitingApprovals];
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
    this.beginTurn();
    this.hooks.onHeadline("กำลังคิด");
    const finished = new Promise<void>((resolve) => {
      this.turnEnded = resolve;
    });
    this.queue.push(text);
    await finished;
  }

  /**
   * Injects a message into the running turn without waiting for it to end, so a
   * user can redirect the agent mid-task. The turn it lands in may be the
   * running one or — when it arrives just as that one ends — a new one; either
   * way the stream is what reports the session busy again, not this call.
   */
  steer(text: string): void {
    if (this.closed) throw new Error("session is closed");
    this.lastActivityAt = Date.now();
    this.queue.push(text);
  }

  /**
   * Asks the SDK to stop the running turn. Not guarded by {@link isBusy} on
   * purpose: a brake must work even when the flag is out of date, and the flag
   * this sets is what makes the turn that follows read as a stop.
   */
  async interrupt(): Promise<void> {
    if (this.closed) return;
    this.stopRequested = true;
    this.stopRequestedAtMs = Date.now();
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
      // Central Skill folder via a local plugin (ADR 0005). `skills: "all"`
      // switches the Skill tool on even for sessions with a restricted
      // allowedTools list, like /ask.
      ...(this.config.skillsPluginPath
        ? {
            plugins: [{ type: "local" as const, path: this.config.skillsPluginPath }],
            skills: "all" as const,
          }
        : {}),
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
    const verdict = await this.hooks.decide(toolName, input, { signal: options.signal });
    if (verdict.action === "allow") {
      this.hooks.onActivity(`auto-approved ${toolName}`);
      return { behavior: "allow" };
    }
    if (verdict.action === "deny") {
      this.hooks.onActivity(`denied ${toolName} — ${verdict.reason}`);
      return { behavior: "deny", message: verdict.reason };
    }

    this.hooks.onHeadline("รออนุมัติจากผู้ใช้");
    // Bookkeeping only, and it has to come off again on every way out of here —
    // allowed, denied, timed out, or the tool call aborted under us. An entry
    // left behind would show a session waiting on a human forever.
    const pending: PendingApproval = { toolName, input, since: Date.now() };
    this.waitingApprovals.push(pending);
    try {
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
    } finally {
      const index = this.waitingApprovals.indexOf(pending);
      if (index !== -1) this.waitingApprovals.splice(index, 1);
    }
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
    // A turn can start without anyone calling send(): a steered message that
    // lands just as the previous turn ends becomes a turn of its own. So the
    // stream, not the caller, is what says this session is working.
    if (!this.busy && startsTurn(message)) this.beginTurn();
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
        const summary = this.summarize(message);
        // Recorded before the hook runs: reporting the outcome to Discord takes
        // as long as Discord takes, and the turn ended when the result arrived.
        this.lastTurnEnded = { summary, endedAt: Date.now() };
        await this.hooks.onTurnEnd(summary);
        this.finishTurn();
        return;
      }

      default:
        return;
    }
  }

  /**
   * Turns the SDK's end-of-turn result into the outcome a human is told about.
   * A stop the user asked for arrives here as an execution error, so the stop
   * flag is what separates the two. The SDK's `terminal_reason` only
   * corroborates it — it is a free-form string that can change under us, so the
   * brake still reads correctly if it does.
   */
  private summarize(message: SDKResultMessage): TurnSummary {
    const base = {
      durationMs: message.duration_ms,
      turns: message.num_turns,
      costUsd: message.total_cost_usd,
    };
    if (message.subtype === "success" && !message.is_error) {
      return { ...base, status: "ok" };
    }
    if (this.stopRequested) {
      if (!message.terminal_reason?.startsWith("aborted")) {
        // The flag decides; disagreement is only worth a trace — the SDK ended
        // this turn some other way than the abort we asked for.
        console.error(
          `[agent] user stop, but terminal_reason=${message.terminal_reason ?? "n/a"} (expected aborted_*)`,
        );
      }
      return { ...base, status: "interrupted" };
    }
    // A "success" result that is flagged an error carries its detail as prose
    // in `result` instead of an error list; either way something has to reach
    // the Host's log, or the thread's "see the Host log" is a dead end.
    const errors = message.subtype === "success" ? [message.result] : message.errors;
    // The Host's log keeps the whole thing, diagnostics and all; what reaches
    // the thread is filtered down to something a Member can act on.
    console.error(
      `[agent] turn failed (${message.subtype}, terminal_reason=${message.terminal_reason ?? "n/a"}):`,
      errors,
    );
    return { ...base, status: "failed", errors };
  }

  private beginTurn(): void {
    this.busy = true;
    this.stopRequested = false;
    this.stopRequestedAtMs = undefined;
    this.turnStartedAtMs = Date.now();
  }

  private finishTurn(): void {
    this.busy = false;
    this.stopRequested = false;
    this.stopRequestedAtMs = undefined;
    this.turnStartedAtMs = undefined;
    const resolve = this.turnEnded;
    this.turnEnded = undefined;
    resolve?.();
  }
}

/**
 * Whether a message means a turn is running. Only assistant messages count:
 * they exist only inside a turn and are always followed by a result, so busy is
 * guaranteed to be cleared again. The expensive mistake is the other one — a
 * session marked busy with no result coming would sit at 🟢 in `/status`
 * forever and never be reaped by the idle sweeper — which rules out user
 * messages, since a resumed session replays old ones outside any turn.
 */
function startsTurn(message: SDKMessage): boolean {
  return message.type === "assistant";
}
