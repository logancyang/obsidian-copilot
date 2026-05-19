import { logError } from "@/logger";
import { joinPosix, parentDir } from "@/utils/pathUtils";
import { renameWithRetry } from "./renameWithRetry";
import { parseSkillFile, serializeSkillFile, SkillFormatError } from "./skillFormat";
import { suffixOnCollision } from "./suffixOnCollision";
import { replaceAgentLink, type SymlinksFs } from "./symlinks";
import type { ImportCandidate } from "./types";

/**
 * Subset of `node:fs` (plus a read/write helper for SKILL.md) used by the
 * bulk-move state machine. Injected so the orchestration can be tested
 * without touching disk or Obsidian.
 *
 * Implements both the directory-shaping ops and the file IO we need to
 * stamp `metadata.copilot-enabled-agents` on the moved SKILL.md.
 */
export interface BulkMoveFs extends SymlinksFs {
  /** Read a UTF-8 file. */
  readFile(absPath: string): Promise<string>;
  /** Write a UTF-8 file (overwriting). */
  writeFile(absPath: string, content: string): Promise<void>;
  /** Recursively create a directory (mkdir -p). */
  mkdirRecursive(absPath: string): Promise<void>;
  /** List immediate entries under a directory. */
  list(absPath: string): Promise<string[]>;
}

/**
 * Outcome of moving a single candidate.
 *
 * - `moved` — canonical copy live, metadata stamped, symlink created.
 * - `rolledBack` — parse failure (or another recoverable error) after the
 *   move; we moved the dir back and made no canonical entry.
 * - `epermNoLink` — canonical copy kept and stamped, but the symlink at
 *   the source path could not be created (Windows Developer Mode off).
 *   The source path no longer exists; the user still has a working
 *   canonical SKILL.md and can flip the symlink on later.
 */
export type BulkMoveStatus = "moved" | "rolledBack" | "epermNoLink";

export interface BulkMoveRow {
  candidate: ImportCandidate;
  /** Final canonical name (after auto-suffix). Always set, even on rollback. */
  targetName: string;
  status: BulkMoveStatus;
  /** Human-readable reason for `rolledBack` / `epermNoLink`. */
  reason?: string;
  /**
   * Absolute path to the SKILL.md a user can open to fix this row. Set on
   * any non-`moved` status: the restored source SKILL.md on `rolledBack`
   * (so the user can fix e.g. a name/parent-dir mismatch) and the
   * surviving canonical SKILL.md on `epermNoLink`.
   */
  failingSkillMdAbsPath?: string;
}

export interface BulkMoveResult {
  results: BulkMoveRow[];
}

export interface BulkMoveOptions {
  /** Candidates to move, in any order — processed sequentially. */
  candidates: ImportCandidate[];
  /** Absolute path to `<vault>/<skills-folder>/`. */
  canonicalAbsRoot: string;
  /**
   * Names already taken in the canonical store (from a discovery pass).
   * Used as the initial collision set for auto-suffixing.
   */
  preTaken?: ReadonlyArray<string>;
  /** Injected FS. */
  fs: BulkMoveFs;
}

/**
 * Move each candidate's source directory into the canonical store, stamp
 * `metadata.copilot-enabled-agents` with the source agent, and replace the
 * source path with a symlink/junction to the canonical copy. Each row is
 * atomic per the spec — on parse failure the source is restored byte-equal
 * and no canonical entry remains.
 *
 * The function never throws for a single row — every failure is captured
 * in {@link BulkMoveRow.status}/`reason`. Catastrophic FS errors (e.g. the
 * canonical root itself can't be created) bubble up.
 */
export async function runBulkMove(options: BulkMoveOptions): Promise<BulkMoveResult> {
  const { candidates, canonicalAbsRoot, fs, preTaken = [] } = options;

  // Ensure the canonical root exists. If this fails the whole run is dead
  // in the water — let the error bubble so the caller can surface it.
  await fs.mkdirRecursive(canonicalAbsRoot);

  const taken = new Set<string>(preTaken);
  const rows: BulkMoveRow[] = [];

  for (const candidate of candidates) {
    const row = await moveOne(candidate, canonicalAbsRoot, taken, fs);
    rows.push(row);
    if (row.status !== "rolledBack") {
      taken.add(row.targetName);
    }
  }

  return { results: rows };
}

