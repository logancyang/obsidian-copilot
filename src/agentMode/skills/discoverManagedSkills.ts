import { logWarn } from "@/logger";
import { basename, joinPosix } from "@/utils/pathUtils";
import { parseSkillFile, SkillFormatError } from "./skillFormat";
import type { Skill } from "./types";

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
 * Walk `<vault>/<skillsFolder>/` once and return every SKILL.md that
 * parses against the Agent Skills spec.
 *
 * Subdirectories without a `SKILL.md` are silently ignored — they may be
 * staging dirs or supporting-asset folders. Parse failures emit a one-line
 * `logWarn` with the path and reason but never throw.
 */
export async function discoverManagedSkills(
  options: DiscoverManagedSkillsOptions
): Promise<Skill[]> {
  const { skillsFolderRelPath, skillsFolderAbsPath, adapter } = options;

  if (!(await adapter.exists(skillsFolderRelPath))) {
    return [];
  }

  const listing = await adapter.list(skillsFolderRelPath);
  const skills: Skill[] = [];

  // Subdirectory paths come back as full vault-relative paths from
  // `adapter.list` (e.g. `copilot/skills/foo`). Sort for stable ordering
  // so the UI doesn't reshuffle on every reload.
  for (const folderPath of [...listing.folders].sort()) {
    const dirName = basename(folderPath);
    const skillMdRelPath = joinPosix(folderPath, "SKILL.md");

    let content: string;
    try {
      content = await adapter.read(skillMdRelPath);
    } catch {
      // Missing SKILL.md is expected — many subdirs are staging or asset
      // folders. Read failure on an existing file is the same surface from
      // Obsidian's adapter, so we can't distinguish; either way, skip.
      continue;
    }

    let parsed;
    try {
      parsed = parseSkillFile(content, dirName);
    } catch (err) {
      const reason =
        err instanceof SkillFormatError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      logWarn(`[skills] Skipping ${skillMdRelPath}: ${reason}`);
      continue;
    }

    const fm = parsed.frontmatter;
    const absDir =
      skillsFolderAbsPath !== null ? joinPosix(skillsFolderAbsPath, dirName) : folderPath;
    const absFile = joinPosix(absDir, "SKILL.md");

    skills.push({
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
    });
  }

  return skills;
}
