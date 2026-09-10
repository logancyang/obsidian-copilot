import { logError, logInfo } from "@/logger";
import { joinPosix, parentDir } from "@/utils/pathUtils";
import { getBuiltinSkillVersion } from "./builtinOwnership";
import {
  ALL_MANAGED_SKILLS,
  BUILTIN_SKILLS,
  RETIRED_BUILTIN_SKILLS,
  type BuiltinSkill,
} from "@/builtinSkills/builtinSkills";

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
  /** Remove a known retired support file, never a directory. */
  removeFile(relPath: string): Promise<void>;
  /** Remove an empty directory only; preserve nonempty contents. */
  removeEmptyDir(relPath: string): Promise<void>;
}

export interface SeedBuiltinSkillsOptions {
  /** Vault-relative POSIX path of the canonical skills folder (e.g. `copilot/skills`). */
  skillsFolderRelPath: string;
  fs: BuiltinSeedFs;
  /** Override the skill set (tests). Defaults to {@link BUILTIN_SKILLS}. */
  skills?: readonly BuiltinSkill[];
  /** Settings-derived agent lists override legacy file preferences. */
  enabledAgents?: Readonly<Record<string, readonly string[]>>;
}

/**
 * On-disk state of a builtin skill folder, as the seeder's ownership rules see
 * it:
 * - `seeded`    — our copy (a valid `copilot-builtin-version` marker is present,
 *                 at or above `expectedVersion` when one is given).
 * - `stale`     — our copy, but the marker is OLDER than `expectedVersion` — an
 *                 upgrade the seeder tried but couldn't complete (its per-skill
 *                 errors are swallowed). Only returned when `expectedVersion` is
 *                 passed; callers that don't care about freshness never see it.
 * - `collision` — a same-named folder exists WITHOUT the marker → user-authored;
 *                 the seeder never overwrites and the remover never deletes it.
 * - `absent`    — no SKILL.md at that path.
 * - `failed`    — the SKILL.md exists but couldn't be read.
 */
export type BuiltinDiskState = "seeded" | "stale" | "collision" | "absent" | "failed";

/**
 * Classify a builtin skill folder from disk. Callers that need to report the
 * real outcome of a seed/remove (e.g. the settings UI distinguishing a
 * successful install from a user-authored collision) use this instead of
 * re-deriving the marker format themselves. Pass `expectedVersion` to also catch
 * a marker left behind by a failed upgrade (returned as `stale`).
 */
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

/**
 * Read the `copilot-enabled-agents` line from an existing SKILL.md and splice
 * it into the bundled replacement, preserving any agent-disable choices the
 * user made via the UI. Returns the patched content unchanged when the field
 * is absent in either string.
 */