/**
 * Single-row state machine. Splits into clear phases so the rollback path
 * is straightforward.
 */
async function moveOne(
  candidate: ImportCandidate,
  canonicalAbsRoot: string,
  taken: Set<string>,
  fs: BulkMoveFs
): Promise<BulkMoveRow> {
  const targetName = suffixOnCollision(candidate.name, taken);
  const targetDir = joinPosix(canonicalAbsRoot, targetName);
  const targetSkillMd = joinPosix(targetDir, "SKILL.md");
  const sourceSkillMd = joinPosix(candidate.sourcePath, "SKILL.md");

  // 1. Move source → canonical/<targetName>/
  try {
    await renameWithRetry(candidate.sourcePath, targetDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`[skills] Failed to move ${candidate.sourcePath} → ${targetDir}: ${message}`);
    return {
      candidate,
      targetName,
      status: "rolledBack",
      reason: `Could not move directory: ${message}`,
      failingSkillMdAbsPath: sourceSkillMd,
    };
  }

  // 2. Verify SKILL.md parses, then 3. stamp metadata.
  //
  // Parse against the *original* name so the candidate's own SKILL.md
  // (which still has `name: <originalName>`) doesn't fail the
  // parent-directory-match check just because we suffixed the folder.
  // We then rewrite `name:` to the suffixed value during serialize so
  // the spec invariant holds on the canonical copy.
  let stampedContent: string;
  try {
    const raw = await fs.readFile(targetSkillMd);
    const parsed = parseSkillFile(raw, candidate.name);
    stampedContent = serializeSkillFile(parsed, {
      // If we auto-suffixed, rewrite the top-level `name:` to match the
      // new parent directory so re-parsing the canonical copy succeeds.
      ...(targetName !== candidate.name ? { name: targetName } : {}),
      // Stamp with the source agent only — imports are always single-source.
      enabledAgents: [candidate.sourceAgent],
    });
  } catch (err) {
    const reason =
      err instanceof SkillFormatError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    // Roll back the move so we leave no trace.
    try {
      await renameWithRetry(targetDir, candidate.sourcePath);
    } catch (restoreErr) {
      logError(
        `[skills] Could not roll back ${targetDir} → ${candidate.sourcePath}: ${
          restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
        }`
      );
    }
    return {
      candidate,
      targetName,
      status: "rolledBack",
      reason,
      failingSkillMdAbsPath: sourceSkillMd,
    };
  }

  try {
    await fs.writeFile(targetSkillMd, stampedContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort rollback. If writing failed, the file may be partial;
    // we still try to restore source to its original location.
    try {
      await renameWithRetry(targetDir, candidate.sourcePath);
    } catch (restoreErr) {
      logError(
        `[skills] Could not roll back after stamp failure: ${
          restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
        }`
      );
    }
    return {
      candidate,
      targetName,
      status: "rolledBack",
      reason: `Could not stamp metadata: ${message}`,
      failingSkillMdAbsPath: sourceSkillMd,
    };
  }

  // 4. Replace the source path with a symlink to the canonical copy.
  const agentDir = parentDir(candidate.sourcePath);
  const symlinkResult = await replaceAgentLink(fs, agentDir, candidate.name, targetDir);

  if (!symlinkResult.ok) {
    // EPERM: canonical stays, source path is gone (the rename consumed
    // it), no symlink. The user can re-fanout once Developer Mode is on.
    return {
      candidate,
      targetName,
      status: "epermNoLink",
      reason: symlinkResult.message,
      failingSkillMdAbsPath: targetSkillMd,
    };
  }

  return { candidate, targetName, status: "moved" };
}
