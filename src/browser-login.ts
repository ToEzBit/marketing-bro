/**
 * Opens the agent's Chrome profile for a human: run `npm run browser:login`,
 * sign in to the sites the agent should use (image-gen site, Facebook, …),
 * then close the window. Every later task reuses those sessions.
 *
 * One profile allows one Chrome — don't run this while a bot task is using
 * the browser.
 */
import { config as loadEnv } from "dotenv";
import { openProfileForLogin } from "./browser.js";
import { expandPath } from "./config.js";

loadEnv();

const profileDir = expandPath(process.env.BROWSER_PROFILE_DIR ?? "./.state/browser-profile");

console.log(`เปิด Chrome ด้วย profile ของบอท: ${profileDir}`);
console.log("ล็อกอินเว็บที่ต้องการให้ Agent ใช้ เสร็จแล้วปิดหน้าต่างได้เลย");

let context;
try {
  context = await openProfileForLogin(profileDir);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    detail.includes("ProcessSingleton")
      ? "เปิดไม่ได้: profile นี้ถูกใช้อยู่โดย browser ของบอท — ปิดงานที่ใช้ browser ก่อนแล้วลองใหม่"
      : `เปิด Chrome ไม่สำเร็จ: ${detail}`,
  );
  process.exit(1);
}

const page = context.pages()[0] ?? (await context.newPage());
await page.goto("about:blank").catch(() => undefined);

// Cookies are flushed when Chrome shuts down, so wait for the human to close
// the window rather than exiting while the window is still open.
await context.waitForEvent("close", { timeout: 0 });
console.log("ปิด browser แล้ว — session ถูกบันทึกลง profile เรียบร้อย");
