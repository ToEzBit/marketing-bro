import { existsSync, statSync } from "node:fs";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ThreadAutoArchiveDuration,
  type ChatInputCommandInteraction,
  type Message,
  type ThreadChannel,
} from "discord.js";
import {
  AgentSession,
  type SessionHooks,
  type TurnSummary,
} from "./agent-session.js";
import { SEND_FILE_TOOL } from "./attachment-tool.js";
import { expandPath, type Config } from "./config.js";
import { decide } from "./policy.js";
import { registerCommands } from "./discord/commands.js";
import { requestApproval } from "./discord/approval.js";
import { ThreadReporter, describeTool, truncate, type Postable } from "./discord/render.js";
import { TaskStore, type TaskRecord } from "./store.js";

type LiveSession = {
  session: AgentSession;
  reporter: ThreadReporter;
  record: TaskRecord;
};

const IDLE_SWEEP_INTERVAL_MS = 5 * 60_000;

/** Read-only toolset for `/ask`: look things up and show files, change nothing. */
const ASK_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", SEND_FILE_TOOL];

export class Bot {
  private readonly client: Client;
  private readonly store: TaskStore;
  private readonly sessions = new Map<string, LiveSession>();
  /** `/ask` sessions, which live outside the per-thread map but still need closing. */
  private readonly transientSessions = new Set<AgentSession>();
  private idleSweeper: NodeJS.Timeout | undefined;

  constructor(private readonly config: Config) {
    this.store = new TaskStore(config.sessionStatePath);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        // Privileged: required to read follow-up messages inside task threads.
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async start(): Promise<void> {
    await this.store.load();
    this.validateWorkspace();

    this.client.once(Events.ClientReady, (client) => {
      console.log(`[bot] logged in as ${client.user.tag}`);
      console.log(`[bot] default workspace: ${this.config.defaultWorkspace}`);
      console.log(`[bot] allowed users: ${this.config.allowedUserIds.join(", ")}`);
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      void this.onCommand(interaction).catch((error: unknown) => {
        console.error("[bot] command failed:", error);
      });
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.onMessage(message).catch((error: unknown) => {
        console.error("[bot] message handling failed:", error);
      });
    });

    this.client.on(Events.ThreadDelete, (thread) => {
      void this.closeSession(thread.id);
    });

    await registerCommands({
      token: this.config.discordToken,
      appId: this.config.discordAppId,
      guildId: this.config.discordGuildId,
    });
    console.log("[bot] slash commands registered");

    // Each session holds a Claude Code subprocess, so idle ones are reaped. The
    // thread's session id stays on disk, so a later message resumes its context.
    this.idleSweeper = setInterval(() => {
      void this.sweepIdleSessions();
    }, IDLE_SWEEP_INTERVAL_MS);
    this.idleSweeper.unref();

    await this.client.login(this.config.discordToken);
  }

  async shutdown(): Promise<void> {
    console.log("[bot] shutting down…");
    if (this.idleSweeper) clearInterval(this.idleSweeper);
    await Promise.allSettled([
      ...[...this.sessions.keys()].map((id) => this.closeSession(id)),
      ...[...this.transientSessions].map((session) => session.close()),
    ]);
    this.transientSessions.clear();
    await this.client.destroy();
  }

  private async sweepIdleSessions(): Promise<void> {
    for (const [threadId, live] of this.sessions) {
      if (live.session.isBusy) continue;
      if (live.session.idleForMs < this.config.sessionIdleTimeoutMs) continue;
      console.log(`[bot] reaping idle session for thread ${threadId}`);
      await this.closeSession(threadId);
    }
  }

  private validateWorkspace(): void {
    const path = this.config.defaultWorkspace;
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error(`DEFAULT_WORKSPACE is not a directory: ${path}`);
    }
  }

  private isAllowed(userId: string): boolean {
    return this.config.allowedUserIds.includes(userId);
  }

