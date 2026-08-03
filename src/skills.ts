/**
 * The bot's central Skill folder (ADR 0005): Claude-Code-standard skill
 * folders (`<skillsDir>/<name>/SKILL.md`) that the Operator drops onto the
 * host. Every Agent Session loads the same set, via a generated plugin
 * scaffold, because the SDK's `plugins` option is the only loading path that
 * is independent of the per-Task workspace cwd.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export type SkillInfo = {
  name: string;
  description: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Pulls one `key: value` line out of a frontmatter block. */
function frontmatterField(block: string, key: string): string {
  const match = block.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

/**
 * Skills found in the folder, sorted by name. A skill is any subfolder with a
 * SKILL.md; the frontmatter `name` wins, the folder name is the fallback. A
 * missing or empty folder is a normal state, not an error — the bot simply
 * has no skills yet.
 */
export function listSkills(skillsDir: string): SkillInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    const skillMd = join(skillsDir, entry, "SKILL.md");
    try {
      if (!statSync(join(skillsDir, entry)).isDirectory()) continue;
      if (!existsSync(skillMd)) continue;
      const block = readFileSync(skillMd, "utf8").match(FRONTMATTER)?.[1] ?? "";
      skills.push({
        name: frontmatterField(block, "name") || entry,
        description: frontmatterField(block, "description"),
      });
    } catch {
      // An unreadable entry must not take every other skill down with it.
      continue;
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Makes the skills folder loadable as an SDK local plugin and returns the
 * plugin path, or undefined when there are no skills to load. The scaffold
 * (`<pluginDir>/.claude-plugin/plugin.json` + a `skills` symlink into the
 * real folder) is generated so the Operator never has to know the plugin
 * layout — they only ever touch the skills folder itself.
 */
export function ensureSkillsPlugin(skillsDir: string, pluginDir: string): string | undefined {
  if (listSkills(skillsDir).length === 0) return undefined;

  const manifestDir = join(pluginDir, ".claude-plugin");
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, "plugin.json");
  const manifest = JSON.stringify(
    {
      name: "skills",
      version: "0.0.0",
      description: "Skill กลางของบอท — scaffold นี้ generate อัตโนมัติ (ADR 0005)",
    },
    null,
    2,
  );
  if (!existsSync(manifestPath) || readFileSync(manifestPath, "utf8") !== manifest) {
    writeFileSync(manifestPath, manifest);
  }

  const link = join(pluginDir, "skills");
  const target = resolve(skillsDir);
  try {
    if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === target) {
      return pluginDir;
    }
    rmSync(link, { recursive: true, force: true });
  } catch {
    // No existing link — fall through and create it.
  }
  symlinkSync(target, link);
  return pluginDir;
}

/**
 * The prompt sent to the agent. With a picked skill it is prefixed with an
 * instruction naming it; with none (null) the prompt passes through, so call
 * sites can hand over the `skill` option unconditionally.
 */
export function withSkill(prompt: string, skillName: string | null): string {
  if (!skillName) return prompt;
  return `ใช้สกิล "${skillName}" ทำงานนี้:\n\n${prompt}`;
}
