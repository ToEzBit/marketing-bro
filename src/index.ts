import { Bot } from "./bot.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = new Bot(config);

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[bot] received ${signal}`);
    void bot.shutdown().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  await bot.start();
}

/**
 * Discord's startup failures are terse ("Used disallowed intents") and name
 * neither the cause nor the fix. Translate the ones a first-time setup hits.
 */
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/disallowed intents/i.test(message)) {
    return [
      "Discord ปฏิเสธเพราะยังไม่ได้เปิด privileged intent",
      "",
      "บอทต้องอ่านข้อความในเธรดเพื่อให้คุณคุยต่อได้ จึงต้องเปิด MESSAGE CONTENT INTENT:",
      "  1. https://discord.com/developers/applications → เลือก application",
      "  2. แท็บ Bot → หัวข้อ Privileged Gateway Intents",
      "  3. เปิด MESSAGE CONTENT INTENT แล้วกด Save Changes",
      "  (PRESENCE และ SERVER MEMBERS INTENT ไม่ต้องเปิด)",
      "",
      "แล้วรันใหม่",
    ].join("\n");
  }

  if (/401|unauthorized|invalid token|TokenInvalid/i.test(message)) {
    return [
      "Discord ปฏิเสธ DISCORD_TOKEN",
      "",
      "ค่านี้ต้องเป็น bot token จากแท็บ Bot (ยาว ~70 ตัวอักษร มีจุดคั่น 2 จุด)",
      "ไม่ใช่ Application ID, Public Key (64 ตัว hex) หรือ Client Secret",
      "ขอใหม่ที่: แท็บ Bot → Reset Token → Copy",
    ].join("\n");
  }

  return message;
}

main().catch((error: unknown) => {
  console.error(`\n❌ ${explain(error)}\n`);
  process.exit(1);
});
