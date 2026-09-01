import { logError, logInfo } from "@/logger";
import { joinPosix, parentDir } from "@/utils/pathUtils";
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
  /** Remove a directory and its contents. Used to prune a de-gated builtin. */
  rmRecursive(relPath: string): Promise<void>;
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
    const version = seededVersion(await fs.read(skillMdPath));
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

  await ensureDir(fs, skillsFolderRelPath);

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
        const existing = seededVersion(existingContent);
        // null = no copilot-builtin-version marker → user-authored file; skip.
        if (existing === null) {
          // The user chose to own this name, so the managed predecessor still retires: its
          // wrapper scripts no longer match the host and would only mislead an agent.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/337
          if (skill.legacyName)
            await removeSeededBuiltin(skillsFolderRelPath, skill.legacyName, fs);
          continue;
        }
        // Version is current — only skip if all support files are also present.
        // A partial write (e.g. crash after SKILL.md but before the .sh file)
        // would leave the skill advertising a stale script; re-seed to self-heal.
        if (existing >= skill.version) {
          current = await Promise.all(
            skill.files.map((f) => fs.exists(joinPosix(dir, f.path)))
          ).then((results) => results.every(Boolean));
        }
      } catch (e) {
        // Unreadable existing copy — fall through and re-seed.
        logError(`[Skills] could not read builtin skill ${skill.name} for version check`, e);
        // A renamed builtin also retires its predecessor below, so an unclassifiable target
        // (possibly a user-authored collision) must leave both folders alone until the next
        // startup can read it. https://github.com/Brevilabs/obsidian-copilot-private/issues/337
        if (skill.legacyName) continue;
      }
    } else if (skill.legacyName) {
      // A renamed builtin inherits the enable choices of its managed predecessor.
      // An unmarked folder under the old name is user-authored and contributes nothing.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/337
      const legacyMdPath = joinPosix(joinPosix(skillsFolderRelPath, skill.legacyName), "SKILL.md");
      try {
        if (await fs.exists(legacyMdPath)) {
          const legacyContent = await fs.read(legacyMdPath);
          if (seededVersion(legacyContent) !== null) existingContent = legacyContent;
        }
      } catch (e) {
        logError(`[Skills] could not read legacy builtin skill ${skill.legacyName}`, e);
        // Seeding now would carry the default agent list forward and the predecessor's
        // enable choices would be lost when it is retired; retry next startup instead.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/337
        continue;
      }
    }

    if (!current) {
      try {
        await ensureDir(fs, dir);
        // Carry the user's agent-disable choices forward: if they toggled any
        // agent off via the UI, copilot-enabled-agents was rewritten on disk.
        // Preserve that value in the bundled replacement so the upgrade doesn't
        // silently undo the user's preference.
        const skillMd = existingContent
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

    // The renamed skill is on disk and current, so its managed predecessor can go.
    // `removeSeededBuiltin` leaves a user-authored folder under the old name alone
    // and a failed removal is retried on the next startup.
    if (skill.legacyName) {
      await removeSeededBuiltin(skillsFolderRelPath, skill.legacyName, fs);
    }
  }

  if (seeded.length > 0) {
    logInfo(`[Skills] seeded builtin skills: ${seeded.join(", ")}`);
  }
  return { seeded };
}

/**
 * Remove a previously-seeded builtin skill folder. Used to de-gate a
 * conditionally-seeded builtin (e.g. the Miyo skill when the user turns Miyo
 * off): once the canonical dir is gone, the next `SkillManager.refresh()`
 * reverse-sweep prunes the agent-dir symlinks pointing at it.
 *
 * Guarded by the same `copilot-builtin-version` marker the seeder uses: a
 * folder whose SKILL.md lacks the marker is user-authored and is left
 * untouched, even if its name collides with a builtin. A missing folder is a
 * no-op. Returns true iff a builtin copy was actually removed.
 */
export async function removeSeededBuiltin(
  skillsFolderRelPath: string,
  name: string,
  fs: BuiltinSeedFs
): Promise<boolean> {
  const dir = joinPosix(skillsFolderRelPath, name);
  const skillMdPath = joinPosix(dir, "SKILL.md");
  try {
    if (!(await fs.exists(skillMdPath))) return false;
    // null marker = user-authored file → never delete.
    if (seededVersion(await fs.read(skillMdPath)) === null) return false;
    await fs.rmRecursive(dir);
    logInfo(`[Skills] removed de-gated builtin skill: ${name}`);
    return true;
  } catch (e) {
    logError(`[Skills] failed to remove de-gated builtin skill ${name}`, e);
    return false;
  }
}
