import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ThreadAutoArchiveDuration,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import {
  AgentSession,
  type SessionHooks,
  type TurnSummary,
} from "./agent-session.js";
import { SEND_FILE_TOOL } from "./attachment-tool.js";
import { playwrightMcpArgs } from "./browser.js";
import { BrowserQueue, type AcquireOutcome } from "./browser-queue.js";
import { expandPath, type Config } from "./config.js";
import {
  decide,
  decideBrowser,
  decideScheduled,
  decideScheduledBrowser,
  isBrowserTool,
} from "./policy.js";
import { registerCommands } from "./discord/commands.js";
import { requestApproval } from "./discord/approval.js";
import { ThreadReporter, describeTool, truncate, type Postable } from "./discord/render.js";
import { sweepOrphans } from "./orphan-sweep.js";
import { describeRecurrence, nextFireAt, parseRecurrence } from "./recurrence.js";
import { ScheduleStore, type ScheduleRecord } from "./schedule-store.js";
import { ensureSkillsPlugin, listSkills, withSkill } from "./skills.js";
import { MAX_CONSECUTIVE_FAILURES, Scheduler, type RunOutcome } from "./scheduler.js";
import { TaskStore, type TaskRecord } from "./store.js";

type LiveSession = {
  session: AgentSession;
  reporter: ThreadReporter;
  record: TaskRecord;
};

const IDLE_SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * A scheduled Run stops waiting for the browser this long before its next
 * round is due, leaving the losing round time to end its turn before the new
 * round fires (ADR 0006) — a wait ending exactly on the slot would make the
 * scheduler skip the new round as still-running.
 */
const SCHEDULE_DEADLINE_GRACE_MS = 90_000;

/** One message for every way a waiter leaves the Browser queue unserved. */
const BROWSER_WAIT_CANCELLED = "งานถูกยกเลิกระหว่างรอคิว browser";

/** Button under a skipped/failed round; pressing it reruns that schedule once. */
const RERUN_BUTTON_PREFIX = "schedule-rerun:";

/** Read-only toolset for `/ask`: look things up and show files, change nothing. */
const ASK_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", SEND_FILE_TOOL];

export class Bot {
  private readonly client: Client;
  private readonly store: TaskStore;
  private readonly sessions = new Map<string, LiveSession>();
  /** `/ask` sessions, which live outside the per-thread map but still need closing. */
  private readonly transientSessions = new Set<AgentSession>();
  private readonly scheduleStore: ScheduleStore;
  private readonly scheduler: Scheduler;
  /** In-flight scheduled Runs, by schedule id, so shutdown can close them. */
  private readonly scheduleRuns = new Map<string, AgentSession>();
  private idleSweeper: NodeJS.Timeout | undefined;
  /**
   * The whole-bot Browser queue (ADR 0006). The profile allows one Chrome
   * instance, so one requester holds it at a time — taken on the first
   * allowed browser call of a turn, released when that turn ends — and
   * everyone else waits FIFO inside their pending tool call instead of being
   * denied.
   */
  private readonly browserQueue = new BrowserQueue();
  /**
   * Tasks whose one-per-task browser approval (ADR 0003) already happened.
   * Outlives the hold above, so a follow-up turn reopens the browser without
   * asking again. Forgotten when the task's session closes or dies, which
   * matches the old behaviour where the approval lived on the session.
   */
  private readonly browserApproved = new Set<string>();

