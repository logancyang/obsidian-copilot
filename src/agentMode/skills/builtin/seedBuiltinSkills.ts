import { logError, logInfo } from "@/logger";
import { joinPosix, parentDir } from "@/utils/pathUtils";
import { getBuiltinSkillVersion } from "./builtinOwnership";
import { BUILTIN_SKILLS, type BuiltinSkill } from "@/builtinSkills/builtinSkills";

export interface BuiltinSeedFs {
  exists(relPath: string): Promise<boolean>;
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  mkdir(relPath: string): Promise<void>;
  removeDir(relPath: string): Promise<void>;
}

export interface SeedBuiltinSkillsOptions {
  skillsFolderRelPath: string;
  fs: BuiltinSeedFs;
  skills?: readonly BuiltinSkill[];
  enabledAgents?: Readonly<Record<string, readonly string[]>>;
}

export type BuiltinDiskState = "seeded" | "stale" | "collision" | "absent" | "failed";

export async function inspectBuiltinSkill(
  skillsFolderRelPath: string,
  name: string,
  fs: BuiltinSeedFs,
  expectedVersion?: number
): Promise<BuiltinDiskState> {
  const skillMdPath = joinPosix(joinPosix(skillsFolderRelPath, name), "SKILL.md");
  try {
    if (!(await fs.exists(skillMdPath))) return "absent";
    const version = getBuiltinSkillVersion(await fs.read(skillMdPath));
    if (version === null) return "collision";
    if (expectedVersion !== undefined && version < expectedVersion) return "stale";
    return "seeded";
  } catch {
    return "failed";
  }
}

const ENABLED_AGENTS_RE = /^([ \t]*copilot-enabled-agents:[ \t]*)(.*)$/m;

function preserveEnabledAgents(existingMd: string, bundledMd: string): string {
  const existing = existingMd.match(ENABLED_AGENTS_RE);
  if (!existing) return bundledMd;
  return bundledMd.replace(ENABLED_AGENTS_RE, `$1${existing[2]}`);
}

async function ensureDir(fs: BuiltinSeedFs, relPath: string): Promise<void> {
  const segments = relPath
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await fs.exists(current))) {
      await fs.mkdir(current);
    }
  }
}

export async function seedBuiltinSkills(
  options: SeedBuiltinSkillsOptions
): Promise<{ seeded: string[] }> {
  const { skillsFolderRelPath, fs } = options;
  const skills = options.skills ?? BUILTIN_SKILLS;
  const seeded: string[] = [];

  for (const skill of skills) {
    const dir = joinPosix(skillsFolderRelPath, skill.name);
    const skillMdPath = joinPosix(dir, "SKILL.md");

    let existingContent: string | null = null;
    let current = false;
    if (await fs.exists(skillMdPath)) {
      try {
        existingContent = await fs.read(skillMdPath);
        const existing = getBuiltinSkillVersion(existingContent);
        if (existing === null) continue;
        if (existing >= skill.version) {
          current = await Promise.all(
            skill.files.map((f) => fs.exists(joinPosix(dir, f.path)))
          ).then((results) => results.every(Boolean));
        }
      } catch (e) {
        // Unreadable content may be user-owned: retry later instead of overwriting it. https://github.com/logancyang/obsidian-copilot/issues/3022
        logError(`[Skills] could not read builtin skill ${skill.name} for version check`, e);
        continue;
      }
    }

    const effectiveAgents = options.enabledAgents?.[skill.name];
    if (current && existingContent !== null && effectiveAgents !== undefined) {
      const next = existingContent.replace(
        ENABLED_AGENTS_RE,
        `$1${effectiveAgents.join(", ") || '""'}`
      );
      if (next !== existingContent) await fs.write(skillMdPath, next);
    }
    if (!current) {
      try {
        // Copilot owns the whole marked folder, so replacement drops obsolete files. https://github.com/logancyang/obsidian-copilot/issues/3022
        if (existingContent !== null) await fs.removeDir(dir);
        await ensureDir(fs, dir);
        const skillMd =
          effectiveAgents !== undefined
            ? skill.skillMd.replace(ENABLED_AGENTS_RE, `$1${effectiveAgents.join(", ") || '""'}`)
            : existingContent
              ? preserveEnabledAgents(existingContent, skill.skillMd)
              : skill.skillMd;
        for (const file of skill.files) {
          const filePath = joinPosix(dir, file.path);
          await ensureDir(fs, parentDir(filePath));
          await fs.write(filePath, file.content);
        }
        await fs.write(skillMdPath, skillMd);
        seeded.push(skill.name);
      } catch (e) {
        logError(`[Skills] failed to seed builtin skill ${skill.name}`, e);
        continue;
      }
    }
  }

  if (seeded.length > 0) {
    logInfo(`[Skills] seeded builtin skills: ${seeded.join(", ")}`);
  }
  return { seeded };
}

export async function removeSeededBuiltin(
  skillsFolderRelPath: string,
  name: string,
  fs: BuiltinSeedFs
): Promise<"removed" | "absent" | "collision" | "failed"> {
  const dir = joinPosix(skillsFolderRelPath, name);
  const skillMdPath = joinPosix(dir, "SKILL.md");
  try {
    if (!(await fs.exists(skillMdPath))) return "absent";
    if (getBuiltinSkillVersion(await fs.read(skillMdPath)) === null) return "collision";
    // Copilot owns the whole marked directory, so removal leaves no orphans. https://github.com/logancyang/obsidian-copilot/issues/3022
    await fs.removeDir(dir);
    logInfo(`[Skills] removed de-gated builtin skill: ${name}`);
    return "removed";
  } catch (e) {
    logError(`[Skills] failed to remove de-gated builtin skill ${name}`, e);
    return "failed";
  }
}
