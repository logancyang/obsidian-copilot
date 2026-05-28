import { logError, logWarn } from "@/logger";
import { parentDir } from "@/utils/pathUtils";
import { renameWithRetry } from "./renameWithRetry";
import {
  NAME_MAX,
  NAME_RE,
  parseSkillFile,
  serializeSkillFile,
  validateName,
  type SkillFrontmatterPatch,
} from "./skillFormat";
import { removeAgentLink, replaceAgentLink } from "./symlinks";
import type { ToggleAgentFs } from "./toggleAgent";
import type { BackendId, Skill } from "./types";

/**
 * FS surface for {@link runUpdateProperties} and {@link runRenameSkill}.
 * Mirrors {@link ToggleAgentFs} (the symlinks + read/write subset) — kept as
 * a type alias rather than `interface extends` to avoid the
 * "empty interface" lint hit.
 */
export type PropertiesFs = ToggleAgentFs;

/** Stable reason tokens the UI switches on; free-form FS errors fall through to a separate string variant. */
export type PropertiesFailReason = "invalid" | "collision" | "eperm";

/**
 * Result discriminator for property/rename operations. The string variant
 * carries unexpected FS failure messages; the `PropertiesFailReason` variant
 * is the caller-facing token set.
 */
export type PropertiesResult =
  | { ok: true }
  | { ok: false; reason: PropertiesFailReason }
  | { ok: false; reason: string };

/**
 * Validate the new name against the same spec rules `validateName` uses.
 * Doesn't enforce the parent-dir-match invariant here because the caller's
 * intent is precisely to change the parent dir name.
 */
function isValidName(name: string): boolean {
  return (
    typeof name === "string" && name.length > 0 && name.length <= NAME_MAX && NAME_RE.test(name)
  );
}

/** Options for {@link runUpdateProperties}. */
export interface UpdatePropertiesOptions {
  skill: Skill;
  /** Frontmatter patch to apply. `name` is NOT honored here — use renameSkill. */
  patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">;
  fs: PropertiesFs;
}

/**
 * Pure-fs core of `SkillManager.updateProperties`. Rewrites the canonical
 * SKILL.md with the patched frontmatter; no symlink work. Preserves unknown
 * top-level + unknown `metadata.*` keys byte-for-byte (delegated to
 * `serializeSkillFile`).
 */
