/**
 * `npm run workspace:init` — scaffold the content-pipeline workspace (ADR 0007)
 * at DEFAULT_WORKSPACE, from templates/marketing-workspace/.
 *
 * Safe to re-run: existing files are never overwritten (missing ones are
 * filled in), so it also repairs a half-created workspace. Reads env directly
 * instead of loadConfig() so it works before the Discord side of .env is
 * filled in (and so an UNSET var errors instead of silently scaffolding into
 * the homedir fallback loadConfig would apply) — same stance as doctor.ts.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expandPath } from "./config.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE_ROOT = join(REPO_ROOT, "templates", "marketing-workspace");
/** Folders the pipeline writes into — empty at scaffold time, so not in templates. */
const EMPTY_DIRS = ["trends", "drafts/assets", "calendar", "archive"];

async function listTemplateFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listTemplateFiles(path)));
    else out.push(path);
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function main(): Promise<void> {
  const raw = process.env.DEFAULT_WORKSPACE?.trim();
  if (!raw) {
    console.error(
      "❌ ยังไม่ได้ตั้ง DEFAULT_WORKSPACE ใน .env\n" +
        '   เพิ่มบรรทัดเช่น  DEFAULT_WORKSPACE=~/Desktop/marketing-workspace  แล้วรันใหม่\n' +
        "   (โฟลเดอร์นี้เป็นทั้ง workspace เริ่มต้นของบอท และที่อยู่ของ content pipeline)",
    );
    process.exit(1);
  }

  const target = expandPath(raw);
  const insideRepo = !relative(REPO_ROOT, target).startsWith("..");
  if (insideRepo) {
    console.error(
      `❌ DEFAULT_WORKSPACE (${target}) อยู่ใน repo ของบอท — ต้องเป็นโฟลเดอร์นอก repo เสมอ\n` +
        "   workspace คือเขตที่ scheduled run เขียนไฟล์ได้อัตโนมัติ ชี้เข้า repo = เปิดทางแก้ skills/ กับโค้ดบอทเอง (ADR 0007)",
    );
    process.exit(1);
  }

  // Path shown inside README's example commands — prefer ~ form for portability.
  const home = homedir();
  const displayPath =
    target === home || target.startsWith(home + sep)
      ? "~" + target.slice(home.length)
      : target;

  console.log(`สร้าง workspace ที่ ${target}\n`);
  let created = 0;
  let skipped = 0;

  for (const templateFile of (await listTemplateFiles(TEMPLATE_ROOT)).sort()) {
    const rel = relative(TEMPLATE_ROOT, templateFile);
    const dest = join(target, rel);
    if (await exists(dest)) {
      console.log(`⏭️  ${rel} — มีอยู่แล้ว ไม่แตะ`);
      skipped += 1;
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    const content = (await readFile(templateFile, "utf8")).replaceAll(
      "{{WORKSPACE_PATH}}",
      displayPath,
    );
    await writeFile(dest, content, "utf8");
    console.log(`✅ ${rel}`);
    created += 1;
  }

  for (const dir of EMPTY_DIRS) {
    await mkdir(join(target, dir), { recursive: true });
  }

  console.log(`\nเสร็จ: สร้างใหม่ ${created} ไฟล์, มีอยู่แล้ว ${skipped} ไฟล์`);
  console.log(`\nขั้นต่อไป (รายละเอียดใน ${displayPath}/README.md):`);
  console.log("  1. เติมไฟล์ใน brand/ กับ config/pipeline.md แล้วเปลี่ยน status: unfilled → ready");
  console.log("  2. npm run browser:login  — ล็อกอิน Facebook + เว็บ gen รูป (แล้วปิดหน้าต่าง)");
  console.log("  3. สร้าง Schedule 4 อันในห้องหลักของ Discord เช่น:");
  console.log(
    '     /schedule create prompt:"ส่องเทรนด์ประจำวัน" skill:trend-scout at:08:00',
  );
  console.log(
    '     /schedule create prompt:"โพสต์ตามปฏิทิน" skill:fb-publisher at:09:30,13:30,19:30',
  );
  console.log(
    "     (ไม่ต้องใส่ path: — โฟลเดอร์นี้คือ DEFAULT_WORKSPACE ของบอทอยู่แล้ว)",
  );
}

main().catch((error) => {
  console.error("❌ ล้มเหลว:", error instanceof Error ? error.message : error);
  process.exit(1);
});
