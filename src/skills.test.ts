/**
 * Run with: npx tsx src/skills.test.ts
 * Asserts the Skill folder scan and the plugin scaffold the SDK loads it
 * through (ADR 0005) — the parts that decide what instructions reach every
 * Agent Session.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureSkillsPlugin, listSkills, withSkill } from "./skills.js";

let failures = 0;

function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "skills-test-"));
}

function writeSkill(skillsDir: string, dirName: string, skillMd: string): void {
  mkdirSync(join(skillsDir, dirName), { recursive: true });
  writeFileSync(join(skillsDir, dirName, "SKILL.md"), skillMd);
}

const roots: string[] = [];
function tempRoot(): string {
  const root = makeTempDir();
  roots.push(root);
  return root;
}

console.log("listSkills");

check("missing folder means no skills, not an error", () => {
  assert.deepEqual(listSkills(join(tempRoot(), "does-not-exist")), []);
});

check("empty folder means no skills", () => {
  assert.deepEqual(listSkills(tempRoot()), []);
});

check("reads name and description from frontmatter", () => {
  const dir = tempRoot();
  writeSkill(
    dir,
    "make-image",
    "---\nname: make-image\ndescription: สร้างรูปด้วยเว็บ image gen\n---\n\nSteps here.\n",
  );
  assert.deepEqual(listSkills(dir), [
    { name: "make-image", description: "สร้างรูปด้วยเว็บ image gen" },
  ]);
});

check("falls back to the folder name when frontmatter has no name", () => {
  const dir = tempRoot();
  writeSkill(dir, "summarize", "---\ndescription: สรุปรายงาน\n---\nBody\n");
  assert.deepEqual(listSkills(dir), [{ name: "summarize", description: "สรุปรายงาน" }]);
});

check("survives a SKILL.md with no frontmatter at all", () => {
  const dir = tempRoot();
  writeSkill(dir, "bare", "Just instructions, no frontmatter.\n");
  assert.deepEqual(listSkills(dir), [{ name: "bare", description: "" }]);
});

check("ignores loose files and folders without SKILL.md", () => {
  const dir = tempRoot();
  writeFileSync(join(dir, "README.md"), "not a skill");
  mkdirSync(join(dir, "no-skill-here"));
  writeSkill(dir, "real", "---\nname: real\ndescription: ของจริง\n---\n");
  assert.deepEqual(
    listSkills(dir).map((skill) => skill.name),
    ["real"],
  );
});

check("sorts skills by name", () => {
  const dir = tempRoot();
  writeSkill(dir, "zebra", "---\ndescription: z\n---\n");
  writeSkill(dir, "apple", "---\ndescription: a\n---\n");
  assert.deepEqual(
    listSkills(dir).map((skill) => skill.name),
    ["apple", "zebra"],
  );
});

console.log("ensureSkillsPlugin");

check("no skills means no plugin — the SDK gets nothing to load", () => {
  const root = tempRoot();
  const skillsDir = join(root, "skills");
  const pluginDir = join(root, "plugin");
  mkdirSync(skillsDir);
  assert.equal(ensureSkillsPlugin(skillsDir, pluginDir), undefined);
  assert.equal(existsSync(pluginDir), false);
});

check("builds the scaffold the SDK expects: manifest plus skills symlink", () => {
  const root = tempRoot();
  const skillsDir = join(root, "skills");
  const pluginDir = join(root, "plugin");
  writeSkill(skillsDir, "make-image", "---\ndescription: d\n---\n");

  assert.equal(ensureSkillsPlugin(skillsDir, pluginDir), pluginDir);

  const manifest = JSON.parse(
    readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"),
  ) as { name: string };
  assert.equal(typeof manifest.name, "string");
  assert.ok(manifest.name.length > 0);

  const link = join(pluginDir, "skills");
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.equal(readlinkSync(link), resolve(skillsDir));
  // The SDK will read through the link — prove the skills are visible there.
  assert.deepEqual(
    listSkills(link).map((skill) => skill.name),
    ["make-image"],
  );
});

check("is idempotent and re-points the link when the skills folder moves", () => {
  const root = tempRoot();
  const oldSkills = join(root, "old-skills");
  const newSkills = join(root, "new-skills");
  const pluginDir = join(root, "plugin");
  writeSkill(oldSkills, "a", "---\ndescription: a\n---\n");
  writeSkill(newSkills, "b", "---\ndescription: b\n---\n");

  assert.equal(ensureSkillsPlugin(oldSkills, pluginDir), pluginDir);
  assert.equal(ensureSkillsPlugin(oldSkills, pluginDir), pluginDir);
  assert.equal(ensureSkillsPlugin(newSkills, pluginDir), pluginDir);
  assert.equal(readlinkSync(join(pluginDir, "skills")), resolve(newSkills));
});

console.log("withSkill");

check("prefixes the prompt with an instruction naming the skill", () => {
  const composed = withSkill("วาดแมวอวกาศ", "make-image");
  assert.ok(composed.includes("make-image"));
  assert.ok(composed.endsWith("วาดแมวอวกาศ"));
  assert.ok(composed.length > "วาดแมวอวกาศ".length);
});

check("passes the prompt through untouched when no skill was picked", () => {
  assert.equal(withSkill("วาดแมวอวกาศ", null), "วาดแมวอวกาศ");
});

for (const root of roots) {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall skills tests passed");
