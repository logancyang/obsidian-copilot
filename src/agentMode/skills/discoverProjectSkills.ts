import { logWarn } from "@/logger";
import { joinPosix } from "@/utils/pathUtils";
import { computeDirHash, type DirHashFs } from "./dirHash";
import { parseSkillFile, SkillFormatError, type ParsedSkillFile } from "./skillFormat";
import type { BackendId, RejectedSkill, SkillDiscoveryResult } from "./types";

export interface ProjectDiscoveryFs extends DirHashFs {
  exists(absPath: string): Promise<boolean>;
}

export interface ProjectSkillCandidate {
  agent: BackendId;
  name: string;
  filePath: string;
  dirPath: string;
  contentHash: string;
  parsed: ParsedSkillFile;
}

type ProjectDiscoveryEntry = ProjectSkillCandidate | RejectedSkill | null;

export interface DiscoverProjectSkillsOptions {
  vaultRootAbsPath: string;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  fs: ProjectDiscoveryFs;
}

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

          let isLink = false;
          try {
            isLink = await fs.isSymlink(entryAbs);
          } catch {}
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
            // Hidden agent folders are not indexed by Obsidian, so Settings must keep their
            // format failures to offer external-editor recovery. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
            if (err instanceof SkillFormatError) {
              return {
                name,
                filePath: skillMd,
                dirPath: entryAbs,
                reason,
                offendingText: err.offendingText,
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
