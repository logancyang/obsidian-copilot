import { logError, logInfo } from "@/logger";
import { joinPosix } from "@/utils/pathUtils";
import { BUILTIN_SKILLS, type BuiltinSkill } from "./builtinSkills";

/**
 * Minimal write-capable FS surface the seeder needs, over vault-relative
 * POSIX paths. Modelled on the read-only `SkillsFsAdapter` but with the
 * `write`/`mkdir` the seeder requires. Kept small so unit tests pass a plain
 * object instead of mocking the Obsidian vault adapter.
 */
export interface BuiltinSeedFs {
  exists(relPath: string): Promise<boolean>;
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  mkdir(relPath: string): Promise<void>;
}

export interface SeedBuiltinSkillsOptions {
  /** Vault-relative POSIX path of the canonical skills folder (e.g. `copilot/skills`). */
  skillsFolderRelPath: string;
  fs: BuiltinSeedFs;
  /** Override the skill set (tests). Defaults to {@link BUILTIN_SKILLS}. */
  skills?: readonly BuiltinSkill[];
}

/** Reads `metadata.copilot-builtin-version` from a seeded SKILL.md, or 0. */
const VERSION_RE = /copilot-builtin-version:\s*"?(\d+)"?/;

function seededVersion(skillMd: string): number {
  const m = skillMd.match(VERSION_RE);
  return m ? Number.parseInt(m[1], 10) : 0;
}

async function ensureDir(fs: BuiltinSeedFs, relPath: string): Promise<void> {
  if (!(await fs.exists(relPath))) {
    await fs.mkdir(relPath);
  }
}

/**
 * Write each plugin-shipped builtin skill into the canonical skills folder
 * when it is missing or older than the bundled `version`. Idempotent: a skill
 * already present at the current version is left untouched, so this is safe to
 * run on every plugin load. User-authored skills in the same folder are never
 * touched. Returns the names actually (re)written.
 *
 * Only writes content — symlink fanout to agent dirs is left to the normal
 * `SkillManager.refresh()` reconcile pass that runs after seeding.
 */
export async function seedBuiltinSkills(
  options: SeedBuiltinSkillsOptions
): Promise<{ seeded: string[] }> {
  const { skillsFolderRelPath, fs } = options;
  const skills = options.skills ?? BUILTIN_SKILLS;
  const seeded: string[] = [];

  await ensureDir(fs, skillsFolderRelPath);

  for (const skill of skills) {
    const dir = joinPosix(skillsFolderRelPath, skill.name);
    const skillMdPath = joinPosix(dir, "SKILL.md");

    if (await fs.exists(skillMdPath)) {
      try {
        if (seededVersion(await fs.read(skillMdPath)) >= skill.version) {
          continue;
        }
      } catch (e) {
        // Unreadable existing copy — fall through and re-seed.
        logError(`[Skills] could not read builtin skill ${skill.name} for version check`, e);
      }
    }

    try {
      await ensureDir(fs, dir);
      await fs.write(skillMdPath, skill.skillMd);
      for (const file of skill.files) {
        await fs.write(joinPosix(dir, file.path), file.content);
      }
      seeded.push(skill.name);
    } catch (e) {
      logError(`[Skills] failed to seed builtin skill ${skill.name}`, e);
    }
  }

  if (seeded.length > 0) {
    logInfo(`[Skills] seeded builtin skills: ${seeded.join(", ")}`);
  }
  return { seeded };
}
