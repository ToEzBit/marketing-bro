import {
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

export const MODEL_CHOICES = [
  { name: "Sonnet (เร็ว ประหยัดโควต้า)", value: "sonnet" },
  { name: "Opus (ฉลาดสุด ใช้โควต้าเยอะ)", value: "opus" },
  { name: "Haiku (เบาสุด)", value: "haiku" },
] as const;

export function buildCommands(): RESTPostAPIApplicationCommandsJSONBody[] {
  const task = new SlashCommandBuilder()
    .setName("task")
    .setDescription("เริ่มงานใหม่ให้ Claude ทำบนเครื่อง host (เปิด thread ให้คุยต่อ)")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("สิ่งที่ต้องการให้ทำ")
        .setRequired(true)
        .setMaxLength(1800),
    )
    .addStringOption((option) =>
      option
        .setName("path")
        .setDescription("โฟลเดอร์ที่จะทำงาน (ไม่ระบุ = workspace เริ่มต้น)")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("model")
        .setDescription("โมเดลที่ใช้")
        .setRequired(false)
        .addChoices(...MODEL_CHOICES),
    );

  const ask = new SlashCommandBuilder()
    .setName("ask")
    .setDescription("ถามคำถามสั้น ๆ ตอบในห้องนี้ ไม่เปิด thread")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("คำถาม")
        .setRequired(true)
        .setMaxLength(1800),
    );

  const stop = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("สั่งหยุดงานที่กำลังรันอยู่ใน thread นี้");

  const status = new SlashCommandBuilder()
    .setName("status")
    .setDescription("ดูสถานะบอทและงานที่กำลังรัน");

  return [task, ask, stop, status].map((command) => command.toJSON());
}

export async function registerCommands(options: {
  token: string;
  appId: string;
  guildId: string;
}): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(options.token);
  const body = buildCommands();
  const route = options.guildId
    ? Routes.applicationGuildCommands(options.appId, options.guildId)
    : Routes.applicationCommands(options.appId);
  await rest.put(route, { body });
}