  constructor(private readonly config: Config) {
    this.store = new TaskStore(config.sessionStatePath);
    this.scheduleStore = new ScheduleStore(config.scheduleStatePath);
    this.scheduler = new Scheduler(this.scheduleStore, {
      run: (record) => this.runScheduledOnce(record),
      onSkip: (record, reason) => this.postScheduleSkip(record, reason),
      onAutoPause: (record) => this.postScheduleAutoPause(record),
    });
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
    // Before anything else: reap this project's own orphaned claude CLIs from
    // a previous hard crash, so a leaked Chrome isn't still holding the
    // Browser Profile lock once a Task asks for it (issue #6).
    sweepOrphans();
    await this.store.load();
    await this.scheduleStore.load();
    this.validateWorkspace();

    this.client.once(Events.ClientReady, (client) => {
      console.log(`[bot] logged in as ${client.user.tag}`);
      console.log(`[bot] default workspace: ${this.config.defaultWorkspace}`);
      console.log(`[bot] allowed users: ${this.config.allowedUserIds.join(", ")}`);
      // Threads are only reachable once logged in, so the engine starts here.
      this.scheduler.start();
      console.log(`[bot] scheduler started with ${this.scheduleStore.all().length} schedule(s)`);
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isAutocomplete()) {
        void this.onSkillAutocomplete(interaction).catch((error: unknown) => {
          console.error("[bot] skill autocomplete failed:", error);
        });
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith(RERUN_BUTTON_PREFIX)) {
        void this.onRerunButton(interaction).catch((error: unknown) => {
          console.error("[bot] rerun button failed:", error);
        });
        return;
      }
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
    this.scheduler.stop();
    await Promise.allSettled([
      ...[...this.sessions.keys()].map((id) => this.closeSession(id)),
      ...[...this.transientSessions].map((session) => session.close()),
      ...[...this.scheduleRuns.values()].map((session) => session.close()),
    ]);
    this.transientSessions.clear();
    this.scheduleRuns.clear();
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
      case "schedule":
        await this.onSchedule(interaction);
        return;
      case "stop":
        await this.onStop(interaction);
        return;
      case "status":
        await this.onStatus(interaction);
        return;
      case "help":
        await this.onHelp(interaction);
        return;
      default:
        await interaction.reply({
          content: `ไม่รู้จักคำสั่ง ${interaction.commandName}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  /**
   * Answers each keystroke in a `skill` option with the live folder contents
   * (ADR 0005) — this is what makes a freshly dropped skill visible in
   * Discord with nothing to re-register.
   */
  private async onSkillAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "skill" || !this.isAllowed(interaction.user.id)) {
      await interaction.respond([]);
      return;
    }
    const query = focused.value.toLowerCase();
    const choices = listSkills(this.config.skillsDir)
      .filter(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query),
      )
      .slice(0, 25)
      .map((skill) => ({
        name: truncate(
          skill.description ? `${skill.name} — ${skill.description}` : skill.name,
          100,
        ),
        value: skill.name.slice(0, 100),
      }));
    await interaction.respond(choices);
  }

  /**
   * Reads and validates the `skill` option against the live folder. A miss
   * gets an ephemeral reply and `ok: false` — the folder may have changed
   * between typing and submitting.
   */
  private async resolveSkill(
    interaction: ChatInputCommandInteraction,
  ): Promise<{ ok: true; skill: string | null } | { ok: false }> {
    const skill = interaction.options.getString("skill");
    if (!skill) return { ok: true, skill: null };
    if (listSkills(this.config.skillsDir).some((entry) => entry.name === skill)) {
      return { ok: true, skill };
    }
    await interaction.reply({
      content: `ไม่พบสกิล \`${skill}\` ในโฟลเดอร์ skill แล้ว — เลือกใหม่จากช่อง skill หรือเช็คโฟลเดอร์บนเครื่อง host`,
      flags: MessageFlags.Ephemeral,
    });
    return { ok: false };
  }

  /**
   * (Re)builds the plugin scaffold from the skills folder, once per new
   * session — how a just-dropped skill reaches the next Task/Run without a
   * restart (ADR 0005). Returns the session-config fragment to spread in.
   * Skills must never take the bot down, so any scaffold failure just means
   * a session without skills.
   */
  private refreshSkillsPlugin(): { skillsPluginPath?: string } {
    try {
      const path = ensureSkillsPlugin(this.config.skillsDir, this.config.skillsPluginDir);
      return path ? { skillsPluginPath: path } : {};
    } catch (error) {
      console.error("[bot] skills plugin scaffold failed:", error);
      return {};
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
    // A schedule's thread belongs to its Runs; a Task must not take it over.
    if (interaction.channel?.isThread() && this.scheduleByThread(interaction.channel.id)) {
      await interaction.reply({
        content: "เธรดนี้เป็นของ schedule — สั่งรอบใหม่ด้วย `/schedule run` หรือเปิด `/task` ในห้องหลักแทน",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const prompt = interaction.options.getString("prompt", true);
    const workspace = this.resolveWorkspace(interaction.options.getString("path"));
    if ("error" in workspace) {
      await interaction.reply({ content: workspace.error, flags: MessageFlags.Ephemeral });
      return;
    }
    const model = interaction.options.getString("model") ?? this.config.defaultModel;
    const picked = await this.resolveSkill(interaction);
    if (!picked.ok) return;

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
        ...(picked.skill ? [`🧩 สกิล \`${picked.skill}\``] : []),
        "",
        "พิมพ์ในเธรดนี้เพื่อคุยต่อหรือสั่งเพิ่ม · `/stop` เพื่อสั่งหยุด",
      ].join("\n"),
    );

    const live = this.createSession(thread, record);
    await live.session.send(withSkill(prompt, picked.skill)).catch(async (error: unknown) => {
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
    const picked = await this.resolveSkill(interaction);
    if (!picked.ok) return;

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
        ...this.refreshSkillsPlugin(),
      },
      this.buildHooks({ reporter, channel: channel as Postable, record, persist: false }),
    );
    this.transientSessions.add(session);

    try {
      await session.send(withSkill(prompt, picked.skill));
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

  private async onHelp(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
      content: [
        "**วิธีใช้บอทเบื้องต้น**",
        "",
        "🧵 `/task prompt:…` — สั่งงานหลัก: บอทเปิดเธรดให้ (1 งาน = 1 เธรด) พิมพ์ในเธรดเพื่อคุยต่อ/สั่งเพิ่มได้เรื่อย ๆ — พิมพ์ระหว่างที่กำลังทำงาน = แทรกคำสั่ง บอทติด 👀 ให้",
        "❓ `/ask prompt:…` — คำถามสั้น ๆ ตอบในห้องเดิม ไม่เปิดเธรด ไม่เก็บบริบท อ่าน/ค้นได้อย่างเดียว แก้เครื่องไม่ได้",
        "⏰ `/schedule create prompt:… every:2h` (หรือ `at:08:00`) — งานรันซ้ำเองตามรอบ · จัดการด้วย `/schedule list | run | pause | resume | delete` — pause คือเบรกฉุกเฉิน กดได้ทุกคน",
        "🛑 `/stop` — หยุดงานในเธรดนั้น · 📊 `/status` — ดูงานที่กำลังรันทั้งหมด",
        "",
        "ตัวเลือกเสริมของ `/task` และ `/schedule create`:",
        "🧩 `skill:` เลือกสูตรงานสำเร็จรูป (พิมพ์เพื่อค้นหา · ไม่ระบุ = agent เลือกเอง) · 📂 `path:` โฟลเดอร์ทำงาน (ไม่ระบุ = workspace กลาง) · 🧠 `model:` โมเดล",
        "",
        "🔐 คำสั่งเสี่ยง (เช่น ลบไฟล์ หรือใช้ browser ครั้งแรกของงาน) จะขึ้นปุ่มขอ Approval ในเธรด — คนสั่งงานหรือ Operator เป็นคนกด ส่วน Schedule ไม่ถามตอนรัน: ใช้สิทธิ์ที่มอบไว้ตอนสร้างแทน (เช่น `browser:true`)",
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  // ---------------------------------------------------------------- schedules

  private scheduleByThread(threadId: string): ScheduleRecord | undefined {
    return this.scheduleStore.all().find((record) => record.threadId === threadId);
  }

  /** Owner and Operator manage a schedule; pause alone is open to every Member. */
  private canManageSchedule(record: ScheduleRecord, userId: string): boolean {
    return userId === record.ownerId || userId === this.config.operatorUserId;
  }

  private async onSchedule(interaction: ChatInputCommandInteraction): Promise<void> {
    switch (interaction.options.getSubcommand()) {
      case "create":
        await this.onScheduleCreate(interaction);
        return;
      case "list":
        await this.onScheduleList(interaction);
        return;
      case "pause":
        await this.onSchedulePause(interaction);
        return;
      case "resume":
        await this.onScheduleResume(interaction);
        return;
      case "delete":
        await this.onScheduleDelete(interaction);
        return;
      case "run":
        await this.onScheduleRun(interaction);
        return;
      default:
        await interaction.reply({ content: "ไม่รู้จักคำสั่งย่อยนี้", flags: MessageFlags.Ephemeral });
    }
  }

  private async onScheduleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
    const prompt = interaction.options.getString("prompt", true);
    const parsed = parseRecurrence({
      every: interaction.options.getString("every") ?? undefined,
      at: interaction.options.getString("at") ?? undefined,
      days: interaction.options.getString("days") ?? undefined,
    });
    if (!parsed.ok) {
      await interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });
      return;
    }
    const workspace = this.resolveWorkspace(interaction.options.getString("path"));
    if ("error" in workspace) {
      await interaction.reply({ content: workspace.error, flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = interaction.channel;
    if (channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) {
      await interaction.reply({
        content: "ตั้ง schedule ได้ในห้องข้อความหลักของเซิร์ฟเวอร์เท่านั้น (ไม่ใช่ในเธรด)",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const browserGrant = interaction.options.getBoolean("browser") ?? false;
    const model = interaction.options.getString("model") ?? this.config.defaultModel;
    const picked = await this.resolveSkill(interaction);
    if (!picked.ok) return;
    const now = new Date();
    const record: ScheduleRecord = {
      id: this.scheduleStore.newId(),
      ownerId: interaction.user.id,
      channelId: channel.id,
      threadId: "",
      // The skill instruction is baked into the stored prompt, so every later
      // Run carries it with no schema change and no extra lookup.
      prompt: withSkill(prompt, picked.skill),
      workspace: workspace.path,
      model,
      recurrence: parsed.recurrence,
      browserGrant,
      paused: false,
      consecutiveFailures: 0,
      createdAt: now.toISOString(),
      nextRunAt: nextFireAt(parsed.recurrence, now, now).toISOString(),
    };

    await interaction.reply(`⏰ ตั้งเวลา: ${truncate(prompt, 150)}`);
    const anchor = await interaction.fetchReply();
    const thread = await anchor.startThread({
      name: truncate(`⏰ ${prompt.replace(/\s+/g, " ")}`, 90),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
    record.threadId = thread.id;
    await this.scheduleStore.put(record);

    await thread.send(
      [
        `⏰ **Schedule ใหม่** โดย <@${record.ownerId}> · id \`${record.id}\``,
        `🔁 ${describeRecurrence(record.recurrence)} · รอบแรก ${formatLocal(record.nextRunAt)}`,
        `📂 \`${record.workspace}\``,
        `🧠 \`${record.model}\``,
        ...(picked.skill ? [`🧩 สกิล \`${picked.skill}\``] : []),
        browserGrant
          ? "🌐 ได้สิทธิ์ browser — รอบอัตโนมัติใช้บัญชีที่ล็อกอินค้างได้โดยไม่ถามใคร (ADR 0004)"
          : "🚫 ไม่ได้สิทธิ์ browser",
        "",
        `ทุกรอบรันในเธรดนี้ · หยุดฉุกเฉินได้ทุกคนด้วย \`/schedule pause id:${record.id}\``,
      ].join("\n"),
    );
  }

  private async onScheduleList(interaction: ChatInputCommandInteraction): Promise<void> {
    const records = this.scheduleStore.all();
    if (records.length === 0) {
      await interaction.reply({ content: "ยังไม่มี schedule", flags: MessageFlags.Ephemeral });
      return;
    }
    const lines = records.map((record) => {
      const state = record.paused ? "⏸️" : this.scheduler.isRunning(record.id) ? "🟢" : "⚪";
      const browser = record.browserGrant ? " · 🌐" : "";
      const next = record.paused ? "หยุดอยู่" : `ถัดไป ${formatLocal(record.nextRunAt)}`;
      return `${state} \`${record.id}\` ${describeRecurrence(record.recurrence)} · ${next} · <#${record.threadId}> · <@${record.ownerId}>${browser}`;
    });
    await interaction.reply({
      content: [`**Schedule ทั้งหมด ${records.length} รายการ**`, ...lines].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * Resolves a schedule id and, for `manage` actions, checks the caller's
   * rights — replying with the reason and returning undefined on either miss.
   * `pause` deliberately skips the ownership check: the emergency brake is
   * everyone's (ADR 0004).
   */
  private async requireSchedule(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    id: string,
    action: "manage" | "pause",
  ): Promise<ScheduleRecord | undefined> {
    const record = this.scheduleStore.get(id.trim());
    if (!record) {
      await interaction.reply({
        content: "ไม่พบ schedule ตาม id นี้ — ดู `/schedule list`",
        flags: MessageFlags.Ephemeral,
      });
      return undefined;
    }
    if (action === "manage" && !this.canManageSchedule(record, interaction.user.id)) {
      await interaction.reply({
        content: "จัดการ schedule นี้ได้เฉพาะเจ้าของกับ operator (ยกเว้น pause ที่กดได้ทุกคน)",
        flags: MessageFlags.Ephemeral,
      });
      return undefined;
    }
    return record;
  }

  /** Shared by `/schedule run` and the rerun button. */
  private async fireAndReply(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    record: ScheduleRecord,
  ): Promise<void> {
    const result = await this.scheduler.fireNow(record.id);
    if (!result.started) {
      await interaction.reply({
        content: `รันไม่ได้: ${result.reason ?? "ไม่ทราบสาเหตุ"}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply(
      `▶️ <@${interaction.user.id}> สั่งรัน \`${record.id}\` 1 รอบ — ตามผลได้ใน <#${record.threadId}>`,
    );
  }

  private async onSchedulePause(interaction: ChatInputCommandInteraction): Promise<void> {
    const record = await this.requireSchedule(
      interaction,
      interaction.options.getString("id", true),
      "pause",
    );
    if (!record) return;
    record.paused = true;
    await this.scheduleStore.put(record);
    await interaction.reply(
      `⏸️ <@${interaction.user.id}> หยุด schedule \`${record.id}\` แล้ว — ปลุกกลับด้วย \`/schedule resume id:${record.id}\``,
    );
  }

  private async onScheduleResume(interaction: ChatInputCommandInteraction): Promise<void> {
    const record = await this.requireSchedule(
      interaction,
      interaction.options.getString("id", true),
      "manage",
    );
    if (!record) return;
    record.paused = false;
    record.consecutiveFailures = 0;
    const now = new Date();
    record.nextRunAt = nextFireAt(record.recurrence, now, new Date(record.createdAt)).toISOString();
    await this.scheduleStore.put(record);
    await interaction.reply(
      `▶️ schedule \`${record.id}\` กลับมาทำงานแล้ว — รอบถัดไป ${formatLocal(record.nextRunAt)}`,
    );
  }

  private async onScheduleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
    const record = await this.requireSchedule(
      interaction,
      interaction.options.getString("id", true),
      "manage",
    );
    if (!record) return;
    await this.scheduleStore.delete(record.id);
    await interaction.reply(
      `🗑️ ลบ schedule \`${record.id}\` แล้ว (เธรด <#${record.threadId}> และประวัติยังอยู่)`,
    );
  }

  private async onScheduleRun(interaction: ChatInputCommandInteraction): Promise<void> {
    const record = await this.requireSchedule(
      interaction,
      interaction.options.getString("id", true),
      "manage",
    );
    if (!record) return;
    await this.fireAndReply(interaction, record);
  }

  private async onRerunButton(interaction: ButtonInteraction): Promise<void> {
    if (!this.isAllowed(interaction.user.id)) {
      await interaction.reply({
        content: "บอทนี้จำกัดเฉพาะทีมภายใน",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const id = interaction.customId.slice(RERUN_BUTTON_PREFIX.length);
    const record = await this.requireSchedule(interaction, id, "manage");
    if (!record) return;
    await this.fireAndReply(interaction, record);
  }

  /** The schedule's permanent thread, recreated in its channel if it was deleted. */
  private async fetchScheduleThread(record: ScheduleRecord): Promise<ThreadChannel> {
    const existing = await this.client.channels.fetch(record.threadId).catch(() => null);
    if (existing?.isThread()) return existing;

    const parent = await this.client.channels.fetch(record.channelId).catch(() => null);
    if (
      !parent ||
      (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildAnnouncement)
    ) {
      throw new Error(`schedule ${record.id}: both its thread and its channel are gone`);
    }
    const anchor = await (parent as TextChannel).send(
      `⏰ ${truncate(record.prompt, 150)} (สร้างเธรดใหม่แทนอันเดิมที่ถูกลบ)`,
    );
    const thread = await anchor.startThread({
      name: truncate(`⏰ ${record.prompt.replace(/\s+/g, " ")}`, 90),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });
    record.threadId = thread.id;
    await this.scheduleStore.put(record);
    return thread;
  }

  private rerunButtonRow(scheduleId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${RERUN_BUTTON_PREFIX}${scheduleId}`)
        .setLabel("▶️ รันรอบนี้ใหม่")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private async postScheduleSkip(record: ScheduleRecord, reason: string): Promise<void> {
    try {
      const thread = await this.fetchScheduleThread(record);
      await thread.send({
        content: `⏭️ ${reason}`,
        components: [this.rerunButtonRow(record.id)],
      });
    } catch (error) {
      console.error(`[bot] could not post skip for schedule ${record.id}:`, error);
    }
  }

  private async postScheduleAutoPause(record: ScheduleRecord): Promise<void> {
    try {
      const thread = await this.fetchScheduleThread(record);
      await thread.send(
        [
          `⏸️ <@${record.ownerId}> schedule \`${record.id}\` **หยุดตัวเองแล้ว** — ล้มเหลว ${MAX_CONSECUTIVE_FAILURES} รอบติด`,
          `เช็คสาเหตุจากรอบล่าสุดข้างบน แก้แล้วสั่ง \`/schedule resume id:${record.id}\``,
        ].join("\n"),
      );
    } catch (error) {
      console.error(`[bot] could not post auto-pause for schedule ${record.id}:`, error);
    }
  }

  /**
   * One Run: a fresh Agent Session that carries nothing over from earlier
   * rounds (ADR 0004 — cross-run memory belongs to the prompt and workspace
   * files). No approval path exists here: the grant decides, or it's a deny.
   */
  private async runScheduledOnce(record: ScheduleRecord): Promise<RunOutcome> {
    const requester = `schedule:${record.id}`;
    let thread: ThreadChannel;
    try {
      thread = await this.fetchScheduleThread(record);
    } catch (error) {
      console.error(`[bot] schedule ${record.id} has nowhere to run:`, error);
      return "failure";
    }

    const reporter = new ThreadReporter(thread);
    await reporter.say(`▶️ **เริ่มรอบใหม่** · ${formatLocal(new Date().toISOString())}`);

    let ok = false;
    // Set when the round gave up waiting for the browser at its deadline —
    // the agent still ends its turn gracefully, but the round is a failure.
    let browserDeadlineHit = false;
    const session = new AgentSession(
      {
        workspace: record.workspace,
        model: record.model,
        oauthToken: this.config.oauthToken,
        ...this.refreshSkillsPlugin(),
        ...(record.browserGrant
          ? {
              browserServer: {
                type: "stdio",
                command: process.execPath,
                args: playwrightMcpArgs({
                  profileDir: this.config.browserProfileDir,
                  outputDir: join(record.workspace, ".browser-output"),
                }),
              },
            }
          : {}),
      },
      {
        onText: (text) => reporter.say(text),
        onActivity: (line) => reporter.addActivity(line),
        onHeadline: (headline) => reporter.setHeadline(headline),
        onSessionId: () => undefined,
        decide: async (toolName, input, { signal }) => {
          if (!isBrowserTool(toolName)) return decideScheduled(toolName, input, record.workspace);
          const decision = decideScheduledBrowser(toolName, { granted: record.browserGrant });
          if (decision.action !== "allow") return decision;
          // Stand in the Browser queue, at most until this schedule's own
          // next round (ADR 0006). The deadline backs off a little before the
          // slot so the losing round finishes its wrap-up turn before the new
          // round's tick — on the slot itself the new round would be skipped
          // as "รอบก่อนยังทำไม่เสร็จ". It also keeps a wrap-up retry bounded:
          // the recomputed deadline is already past, denying it again. A next
          // slot already in the past (manual fire of a paused schedule) means
          // no competing round is coming, so no deadline then.
          const nextAt = new Date(record.nextRunAt).getTime();
          const outcome = await this.waitForBrowser({
            requester,
            reporter,
            signal,
            ...(nextAt > Date.now() ? { deadlineAt: nextAt - SCHEDULE_DEADLINE_GRACE_MS } : {}),
          });
          if (outcome === "acquired") return decision;
          if (outcome === "deadline") {
            browserDeadlineHit = true;
            return {
              action: "deny",
              reason:
                "รอคิว browser ไม่ทันเวลารอบถัดไปของ schedule นี้ — จบรอบนี้โดยรายงานสั้น ๆ " +
                "ว่ารอ browser ไม่ทัน อย่าตั้งเวลาลองใหม่เอง รอบหน้าจะเริ่มใหม่ตามตารางอยู่แล้ว",
            };
          }
          return { action: "deny", reason: BROWSER_WAIT_CANCELLED };
        },
        onApprovalNeeded: async () => ({
          behavior: "deny",
          message:
            "scheduled run ไม่มีคนอนุมัติ — การกระทำนี้อยู่นอก grant ของ schedule ทำต่อด้วยวิธีอื่นหรือรายงานแทน",
        }),
        onSendFile: (buffer, filename, caption) => reporter.attach(buffer, filename, caption),
        onTurnEnd: async (summary) => {
          ok = summary.ok;
          await reporter.clearStatus();
          await reporter.say(formatSummary(summary));
        },
        onFatal: async (error) => {
          ok = false;
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`[bot] scheduled run ${record.id} died:`, error);
          await reporter.clearStatus();
          await reporter.say(`❌ รอบนี้ล้มเหลว: ${truncate(detail, 1500)}`);
        },
      },
    );
    this.scheduleRuns.set(record.id, session);

    try {
      await session.send(record.prompt);
    } catch (error) {
      ok = false;
      console.error(`[bot] scheduled run ${record.id} failed:`, error);
      await reporter.clearStatus();
    } finally {
      this.scheduleRuns.delete(record.id);
      this.releaseBrowser(requester);
      await session.close();
    }
    return ok && !browserDeadlineHit ? "success" : "failure";
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
        ...this.refreshSkillsPlugin(),
        ...(record.sessionId ? { resumeSessionId: record.sessionId } : {}),
        // Headed Chrome on a shared persistent profile (ADR 0003). Screenshots
        // and downloads land in .browser-output/ inside the workspace — MCP's
        // auto artifacts (page-*.yml, console-*.log) stay out of the work files.
        browserServer: {
          type: "stdio",
          command: process.execPath,
          args: playwrightMcpArgs({
            profileDir: this.config.browserProfileDir,
            outputDir: join(record.workspace, ".browser-output"),
          }),
        },
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
      decide: async (toolName, input, { signal }) => {
        if (!isBrowserTool(toolName)) return decide(toolName, input, this.config.extraBashAllow);
        const decision = decideBrowser(toolName, {
          // BROWSER_AUTO_APPROVE (ADR 0008): the Operator pre-granted the
          // once-per-Task browser Approval; the always-ask tools still ask.
          approved:
            this.browserApproved.has(record.threadId) || this.config.browserAutoApprove,
        });
        if (decision.action !== "allow") return decision;
        // An approved task stands in the Browser queue inside this pending
        // tool call — no deadline; the humans in the thread are the timeout.
        const outcome = await this.waitForBrowser({
          requester: record.threadId,
          reporter,
          signal,
        });
        return outcome === "acquired"
          ? decision
          : { action: "deny", reason: BROWSER_WAIT_CANCELLED };
      },
      onApprovalNeeded: async (request) => {
        reporter.addActivity(`ขออนุมัติ ${request.toolName} ${describeTool(request.toolName, request.input)}`);
        const result = await requestApproval({
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
        if (isBrowserTool(request.toolName) && result.behavior === "allow") {
          // The human said yes; the browser may still be busy, so the freshly
          // approved call stands in the Browser queue like any other.
          const outcome = await this.waitForBrowser({
            requester: record.threadId,
            reporter,
            signal: request.signal,
          });
          if (outcome !== "acquired") {
            return { behavior: "deny", message: BROWSER_WAIT_CANCELLED };
          }
          this.browserApproved.add(record.threadId);
        }
        return result;
      },
      onSendFile: async (buffer, filename, caption) => {
        await reporter.attach(buffer, filename, caption);
      },
      onTurnEnd: async (summary) => {
        // The agent closes its browser window before the turn ends, so the
        // whole-bot lock frees here; the task's approval stays for follow-ups.
        this.releaseBrowser(record.threadId);
        await reporter.clearStatus();
        await reporter.say(formatSummary(summary));
      },
      onFatal: async (error, wasResuming) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[bot] session died (resuming=${wasResuming}):`, error);
        this.sessions.delete(record.threadId);
        this.releaseBrowser(record.threadId);
        this.browserApproved.delete(record.threadId);
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
    this.releaseBrowser(threadId);
    this.browserApproved.delete(threadId);
    await live.reporter.clearStatus();
    await live.session.close();
  }

  /**
   * Stands in the Browser queue inside a pending tool call (ADR 0006). The
   * thread sees who holds the browser and this waiter's place in line; the
   * abort signal (tool call cancelled, session closed) resolves "cancelled".
   */
  private async waitForBrowser(options: {
    requester: string;
    reporter: ThreadReporter;
    signal: AbortSignal;
    deadlineAt?: number;
  }): Promise<AcquireOutcome> {
    let waited = false;
    const outcome = await this.browserQueue.acquire(options.requester, {
      signal: options.signal,
      ...(options.deadlineAt !== undefined ? { deadlineAt: options.deadlineAt } : {}),
      onWait: (position, holder) => {
        waited = true;
        options.reporter.setHeadline(
          `รอ browser ว่าง — ถือโดย ${describeHolder(holder)} (คิวที่ ${position})`,
        );
      },
    });
    if (outcome === "acquired" && waited) options.reporter.setHeadline("ได้คิว browser แล้ว");
    return outcome;
  }

  /** Lets go of the browser (and any place in line); the next in line proceeds. */
  private releaseBrowser(requester: string): void {
    this.browserQueue.cancelWaiting(requester);
    this.browserQueue.release(requester);
  }
}

/** The browser holder is a task's thread id or `schedule:<id>` — render readably. */
function describeHolder(holder: string): string {
  return /^\d+$/.test(holder) ? `<#${holder}>` : `\`${holder}\``;
}

function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function formatSummary(summary: TurnSummary): string {
  const seconds = (summary.durationMs / 1000).toFixed(1);
  if (!summary.ok) {
    const detail = summary.errors?.join("; ") ?? "ไม่ทราบสาเหตุ";
    return `⚠️ จบแบบมีปัญหา (${seconds}s): ${truncate(detail, 1500)}`;
  }
  return `-# ✅ เสร็จใน ${seconds}s · ${summary.turns} turns`;
}