export async function runUpdateProperties(
  options: UpdatePropertiesOptions
): Promise<PropertiesResult> {
  const { skill, patch, fs } = options;
  try {
    const raw = await fs.readFile(skill.filePath);
    const parsed = parseSkillFile(raw, skill.name);
    const next = serializeSkillFile(parsed, patch);
    await fs.writeFile(skill.filePath, next);
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] updateProperties: failed to rewrite ${skill.filePath}`, err);
    return { ok: false, reason };
  }
}

/** Options for {@link runRenameSkill}. */
export interface RenameSkillOptions {
  skill: Skill;
  /** Desired new name. Validated against the spec. */
  newName: string;
  /** Absolute path of the canonical skills folder. */
  canonicalAbsRoot: string;
  /** Absolute path of each registered agent's project skills directory. */
  agentDirsAbs: Readonly<Record<BackendId, string>>;
  fs: PropertiesFs;
}

/**
 * Result of a successful rename — carries the new canonical paths so the
 * caller can reload state without re-running discovery.
 */
export interface RenameSkillSuccess {
  ok: true;
  /** New canonical absolute path (`<canonical>/<newName>`). */
  newDirPath: string;
  /** New SKILL.md absolute path. */
  newFilePath: string;
}

export interface RenameSkillFailure {
  ok: false;
  reason: string;
  /** True once the canonical directory may have been renamed on disk. */
  mutated?: boolean;
}

/**
 * Pure-fs core of `SkillManager.renameSkill`. Atomic in spirit:
 *
 * 1. Validate the new name (spec regex + 1–64 chars).
 * 2. Reject collisions (no auto-suffix in interactive edits).
 * 3. Rename the skill directory via {@link renameWithRetry}. Canonical
 *    skills rename within the canonical root (`<canonical>/<old>` →
 *    `<canonical>/<new>`); project skills rename in place within their
 *    agent project folder (`.<agent>/skills/<old>` → `.<agent>/skills/<new>`).
 * 4. Canonical skills only — for each enabled agent: remove the old symlink,
 *    create a new one at `<vault>/.<agent>/skills/<new>` pointing at the
 *    renamed canonical absolute path. Continues on EPERM so the user gets a
 *    coherent state even when one agent's link cannot be repointed. Project
 *    skills have no symlink fanout and skip this step.
 * 5. Rewrite the SKILL.md's `name:` field so the spec's parent-dir-match
 *    invariant holds.
 *
 * Returns `{ ok: false, reason: 'eperm' }` if any symlink retarget hit EPERM —
 * the canonical rename still succeeded so we do not roll back; reconciliation
 * heals the missing link on the next pass once Developer Mode is on.
 */
export async function runRenameSkill(
  options: RenameSkillOptions
): Promise<RenameSkillSuccess | RenameSkillFailure> {
  const { skill, newName, canonicalAbsRoot, agentDirsAbs, fs } = options;

  // Idempotent no-op when the new name equals the existing one. The caller
  // (`SkillManager.renameSkill`) shouldn't reach us in that case, but be
  // defensive — returning success keeps the save flow straightforward.
  if (newName === skill.name) {
    return { ok: true, newDirPath: skill.dirPath, newFilePath: skill.filePath };
  }

  if (!isValidName(newName)) {
    return { ok: false, reason: "invalid" };
  }

  // Project skills rename IN PLACE inside their own agent project folder
  // (e.g. `.claude/skills/<old>` → `.claude/skills/<new>`) with no canonical
  // move and no symlink fanout — the agent loads the real directory directly.
  // Only canonical skills rename inside the canonical root and retarget
  // symlinks. See Skills Discovery Redesign §244 ("Rename in place … No
  // migration."). Without this branch a project rename would silently relocate
  // the skill into the canonical folder without stamping
  // `copilot-enabled-agents`, so discovery would read `enabledAgents: []` and
  // reconciliation would sweep the orphaned link — disabling the skill for
  // every agent.
  const isProjectSkill = skill.location.kind === "project";
  const destRoot = (isProjectSkill ? parentDir(skill.dirPath) : canonicalAbsRoot).replace(
    /[/\\]+$/,
    ""
  );
  const newDirPath = `${destRoot}/${newName}`;
  const newFilePath = `${newDirPath}/SKILL.md`;

  // Step 2 — collision check. No auto-suffix in interactive edits.
  if (await fs.exists(newDirPath)) {
    return { ok: false, reason: "collision" };
  }

  // Step 3 — rename the skill directory.
  try {
    await renameWithRetry(skill.dirPath, newDirPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] renameSkill: failed to rename ${skill.dirPath} → ${newDirPath}`, err);
    return { ok: false, reason };
  }

  // Step 4 — per-agent symlink retarget (canonical skills only). A project
  // skill is a real directory with no symlink fanout, so an in-place rename
  // has nothing to retarget. Track EPERM so we can surface it at the end
  // without rolling back the canonical rename.
  let epermSeen = false;
  if (!isProjectSkill) {
    for (const agent of skill.enabledAgents) {
      const agentDir = agentDirsAbs[agent];
      if (agentDir === undefined) continue;

      // Remove the stale link at the OLD basename. Real dirs at the old slot
      // are user-owned per spec; `removeAgentLink` leaves them alone.
      try {
        await removeAgentLink(fs, agentDir, skill.name);
      } catch (err) {
        logWarn(
          `[skills] renameSkill: could not remove stale ${agent} link for ${skill.name}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      // Create the new link at the NEW basename. `replaceAgentLink` handles
      // any aborted-rename leftover at the new slot (rare but possible) via
      // its `.replacing` aside dance.
      const linkResult = await replaceAgentLink(fs, agentDir, newName, newDirPath);
      if (!linkResult.ok) {
        // EPERM — log and keep going; metadata source-of-truth is the canonical
        // file, so reconciliation can heal the missing link later.
        logWarn(
          `[skills] renameSkill: ${agent} symlink retarget failed (${linkResult.reason}): ${linkResult.message}`
        );
        epermSeen = true;
      }
    }
  }

  // Step 5 — rewrite `name:` inside the moved SKILL.md so parent-dir-match
  // holds. Parse with the OLD name (it's still what's in the file) so
  // validation succeeds, then serialize with the patched name.
  try {
    const raw = await fs.readFile(newFilePath);
    const parsed = parseSkillFile(raw, skill.name);
    // Defensive — make sure the new name is spec-valid before writing.
    validateName(newName, newName);
    const next = serializeSkillFile(parsed, { name: newName });
    await fs.writeFile(newFilePath, next);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] renameSkill: failed to rewrite name in ${newFilePath}`, err);
    return { ok: false, reason, mutated: true };
  }

  if (epermSeen) {
    return { ok: false, reason: "eperm", mutated: true };
  }
  return { ok: true, newDirPath, newFilePath };
}
