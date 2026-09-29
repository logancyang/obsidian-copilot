import { logWarn } from "@/logger";
import { basename, joinPosix } from "@/utils/pathUtils";
import { getBuiltinSkillVersion } from "./builtin/builtinOwnership";
import { ALL_MANAGED_SKILLS, RETIRED_BUILTIN_SKILLS } from "@/builtinSkills/builtinSkills";
import { mapWithConcurrency } from "./concurrency";
import { parseSkillFile, SkillFormatError } from "./skillFormat";
import type { RejectedSkill, Skill, SkillDiscoveryResult } from "./types";

const DISCOVERY_CONCURRENCY = 16;
// Retired files stay owned during cleanup retries so they are not rediscovered as custom skills. https://github.com/logancyang/obsidian-copilot/issues/3022
const BUILTIN_NAMES = new Set(
  [...ALL_MANAGED_SKILLS, ...RETIRED_BUILTIN_SKILLS].map((skill) => skill.name)
);

export interface SkillsFsAdapter {
  exists(relPath: string): Promise<boolean>;
  list(relPath: string): Promise<{ files: string[]; folders: string[] }>;
  read(relPath: string): Promise<string>;
}

export interface DiscoverManagedSkillsOptions {
  skillsFolderRelPath: string;
  skillsFolderAbsPath: string | null;
  adapter: SkillsFsAdapter;
}

export async function discoverManagedSkills(
  options: DiscoverManagedSkillsOptions
): Promise<SkillDiscoveryResult<Skill>> {
  const { skillsFolderRelPath, skillsFolderAbsPath, adapter } = options;

  if (!(await adapter.exists(skillsFolderRelPath))) {
    return { accepted: [], rejected: [] };
  }

  const listing = await adapter.list(skillsFolderRelPath);

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
        return null;
      }

      let parsed;
      try {
        parsed = parseSkillFile(content, dirName);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logWarn(`[skills] Skipping ${skillMdRelPath}: ${reason}`);
        if (err instanceof SkillFormatError) {
          return {
            name: dirName,
            filePath: absFile,
            dirPath: absDir,
            reason,
            offendingText: err.offendingText,
          };
        }
        return null;
      }

      const fm = parsed.frontmatter;

      return {
        // Copies and Markdown examples of the marker must stay visible as editable user skills. https://github.com/logancyang/obsidian-copilot/issues/3022
        builtin: BUILTIN_NAMES.has(fm.name) && getBuiltinSkillVersion(content) !== null,
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
