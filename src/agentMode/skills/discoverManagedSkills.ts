import { logWarn } from "@/logger";
import { basename, joinPosix } from "@/utils/pathUtils";
import { mapWithConcurrency } from "./concurrency";
import { parseSkillFile, SkillFormatError } from "./skillFormat";
import type { RejectedSkill, Skill, SkillDiscoveryResult } from "./types";

/** Maximum concurrent SKILL.md reads during discovery. */
const DISCOVERY_CONCURRENCY = 16;

/**
 * Minimal adapter the discovery walker depends on. Modelled after
 * `Vault.adapter`'s shape but reduced to the surface this leaf module
 * actually uses, so unit tests can supply a plain object without mocking
 * the entire Obsidian surface (see AGENTS.md — "Avoiding Deep Dependency
 * Chains in Tests").
 */
export interface SkillsFsAdapter {
  /** Whether the path exists. Vault-relative POSIX paths. */
  exists(relPath: string): Promise<boolean>;
  /** List `{files, folders}` at the given vault-relative POSIX directory. */
  list(relPath: string): Promise<{ files: string[]; folders: string[] }>;
  /** Read a UTF-8 file at the given vault-relative POSIX path. */
  read(relPath: string): Promise<string>;
}

/**
 * Options for {@link discoverManagedSkills}. Receives concrete values rather
 * than reaching into Obsidian globals so it stays trivially testable.
 */
export interface DiscoverManagedSkillsOptions {
  /** Vault-relative POSIX path of the configured skills folder. */
  skillsFolderRelPath: string;
  /**
   * Absolute path to the same folder on disk. Used to populate
   * {@link Skill.dirPath} / {@link Skill.filePath}. Pass `null` when the
   * caller has no `FileSystemAdapter` (jsdom test environment, mobile);
   * absolute fields fall back to vault-relative paths.
   */
  skillsFolderAbsPath: string | null;
  /** FS adapter used to walk the folder. */
  adapter: SkillsFsAdapter;
}

/**
 * Walk `<vault>/<skillsFolder>/` once and classify every readable SKILL.md
 * as accepted or rejected by the Agent Skills spec.
 *
 * Subdirectories without a `SKILL.md` are silently ignored — they may be
 * staging dirs or supporting-asset folders. Format failures are returned for
 * user recovery and also emit a one-line `logWarn`; unexpected failures are
 * logged and skipped rather than thrown.
 */
export async function discoverManagedSkills(
  options: DiscoverManagedSkillsOptions
): Promise<SkillDiscoveryResult<Skill>> {
  const { skillsFolderRelPath, skillsFolderAbsPath, adapter } = options;

  if (!(await adapter.exists(skillsFolderRelPath))) {
    return { accepted: [], rejected: [] };
  }

  const listing = await adapter.list(skillsFolderRelPath);

  // Subdirectory paths come back as full vault-relative paths from
  // `adapter.list` (e.g. `copilot/skills/foo`). Sort for stable ordering
  // so the UI doesn't reshuffle on every reload.
  const results = await mapWithConcurrency(
    [...listing.folders].sort(),
    DISCOVERY_CONCURRENCY,
    async (folderPath): Promise<Skill | RejectedSkill | null> => {
      const dirName = basename(folderPath);
      const skillMdRelPath = joinPosix(folderPath, "SKILL.md");
      const absDir =
        skillsFolderAbsPath !== null ? joinPosix(skillsFolderAbsPath, dirName) : folderPath;
      const absFile = joinPosix(absDir, "SKILL.md");

      let content: string;
      try {
        content = await adapter.read(skillMdRelPath);
      } catch {
        // Missing SKILL.md is expected — many subdirs are staging or asset
        // folders. Read failure on an existing file is the same surface from
        // Obsidian's adapter, so we can't distinguish; either way, skip.
        return null;
      }

      let parsed;
      try {
        parsed = parseSkillFile(content, dirName);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logWarn(`[skills] Skipping ${skillMdRelPath}: ${reason}`);
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
        // Preserve expected format failures so Settings can name the file and repair.
        if (err instanceof SkillFormatError) {
          return {
            name: dirName,
            filePath: absFile,
            dirPath: absDir,
            reason,
            offendingText: err.offendingText,
            suggestion: err.suggestion,
          };
        }
        return null;
      }

      const fm = parsed.frontmatter;

      return {
        name: fm.name,
        description: fm.description,
        filePath: absFile,
        dirPath: absDir,
        body: parsed.body,
        license: fm.license,
        compatibility: fm.compatibility,
        allowedTools: fm.allowedTools,
        model: fm.model,
        disableModelInvocation: fm.disableModelInvocation,
        userInvocable: fm.userInvocable,
        enabledAgents: fm.enabledAgents,
        location: { kind: "canonical" },
      };
    }
  );

  const accepted: Skill[] = [];
  const rejected: RejectedSkill[] = [];
  for (const result of results) {
    if (result === null) continue;
    if ("reason" in result) rejected.push(result);
    else accepted.push(result);
  }
  return { accepted, rejected };
}