  private async onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.isAllowed(interaction.user.id)) {
      await interaction.reply({
        content:
          "บอทนี้จำกัดเฉพาะทีมภายใน บัญชีของคุณไม่อยู่ในรายการที่อนุญาต ติดต่อ operator เพื่อขอเพิ่มสิทธิ์",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    switch (interaction.commandName) {
      case "task":
        await this.onTask(interaction);
        return;
      case "ask":
        await this.onAsk(interaction);
        return;
      case "stop":
        await this.onStop(interaction);
        return;
      case "status":
        await this.onStatus(interaction);
        return;
      default:
        await interaction.reply({
          content: `ไม่รู้จักคำสั่ง ${interaction.commandName}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  /** Resolves and validates the workspace for a new task. */
  private resolveWorkspace(input: string | null): { path: string } | { error: string } {
    if (!input) return { path: this.config.defaultWorkspace };
    const path = expandPath(input);
    if (!existsSync(path)) return { error: `ไม่พบโฟลเดอร์ \`${path}\` บนเครื่อง host` };
    if (!statSync(path).isDirectory()) return { error: `\`${path}\` ไม่ใช่โฟลเดอร์` };
    return { path };
  }

  private async onTask(interaction: ChatInputCommandInteraction): Promise<void> {
    const prompt = interaction.options.getString("prompt", true);
    const workspace = this.resolveWorkspace(interaction.options.getString("path"));
    if ("error" in workspace) {
      await interaction.reply({ content: workspace.error, flags: MessageFlags.Ephemeral });
      return;
    }
    const model = interaction.options.getString("model") ?? this.config.defaultModel;

    const thread = await this.openThread(interaction, prompt);
    if (!thread) return;

    // `/task` inside an existing task thread starts over: retire the old session
    // rather than leaving its subprocess orphaned.
    await this.closeSession(thread.id);

    const record: TaskRecord = {
      threadId: thread.id,
      ownerId: interaction.user.id,
      workspace: workspace.path,
      model,
      createdAt: new Date().toISOString(),
    };
    await this.store.put(record);

    await thread.send(
      [
        `📋 **งานใหม่** โดย <@${interaction.user.id}>`,
        `📂 \`${workspace.path}\``,
        `🧠 \`${model}\``,
        "",
        "พิมพ์ในเธรดนี้เพื่อคุยต่อหรือสั่งเพิ่ม · `/stop` เพื่อสั่งหยุด",
      ].join("\n"),
    );

    const live = this.createSession(thread, record);
    await live.session.send(prompt).catch(async (error: unknown) => {
      await this.reportSessionFailure(live, error);
    });
  }

  /** Reuses the current thread, or starts one under the command's reply. */
  private async openThread(
    interaction: ChatInputCommandInteraction,
    prompt: string,
  ): Promise<ThreadChannel | undefined> {
    const channel = interaction.channel;
    if (channel?.isThread()) {
      await interaction.reply({ content: "รับงานแล้ว — ทำในเธรดนี้", flags: MessageFlags.Ephemeral });
      return channel;
    }

    if (channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) {
      await interaction.reply({
        content: "ใช้คำสั่งนี้ได้ในห้องข้อความของเซิร์ฟเวอร์ที่สร้างเธรดได้เท่านั้น",
        flags: MessageFlags.Ephemeral,
      });
      return undefined;
    }

    await interaction.reply(`🧵 กำลังเปิดเธรดสำหรับ: ${truncate(prompt, 180)}`);
    const anchor = await interaction.fetchReply();
    return await anchor.startThread({
      name: truncate(prompt.replace(/\s+/g, " "), 90),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });
  }

  /** One-off question answered in the current channel, no thread, no context kept. */
  private async onAsk(interaction: ChatInputCommandInteraction): Promise<void> {
    const prompt = interaction.options.getString("prompt", true);
    const channel = interaction.channel;
    if (!channel || channel.isDMBased() || !channel.isTextBased()) {
      await interaction.reply({
        content: "ใช้คำสั่งนี้ได้ในห้องข้อความของเซิร์ฟเวอร์เท่านั้น",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply(`❓ <@${interaction.user.id}>: ${truncate(prompt, 1800)}`);

    const record: TaskRecord = {
      threadId: `ask:${interaction.id}`,
      ownerId: interaction.user.id,
      workspace: this.config.defaultWorkspace,
      model: this.config.defaultModel,
      createdAt: new Date().toISOString(),
    };
    const reporter = new ThreadReporter(channel as Postable);
    const session = new AgentSession(
      {
        workspace: record.workspace,
        model: record.model,
        oauthToken: this.config.oauthToken,
        // /ask is advertised as a question, so it gets a read-only toolset —
        // it can look things up but never change the host.
        allowedTools: ASK_TOOLS,
      },
      this.buildHooks({ reporter, channel: channel as Postable, record, persist: false }),
    );
    this.transientSessions.add(session);

    try {
      await session.send(prompt);
    } finally {
      this.transientSessions.delete(session);
      await reporter.clearStatus();
      await session.close();
    }
  }

  private async onStop(interaction: ChatInputCommandInteraction): Promise<void> {
    const threadId = interaction.channel?.id ?? "";
    const live = this.sessions.get(threadId);
    if (!live) {
      await interaction.reply({
        content: "ไม่มีงานที่กำลังรันอยู่ในเธรดนี้",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply(`🛑 <@${interaction.user.id}> สั่งหยุดงาน`);
    await live.session.interrupt();
  }

  private async onStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    if (this.sessions.size === 0) {
      await interaction.reply({
        content: "ไม่มีงานที่กำลังทำอยู่",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = [...this.sessions.values()].map((live) => {
      const state = live.session.isBusy ? "🟢 กำลังทำงาน" : "⚪ ว่าง";
      return `${state} <#${live.record.threadId}> · \`${live.record.workspace}\` · \`${live.record.model}\``;
    });
    await interaction.reply({
      content: [`**งานทั้งหมด ${this.sessions.size} งาน**`, ...lines].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  /** Routes a follow-up message in a task thread into that thread's session. */
  private async onMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.channel.isThread()) return;
    if (!message.content.trim()) return;

    const thread = message.channel;
    const record = this.store.get(thread.id);
    if (!record) return;

    if (!this.isAllowed(message.author.id)) {
      await message.react("🚫").catch(() => undefined);
      return;
    }

    const live = this.sessions.get(thread.id) ?? this.createSession(thread, record);

    if (live.session.isBusy) {
      // Injected into the running turn so the user can redirect mid-task.
      live.session.steer(message.content);
      await message.react("👀").catch(() => undefined);
      return;
    }

    await live.session.send(message.content).catch(async (error: unknown) => {
      await this.reportSessionFailure(live, error);
    });
  }

  private createSession(thread: Postable, record: TaskRecord): LiveSession {
    const reporter = new ThreadReporter(thread);
    const session = new AgentSession(
      {
        workspace: record.workspace,
        model: record.model,
        oauthToken: this.config.oauthToken,
        ...(record.sessionId ? { resumeSessionId: record.sessionId } : {}),
      },
      this.buildHooks({ reporter, channel: thread, record, persist: true }),
    );
    const live: LiveSession = { session, reporter, record };
    this.sessions.set(record.threadId, live);
    return live;
  }

  private buildHooks(context: {
    reporter: ThreadReporter;
    channel: Postable;
    record: TaskRecord;
    persist: boolean;
  }): SessionHooks {
    const { reporter, channel, record, persist } = context;
    const approverIds = [...new Set([record.ownerId, this.config.operatorUserId])];

    return {
      onText: (text) => reporter.say(text),
      onActivity: (line) => reporter.addActivity(line),
      onHeadline: (headline) => reporter.setHeadline(headline),
      onSessionId: async (sessionId) => {
        if (persist) await this.store.setSessionId(record.threadId, sessionId);
      },
      decide: (toolName, input) => decide(toolName, input, this.config.extraBashAllow),
      onApprovalNeeded: async (request) => {
        reporter.addActivity(`ขออนุมัติ ${request.toolName} ${describeTool(request.toolName, request.input)}`);
        return await requestApproval({
          thread: channel,
          toolName: request.toolName,
          input: request.input,
          reason: request.reason,
          ...(request.title ? { title: request.title } : {}),
          ...(request.description ? { description: request.description } : {}),
          ...(request.blockedPath ? { blockedPath: request.blockedPath } : {}),
          ...(request.suggestions ? { suggestions: request.suggestions } : {}),
          approverIds,
          timeoutMs: this.config.approvalTimeoutMs,
          signal: request.signal,
        });
      },
      onSendFile: async (buffer, filename, caption) => {
        await reporter.attach(buffer, filename, caption);
      },
      onTurnEnd: async (summary) => {
        await reporter.clearStatus();
        await reporter.say(formatSummary(summary));
      },
      onFatal: async (error, wasResuming) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[bot] session died (resuming=${wasResuming}):`, error);
        this.sessions.delete(record.threadId);
        await reporter.clearStatus();

        if (wasResuming && persist) {
          // The stored session id is gone from Claude Code's history. Drop it so
          // the next message starts a fresh session instead of failing forever.
          await this.store.put({ ...record, sessionId: undefined });
          await reporter.say(
            "♻️ บริบทเดิมของเธรดนี้หมดอายุแล้ว พิมพ์อีกครั้งเพื่อเริ่มเซสชันใหม่ (ประวัติใน Claude Code หายไป แต่ข้อความในเธรดยังอยู่)",
          );
          return;
        }
        await reporter.say(`❌ เซสชันหยุดทำงาน: ${detail}`);
      },
    };
  }

  private async reportSessionFailure(live: LiveSession, error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[bot] session error:", error);
    await live.reporter.clearStatus();
    await live.reporter.say(`❌ งานล้มเหลว: ${detail}`);
  }

  private async closeSession(threadId: string): Promise<void> {
    const live = this.sessions.get(threadId);
    if (!live) return;
    this.sessions.delete(threadId);
    await live.reporter.clearStatus();
    await live.session.close();
  }
}

function formatSummary(summary: TurnSummary): string {
  const seconds = (summary.durationMs / 1000).toFixed(1);
  if (!summary.ok) {
    const detail = summary.errors?.join("; ") ?? "ไม่ทราบสาเหตุ";
    return `⚠️ จบแบบมีปัญหา (${seconds}s): ${truncate(detail, 1500)}`;
  }
  return `-# ✅ เสร็จใน ${seconds}s · ${summary.turns} turns`;
}
