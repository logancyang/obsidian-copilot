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

/**
 * Matches `metadata.copilot-builtin-version` in a SKILL.md. Absence of this
 * field means the file is user-authored — we must not overwrite it even if the
 * folder name collides with a builtin skill name.
 */
const VERSION_RE = /copilot-builtin-version:\s*"?(\d+)"?/;

/** Returns the seeded version number, or null if the file is not a builtin. */
function seededVersion(skillMd: string): number | null {
  const m = skillMd.match(VERSION_RE);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Create a directory and all missing ancestor segments. Mirrors the
 * segment-by-segment approach of `ensureFolderExists` in `utils.ts` so that
 * seeding into nested paths like `copilot/skills` works on a fresh vault.
 */
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
        const existing = seededVersion(await fs.read(skillMdPath));
        // null = no copilot-builtin-version marker → user-authored file; skip.
        if (existing === null) continue;
        // Version is current — only skip if all support files are also present.
        // A partial write (e.g. crash after SKILL.md but before .mjs) would
        // leave the skill advertising a script that doesn't exist; re-seed to
        // self-heal.
        if (existing >= skill.version) {
          const allFilesPresent = await Promise.all(
            skill.files.map((f) => fs.exists(joinPosix(dir, f.path)))
          ).then((results) => results.every(Boolean));
          if (allFilesPresent) continue;
        }
      } catch (e) {
        // Unreadable existing copy — fall through and re-seed.
        logError(`[Skills] could not read builtin skill ${skill.name} for version check`, e);
      }
    }

    try {
      await ensureDir(fs, dir);
      // Write support files before SKILL.md so the version stamp in SKILL.md
      // only appears once all scripts are on disk. A crash between writes then
      // leaves no SKILL.md (or a stale-version one), so the next startup
      // re-seeds the whole skill rather than skipping it as current.
      for (const file of skill.files) {
        await fs.write(joinPosix(dir, file.path), file.content);
      }
      await fs.write(skillMdPath, skill.skillMd);
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
