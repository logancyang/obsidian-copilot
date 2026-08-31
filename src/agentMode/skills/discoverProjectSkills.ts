import { logWarn } from "@/logger";
import { joinPosix } from "@/utils/pathUtils";
import { computeDirHash, type DirHashFs } from "./dirHash";
import { parseSkillFile, SkillFormatError, type ParsedSkillFile } from "./skillFormat";
import type { BackendId, RejectedSkill, SkillDiscoveryResult } from "./types";

/**
 * Subset of `node:fs` consumed by {@link discoverProjectSkills}. Mirrors
 * the shape used by `importDetector.ts` (the predecessor) plus the read
 * surface needed to parse SKILL.md and fingerprint the dir contents.
 *
 * Paths are absolute throughout. Modeled as a leaf adapter so unit tests
 * can supply an in-memory FS without touching disk (see AGENTS.md
 * "Avoiding Deep Dependency Chains in Tests").
 */
export interface ProjectDiscoveryFs extends DirHashFs {
  /** Whether the path exists (any kind). */
  exists(absPath: string): Promise<boolean>;
}

/**
 * One project-managed skill candidate discovered under a single agent's
 * `<vault>/.<agent>/skills/<name>/` directory. The merge layer
 * (`mergeDiscovery.ts`) folds candidates with the same `name` + same
 * `contentHash` into a single mirrored row.
 */
export interface ProjectSkillCandidate {
  /** Source agent — the folder owning this real directory. */
  agent: BackendId;
  /** Skill name (parent directory basename, also `frontmatter.name`). */
  name: string;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
  /** Absolute path to the skill directory. */
  dirPath: string;
  /** Recursive content hash of the directory; drives the mirrored-merge rule. */
  contentHash: string;
  /** Parsed SKILL.md (frontmatter + body). */
  parsed: ParsedSkillFile;
}

type ProjectDiscoveryEntry = ProjectSkillCandidate | RejectedSkill | null;

/** Options bag for {@link discoverProjectSkills}. All paths are absolute. */
export interface DiscoverProjectSkillsOptions {
  /** Absolute path to the vault root. */
  vaultRootAbsPath: string;
  /**
   * Project-relative POSIX path of each registered agent's skills
   * directory (sourced from `BackendDescriptor.skillsProjectDir`).
   */
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  /** Injected FS adapter. */
  fs: ProjectDiscoveryFs;
}

/**
 * Walk every registered agent's `.<agent>/skills/` directory and return
 * every immediate subdirectory that:
 *
 *   - Is a real directory (not a symlink — symlinks pointing into the
 *     canonical store are reconciliation links; symlinks pointing
 *     elsewhere are user-owned and already covered by reconciliation).
 *   - Contains a `SKILL.md` that parses against the Agent Skills spec.
 *
 * Each accepted result carries the parsed frontmatter + a recursive content hash
 * so the merge layer can collapse identical duplicates across agents
 * into one row. Format failures are returned separately for user recovery
 * and emit a single `logWarn` (mirrors `discoverManagedSkills` behavior).
 */
export async function discoverProjectSkills(
  options: DiscoverProjectSkillsOptions
): Promise<SkillDiscoveryResult<ProjectSkillCandidate>> {
  const { vaultRootAbsPath, agentDirsProjectRel, fs } = options;

  const accepted: ProjectSkillCandidate[] = [];
  const rejected: RejectedSkill[] = [];

  await Promise.all(
    Object.entries(agentDirsProjectRel).map(async ([agent, projectRel]) => {
      const agentDirAbs = joinPosix(vaultRootAbsPath, projectRel);
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

      const candidates = await Promise.all(
        entries.sort().map(async (name): Promise<ProjectDiscoveryEntry> => {
          const entryAbs = joinPosix(agentDirAbs, name);

          // Symlinks at the top level — never include. Reconciliation
          // already handles user-owned symlinks; symlinks into the
          // canonical store are represented by the canonical row.
          let isLink = false;
          try {
            isLink = await fs.isSymlink(entryAbs);
          } catch {
            // Treat unreadable lstat as "not a link" and let isDirectory decide.
          }
          if (isLink) return null;

          if (!(await safeIsDirectory(fs, entryAbs))) return null;

          const skillMd = joinPosix(entryAbs, "SKILL.md");
          if (!(await safeExists(fs, skillMd))) return null;

          let content: string;
          try {
            content = await fs.readFile(skillMd);
          } catch {
            return null;
          }

          let parsed: ParsedSkillFile;
          try {
            parsed = parseSkillFile(content, name);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            logWarn(`[skills] Skipping ${skillMd}: ${reason}`);
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
            // Hidden agent folders are not indexed by Obsidian, so Settings must
            // retain their format failures to offer an external-editor recovery.
            if (err instanceof SkillFormatError) {
              return {
                name,
                filePath: skillMd,
                dirPath: entryAbs,
                reason,
                suggestion: err.suggestion,
              };
            }
            return null;
          }

          const contentHash = await computeDirHash(entryAbs, fs);

          const candidate: ProjectSkillCandidate = {
            agent,
            name,
            filePath: skillMd,
            dirPath: entryAbs,
            contentHash,
            parsed,
          };
          return candidate;
        })
      );

      for (const result of candidates) {
        if (result === null) continue;
        if ("reason" in result) rejected.push(result);
        else accepted.push(result);
      }
    })
  );

  return { accepted, rejected };
}

async function safeExists(fs: ProjectDiscoveryFs, abs: string): Promise<boolean> {
  try {
    return await fs.exists(abs);
  } catch {
    return false;
  }
}

async function safeIsDirectory(fs: ProjectDiscoveryFs, abs: string): Promise<boolean> {
  try {
    return await fs.isDirectory(abs);
  } catch {
    return false;
  }
}
