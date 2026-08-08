/**
 * Project-skill migration orchestration. Replaces the bulk-move flow:
 * instead of moving every detected import candidate in one batch, this
 * runs on a single skill that the user has explicitly chosen to share
 * (or consolidate). Primitives are split out of the old `bulkMove.ts` so
 * the operations themselves stay simple and the orchestration is testable.
 */

import { logError, logWarn } from "@/logger";
import { joinPosix } from "@/utils/pathUtils";
import { renameWithRetry } from "./renameWithRetry";
import {
  parseSkillFile,
  serializeSkillFile,
  SkillFormatError,
  type ParsedSkillFile,
} from "./skillFormat";
import { suffixOnCollision } from "./suffixOnCollision";
import { replaceAgentLink, type SymlinksFs } from "./symlinks";
import type { BackendId, Skill } from "./types";

/**
 * Subset of `node:fs` plus read/write surface for SKILL.md. Mirrors the
 * shape the old `bulkMove.ts` used; kept here so the migration helper
 * stays self-contained. Tests inject an in-memory FS.
 */
export interface MigrateSkillFs extends SymlinksFs {
  readFile(absPath: string): Promise<string>;
  writeFile(absPath: string, content: string): Promise<void>;
  mkdirRecursive(absPath: string): Promise<void>;
  list(absPath: string): Promise<string[]>;
}

/**
 * Outcome of a single migration. `resolvedName` is the final canonical
 * folder name after collision suffixing (e.g. `foo` if free, else
 * `foo-2`). `newDirPath`/`newFilePath` are the post-move absolute paths.
 */
export interface MigrateSkillSuccess {
  ok: true;
  resolvedName: string;
  newDirPath: string;
  newFilePath: string;
}

export interface MigrateSkillFailure {
  ok: false;
  reason: string;
  /** True once any FS state may have been touched. Caller refreshes discovery. */
  mutated?: boolean;
}

export type MigrateSkillResult = MigrateSkillSuccess | MigrateSkillFailure;

/**
 * Options bag for {@link migrateProjectSkill}. All paths are absolute.
 *
 *   - `sourceDirAbs` is the agent-folder directory to move into canonical
 *     (the representative copy chosen by discovery).
 *   - `duplicateSourceDirsAbs` lists every OTHER agent-folder copy when
 *     the source is project-mirrored. Each of these is deleted after the
 *     primary source moves into canonical.
 *   - `enabledAgentsAfter` is the final list to stamp into
 *     `metadata.copilot-enabled-agents` on the canonical SKILL.md. The
 *     caller derives this from the toggle action (project-single + new
 *     agent → [oldAgent, newAgent]; disable-last-agent → []; etc.).
 *   - `targetAgentDirsAbs` maps each agent id in `enabledAgentsAfter` to
 *     its absolute project skills directory so symlinks can be created.
 *   - `preTakenNames` is the set of canonical names already in use; used
 *     to compute the collision suffix.
 */
export interface MigrateProjectSkillOptions {
  sourceName: string;
  sourceDirAbs: string;
  duplicateSourceDirsAbs: ReadonlyArray<string>;
  canonicalAbsRoot: string;
  enabledAgentsAfter: ReadonlyArray<BackendId>;
  targetAgentDirsAbs: Readonly<Record<BackendId, string>>;
  preTakenNames: ReadonlyArray<string>;
  fs: MigrateSkillFs;
}

/**
 * Orchestrate the migration of a project-managed skill to canonical:
 *
 *   1. Pick a free canonical name using {@link suffixOnCollision}.
 *   2. Ensure the canonical root exists.
 *   3. Move `sourceDirAbs` into `<canonicalAbsRoot>/<resolvedName>/`.
 *   4. Delete every entry in `duplicateSourceDirsAbs` (mirrored case).
 *   5. Parse the moved SKILL.md, rewrite `name` (if suffixed) and
 *      `metadata.copilot-enabled-agents` to `enabledAgentsAfter`.
 *   6. For each agent in `enabledAgentsAfter`, create a symlink at
 *      `<agentDir>/<resolvedName>` pointing at the new canonical dir.
 *
 * If parsing or write fails after the move, the canonical dir is moved
 * back to its source — but mirrored duplicates that were already deleted
 * are NOT restored. The caller refreshes discovery so the resulting
 * UI state matches whatever is on disk.
 */