function preserveEnabledAgents(existingMd: string, bundledMd: string): string {
  const existing = existingMd.match(ENABLED_AGENTS_RE);
  if (!existing) return bundledMd;
  // Replace the bundled copilot-enabled-agents value with the existing one.
  return bundledMd.replace(ENABLED_AGENTS_RE, `$1${existing[2]}`);
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

  // No eligible skill means no folders should be created.
  // https://github.com/logancyang/obsidian-copilot/issues/3022

  for (const skill of skills) {
    const dir = joinPosix(skillsFolderRelPath, skill.name);
    const skillMdPath = joinPosix(dir, "SKILL.md");

    // existingContent is captured here so we can carry the user's
    // copilot-enabled-agents choice forward when re-seeding an upgrade.
    let existingContent: string | null = null;
    let current = false;
    if (await fs.exists(skillMdPath)) {
      try {
        existingContent = await fs.read(skillMdPath);
        const existing = getBuiltinSkillVersion(existingContent);
        // null = no copilot-builtin-version marker → user-authored file; skip.
        if (existing === null) continue;
        // Version is current — only skip if all support files are also present.
        // A partial write (e.g. crash after SKILL.md but before the .sh file)
        // would leave the skill advertising a stale script; re-seed to self-heal.
        if (existing >= skill.version) {
          current = await Promise.all(
            skill.files.map((f) => fs.exists(joinPosix(dir, f.path)))
          ).then((results) => results.every(Boolean));
        }
      } catch (e) {
        // Unreadable content may be user-owned; retry without overwriting it.
        // https://github.com/logancyang/obsidian-copilot/issues/3022
        logError(`[Skills] could not read builtin skill ${skill.name} for version check`, e);
        continue;
      }
    }

    const effectiveAgents = options.enabledAgents?.[skill.name];
    // Settings opt-outs must apply even when bundled content is already current.
    // https://github.com/logancyang/obsidian-copilot/issues/3022
    if (current && existingContent !== null && effectiveAgents !== undefined) {
      const next = existingContent.replace(
        ENABLED_AGENTS_RE,
        `$1${effectiveAgents.join(", ") || '""'}`
      );
      if (next !== existingContent) await fs.write(skillMdPath, next);
    }
    if (!current) {
      try {
        // Retire only explicitly owned files: users can add references and themes beside
        // a managed skill, and an upgrade must preserve them.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/394
        if (existingContent !== null) {
          for (const retiredFile of skill.retiredFiles ?? []) {
            const retiredPath = joinPosix(dir, retiredFile);
            if (await fs.exists(retiredPath)) await fs.removeFile(retiredPath);
          }
        }
        await ensureDir(fs, dir);
        // Carry the user's agent-disable choices forward: if they toggled any
        // agent off via the UI, copilot-enabled-agents was rewritten on disk.
        // Preserve that value in the bundled replacement so the upgrade doesn't
        // silently undo the user's preference.
        const skillMd =
          effectiveAgents !== undefined
            ? skill.skillMd.replace(ENABLED_AGENTS_RE, `$1${effectiveAgents.join(", ") || '""'}`)
            : existingContent
              ? preserveEnabledAgents(existingContent, skill.skillMd)
              : skill.skillMd;
        // Write support files before SKILL.md so the version stamp in SKILL.md
        // only appears once all scripts are on disk. A crash between writes then
        // leaves no SKILL.md (or a stale-version one), so the next startup
        // re-seeds the whole skill rather than skipping it as current.
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

/**
 * Remove catalog-owned files while preserving user additions in the same folder.
 * Missing or unmarked content is never removed; SKILL.md is removed last so a failed
 * support-file cleanup can be retried with ownership evidence still intact.
 * @param skillsFolderRelPath - Canonical skills root relative to the vault.
 * @param name - Active or retired catalog folder name.
 * @param fs - Vault file operations.
 * @param definition - Catalog entry that owns the known supporting and retired paths.
 */
export async function removeSeededBuiltin(
  skillsFolderRelPath: string,
  name: string,
  fs: BuiltinSeedFs,
  definition:
    | (Pick<BuiltinSkill, "retiredFiles"> & Partial<Pick<BuiltinSkill, "files">>)
    | undefined = ALL_MANAGED_SKILLS.find((skill) => skill.name === name) ??
    RETIRED_BUILTIN_SKILLS.find((skill) => skill.name === name)
): Promise<boolean> {
  const dir = joinPosix(skillsFolderRelPath, name);
  const skillMdPath = joinPosix(dir, "SKILL.md");
  try {
    if (!(await fs.exists(skillMdPath))) return false;
    // null marker = user-authored file → never delete.
    if (getBuiltinSkillVersion(await fs.read(skillMdPath)) === null) return false;
    // A marked folder may also contain user references/themes. Only bundled paths are
    // ours to remove, and the ownership marker remains until support cleanup succeeds.
    // https://github.com/logancyang/obsidian-copilot/issues/3022
    if (!definition) return false;
    const ownedPaths = [
      ...(definition.files?.map((file) => file.path) ?? []),
      ...(definition.retiredFiles ?? []),
    ];
    for (const path of ownedPaths) {
      const ownedPath = joinPosix(dir, path);
      if (await fs.exists(ownedPath)) await fs.removeFile(ownedPath);
    }
    await fs.removeFile(skillMdPath);
    const directories = new Set([dir]);
    for (const path of ownedPaths) {
      let parent = parentDir(joinPosix(dir, path));
      while (parent.startsWith(`${dir}/`)) {
        directories.add(parent);
        parent = parentDir(parent);
      }
    }
    for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
      await fs.removeEmptyDir(directory);
    }
    logInfo(`[Skills] removed de-gated builtin skill: ${name}`);
    return true;
  } catch (e) {
    logError(`[Skills] failed to remove de-gated builtin skill ${name}`, e);
    return false;
  }
}
