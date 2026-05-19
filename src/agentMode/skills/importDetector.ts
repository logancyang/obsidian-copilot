import { logWarn } from "@/logger";
import { joinPosix, resolvesInto } from "@/utils/pathUtils";
import type { BackendId, ImportCandidate } from "./types";

/**
 * Subset of `node:fs` the import detector needs. Modeled as a leaf adapter
 * so tests can supply an in-memory FS without touching disk or pulling in
 * Obsidian (see AGENTS.md — "Avoiding Deep Dependency Chains in Tests").
 *
 * Paths are absolute throughout. The detector never resolves paths itself.
 */
export interface ImportDetectorFs {
  /** Whether the path exists (any kind). */
  exists(absPath: string): Promise<boolean>;
  /** Whether the path is a directory (real or junction; not a symlink to a file). */
  isDirectory(absPath: string): Promise<boolean>;
  /** Whether the path itself is a symlink/junction (does not follow). */
  isSymlink(absPath: string): Promise<boolean>;
  /**
   * Resolve a symlink to an absolute target path. Caller has already
   * verified `absPath` is a symlink. Returns `null` if resolution fails.
   */
  readlinkAbs(absPath: string): Promise<string | null>;
  /** List immediate entries (files + dirs + symlinks) under `absPath`. */
  list(absPath: string): Promise<string[]>;
  /** Byte size of a single regular file. Returns 0 if it can't be stat'd. */
  statSize(absPath: string): Promise<number>;
}

/**
 * Candidates grouped by source backend id. Keys come from
 * `agentDirsProjectRel` — the detector never enumerates backends itself, so
 * adding a new agent flows through without edits here. Empty buckets are
 * pre-seeded for every passed-in id; callers can iterate
 * `Object.entries(result)` without nullish checks.
 */
export type ImportDetectorResult = Record<BackendId, ImportCandidate[]>;

export interface DetectImportsOptions {
  /** Absolute path to the vault root. */
  vaultRootAbsPath: string;
  /** Absolute path to the configured canonical skills folder. */
  canonicalAbsPath: string;
  /**
   * Per-agent project-relative skills directory. Built by the host from
   * each `BackendDescriptor.skillsProjectDir`; see `SkillManager`.
   */
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  /** Injected FS adapter (production wires `nodeImportDetectorFs`). */
  fs: ImportDetectorFs;
}

/**
 * Walk each registered backend's skills directory under the vault root
 * (paths supplied via `agentDirsProjectRel`, sourced from
 * `BackendDescriptor.skillsProjectDir`) and return every immediate
 * subdirectory that:
 *
 * - Is **not** a symlink/junction whose target resolves into the canonical
 *   skills folder (those are already managed).
 * - Contains a `SKILL.md` file (skills only — random folders are ignored).
 *
 * The walker tolerates missing agent dirs and per-entry IO failures: each
 * failure is logged once and skipped so a half-broken vault still produces
 * a useful candidate list for the consent card.
 */
export async function detectImportCandidates(
  options: DetectImportsOptions
): Promise<ImportDetectorResult> {
  const { vaultRootAbsPath, canonicalAbsPath, agentDirsProjectRel, fs } = options;

  const result = createEmptyImportDetectorResult(agentDirsProjectRel);

  await Promise.all(
    Object.entries(agentDirsProjectRel).map(async ([agent, relPath]) => {
      const agentDirAbs = joinPosix(vaultRootAbsPath, relPath);

      if (!(await safeExists(fs, agentDirAbs))) return;
      if (!(await safeIsDirectory(fs, agentDirAbs))) return;

      let entries: string[];
      try {
        entries = await fs.list(agentDirAbs);
      } catch (err) {
        logWarn(
          `[skills] Could not list ${agentDirAbs}: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }

      for (const name of entries.sort()) {
        const entryAbs = joinPosix(agentDirAbs, name);

        // Skip symlinks pointing back into the canonical folder — these
        // are the fanout links and shouldn't be re-imported.
        let isLink = false;
        try {
          isLink = await fs.isSymlink(entryAbs);
        } catch {
          // Treat unreadable lstat as "not a link" and let isDirectory decide.
        }
        if (isLink) {
          const target = await fs.readlinkAbs(entryAbs).catch(() => null);
          if (target !== null && resolvesInto(target, canonicalAbsPath)) {
            continue;
          }
          // Symlink pointing elsewhere — also skip; reconciliation
          // handles the user-owned-symlink case.
          continue;
        }

        if (!(await safeIsDirectory(fs, entryAbs))) continue;

        const skillMd = joinPosix(entryAbs, "SKILL.md");
        if (!(await safeExists(fs, skillMd))) continue;

        const { fileCount, totalBytes } = await summariseDir(fs, entryAbs);

        result[agent].push({
          name,
          sourceAgent: agent,
          sourcePath: entryAbs,
          fileCount,
          totalBytes,
        });
      }
    })
  );

  return result;
}

/** Total candidate count across every registered backend bucket. */
export function totalCandidates(result: ImportDetectorResult): number {
  return Object.values(result).reduce((sum, candidates) => sum + candidates.length, 0);
}

/** Build an empty detector result with a bucket for every registered backend. */
export function createEmptyImportDetectorResult(
  agentDirsProjectRel: Readonly<Record<BackendId, string>>
): ImportDetectorResult {
  const result: ImportDetectorResult = {};
  for (const agent of Object.keys(agentDirsProjectRel)) {
    result[agent] = [];
  }
  return result;
}

async function safeExists(fs: ImportDetectorFs, abs: string): Promise<boolean> {
  try {
    return await fs.exists(abs);
  } catch {
    return false;
  }
}

async function safeIsDirectory(fs: ImportDetectorFs, abs: string): Promise<boolean> {
  try {
    return await fs.isDirectory(abs);
  } catch {
    return false;
  }
}

/**
 * Shallow walk of `dirAbs`: counts immediate files (not subdirs) and
 * accumulates their byte sizes. Errors on individual entries are swallowed
 * — the meta line is decorative; partial counts are better than no meta.
 */
async function summariseDir(
  fs: ImportDetectorFs,
  dirAbs: string
): Promise<{ fileCount: number; totalBytes: number }> {
  let fileCount = 0;
  let totalBytes = 0;
  let entries: string[];
  try {
    entries = await fs.list(dirAbs);
  } catch {
    return { fileCount, totalBytes };
  }
  for (const name of entries) {
    const entryAbs = joinPosix(dirAbs, name);
    const isDir = await safeIsDirectory(fs, entryAbs);
    if (isDir) continue;
    fileCount += 1;
    try {
      totalBytes += await fs.statSize(entryAbs);
    } catch {
      // ignore size failure — keep the count
    }
  }
  return { fileCount, totalBytes };
}