export async function migrateProjectSkill(
  options: MigrateProjectSkillOptions
): Promise<MigrateSkillResult> {
  const {
    sourceName,
    sourceDirAbs,
    duplicateSourceDirsAbs,
    canonicalAbsRoot,
    enabledAgentsAfter,
    targetAgentDirsAbs,
    preTakenNames,
    fs,
  } = options;

  // 1. Resolve target name with suffix-on-collision. This throws when no
  //    spec-valid suffix fits under the 64-char name cap (pathologically long
  //    names); surface it as a normal failure instead of letting it escape.
  const taken = new Set<string>(preTakenNames);
  let resolvedName: string;
  try {
    resolvedName = suffixOnCollision(sourceName, taken);
  } catch (err) {
    return fail(describe(err));
  }
  const newDirPath = joinPosix(canonicalAbsRoot, resolvedName);
  const newFilePath = joinPosix(newDirPath, "SKILL.md");

  // 2. Make sure the canonical root exists.
  try {
    await fs.mkdirRecursive(canonicalAbsRoot);
  } catch (err) {
    return fail(`Could not create canonical folder: ${describe(err)}`);
  }

  // 3. Move the chosen source into canonical.
  try {
    await renameWithRetry(sourceDirAbs, newDirPath);
  } catch (err) {
    return fail(`Could not move ${sourceDirAbs} → ${newDirPath}: ${describe(err)}`);
  }

  // 4. Parse + stamp the moved SKILL.md. On failure, roll back the move.
  let parsed: ParsedSkillFile;
  try {
    const raw = await fs.readFile(newFilePath);
    parsed = parseSkillFile(raw, sourceName);
  } catch (err) {
    const reason =
      err instanceof SkillFormatError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    // Best-effort rollback so the user's source dir isn't lost.
    try {
      await renameWithRetry(newDirPath, sourceDirAbs);
    } catch (restoreErr) {
      logError(
        `[skills] migrateProjectSkill: rollback failed after parse error: ${describe(restoreErr)}`
      );
    }
    return { ok: false, reason };
  }

  let stamped: string;
  try {
    stamped = serializeSkillFile(parsed, {
      ...(resolvedName !== sourceName ? { name: resolvedName } : {}),
      enabledAgents: [...enabledAgentsAfter],
    });
  } catch (err) {
    try {
      await renameWithRetry(newDirPath, sourceDirAbs);
    } catch (restoreErr) {
      logError(
        `[skills] migrateProjectSkill: rollback failed after serialize error: ${describe(restoreErr)}`
      );
    }
    return { ok: false, reason: `Could not serialize SKILL.md: ${describe(err)}` };
  }

  try {
    await fs.writeFile(newFilePath, stamped);
  } catch (err) {
    try {
      await renameWithRetry(newDirPath, sourceDirAbs);
    } catch (restoreErr) {
      logError(
        `[skills] migrateProjectSkill: rollback failed after write error: ${describe(restoreErr)}`
      );
    }
    return { ok: false, reason: `Could not write SKILL.md: ${describe(err)}` };
  }

  // 5. Delete mirrored duplicates (these copies are identical to the moved
  //    one — confirmed by the merge layer's content-hash check).
  for (const duplicateDir of duplicateSourceDirsAbs) {
    try {
      await fs.rmRecursive(duplicateDir);
    } catch (err) {
      logWarn(
        `[skills] migrateProjectSkill: could not remove duplicate ${duplicateDir}: ${describe(err)}`
      );
    }
  }

  // 6. Create symlinks for each target agent. EPERM bubbles up as a
  //    non-fatal log; the canonical SKILL.md is the source of truth and
  //    reconciliation will re-create the link on the next pass.
  let epermSeen = false;
  for (const agent of enabledAgentsAfter) {
    const agentDir = targetAgentDirsAbs[agent];
    if (agentDir === undefined) {
      logWarn(`[skills] migrateProjectSkill: unknown agent dir for ${agent}`);
      continue;
    }
    // Refuse to link over a REAL directory we don't own. The merge layer
    // keeps same-name/different-content skills as separate rows, so a new
    // target agent's slot can hold a foreign skill that shares this name.
    // `replaceAgentLink`'s real-directory branch would move it aside and
    // delete it — silently destroying the user's other skill. Skip instead
    // (mirrors reconcile's "refusing to replace real directory" guard); the
    // canonical copy is intact and the user can resolve the name clash.
    const slot = joinPosix(agentDir, resolvedName);
    if (await fs.exists(slot)) {
      const slotIsLink = await fs.isSymlink(slot).catch(() => false);
      if (!slotIsLink) {
        logWarn(
          `[skills] migrateProjectSkill: ${agent} slot ${slot} holds a real directory (a different skill of the same name); skipping link to avoid clobbering it`
        );
        continue;
      }
    }
    const linkResult = await replaceAgentLink(fs, agentDir, resolvedName, newDirPath);
    if (!linkResult.ok) {
      epermSeen = true;
      logWarn(
        `[skills] migrateProjectSkill: ${agent} symlink failed (${linkResult.reason}): ${linkResult.message}`
      );
    }
  }

  if (epermSeen) {
    return {
      ok: false,
      reason: "eperm",
      mutated: true,
    };
  }

  return { ok: true, resolvedName, newDirPath, newFilePath };
}

/**
 * Convenience: build the list of duplicate source dirs from a project-
 * mirrored {@link Skill}. The representative dir (`skill.dirPath`) is
 * NOT included — that's the one that will be moved.
 */
export function duplicateSourceDirsFor(
  skill: Skill,
  agentDirsAbs: Readonly<Record<BackendId, string>>
): string[] {
  if (skill.location.kind !== "project") return [];
  const repAbs = skill.dirPath;
  const dirs: string[] = [];
  for (const agent of skill.location.agentDirs) {
    const agentDirAbs = agentDirsAbs[agent];
    if (agentDirAbs === undefined) continue;
    const dupDir = joinPosix(agentDirAbs, skill.name);
    if (dupDir !== repAbs) dirs.push(dupDir);
  }
  return dirs;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fail(reason: string): MigrateSkillFailure {
  return { ok: false, reason };
}
