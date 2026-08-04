import {
  REST,
  Routes,
  SlashCommandBuilder,
  type SlashCommandStringOption,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

export const MODEL_CHOICES = [
  { name: "Sonnet (เร็ว ประหยัดโควต้า)", value: "sonnet" },
  { name: "Opus (ฉลาดสุด ใช้โควต้าเยอะ)", value: "opus" },
  { name: "Haiku (เบาสุด)", value: "haiku" },
] as const;

/**
 * The Skill picker (ADR 0005). Autocomplete, not fixed choices: the bot
 * answers each keystroke by reading the skills folder live, so a freshly
 * dropped skill shows up without re-registering anything with Discord.
 */
function skillOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName("skill")
    .setDescription("สกิลที่ให้ใช้ทำงานนี้ (พิมพ์เพื่อค้นหา — ไม่ระบุ = agent เลือกเองตามงาน)")
    .setRequired(false)
    .setAutocomplete(true);
}

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
    )
    .addStringOption(skillOption);

  const ask = new SlashCommandBuilder()
    .setName("ask")
    .setDescription("ถามคำถามสั้น ๆ ตอบในห้องนี้ ไม่เปิด thread")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("คำถาม")
        .setRequired(true)
        .setMaxLength(1800),
    )
    .addStringOption(skillOption);

  const schedule = new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("งานตั้งเวลา — รันซ้ำเองตามรอบโดยไม่ต้องมีคนสั่ง (ADR 0004)")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("ตั้งงานใหม่ให้รันซ้ำตามรอบเวลา")
        .addStringOption((option) =>
          option
            .setName("prompt")
            .setDescription("สิ่งที่ให้ทำทุกรอบ")
            .setRequired(true)
            .setMaxLength(1800),
        )
        .addStringOption((option) =>
          option
            .setName("every")
            .setDescription("รอบเวลา เช่น 30m, 2h หรือ 3d (เป็นวันต้องใส่ at ด้วย)"),
        )
        .addStringOption((option) =>
          option
            .setName("at")
            .setDescription("เวลายิงแบบ 24 ชม. เช่น 08:00 (ใส่เดี่ยว ๆ = ทุกวัน)"),
        )
        .addStringOption((option) =>
          option
            .setName("days")
            .setDescription("วันในสัปดาห์ เช่น mon,wed,fri (ต้องใส่ at ด้วย)"),
        )
        .addStringOption((option) =>
          option
            .setName("path")
            .setDescription("โฟลเดอร์ที่จะทำงาน (ไม่ระบุ = workspace เริ่มต้น)"),
        )
        .addStringOption((option) =>
          option.setName("model").setDescription("โมเดลที่ใช้").addChoices(...MODEL_CHOICES),
        )
        .addBooleanOption((option) =>
          option
            .setName("browser")
            .setDescription("มอบสิทธิ์ใช้ browser (บัญชีที่ล็อกอินค้าง) ให้งานนี้ตอนรันอัตโนมัติ"),
        )
        .addStringOption(skillOption),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("ดู schedule ทั้งหมด"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("pause")
        .setDescription("หยุด schedule ชั่วคราว (สมาชิกทุกคนกดได้ — เบรกฉุกเฉิน)")
        .addStringOption((option) =>
          option.setName("id").setDescription("id จาก /schedule list").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("resume")
        .setDescription("ปลุก schedule ที่หยุดไว้ให้กลับมารันตามรอบ")
        .addStringOption((option) =>
          option.setName("id").setDescription("id จาก /schedule list").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("ลบ schedule ถาวร (เธรดและประวัติยังอยู่)")
        .addStringOption((option) =>
          option.setName("id").setDescription("id จาก /schedule list").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("run")
        .setDescription("สั่งรันเดี๋ยวนี้ 1 รอบ นอกรอบเวลาปกติ")
        .addStringOption((option) =>
          option.setName("id").setDescription("id จาก /schedule list").setRequired(true),
        ),
    );

  const stop = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("สั่งหยุดงานที่กำลังรันอยู่ใน thread นี้");

  const status = new SlashCommandBuilder()
    .setName("status")
    .setDescription("ดูสถานะบอทและงานที่กำลังรัน");

  const help = new SlashCommandBuilder()
    .setName("help")
    .setDescription("วิธีใช้บอทเบื้องต้น — มีคำสั่งอะไร ใช้ยังไง");

  return [task, ask, schedule, stop, status, help].map((command) => command.toJSON());
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
