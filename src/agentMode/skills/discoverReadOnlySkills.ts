import { logWarn } from "@/logger";
import { errCode } from "@/utils/errorUtils";
import { joinPosix, normalizeAbsPath, resolvesInto } from "@/utils/pathUtils";
import { readSkillSummary } from "./skillFormat";
import type { BackendId, ReadOnlySkill, ReadOnlySkillRoot } from "./types";

export interface ReadOnlyDiscoveryFs {
  list(absPath: string): Promise<string[]>;
  isSymlink(absPath: string): Promise<boolean>;
  isDirectory(absPath: string): Promise<boolean>;
  realpath(absPath: string): Promise<string>;
  readFile(absPath: string): Promise<string>;
}

export interface AgentSkillFolders {
  id: BackendId;
  skillsProjectDir: string;
  crossDiscoveredAgents: ReadonlyArray<BackendId>;
  userSkillsDirs: ReadonlyArray<string>;
}

export interface DiscoverReadOnlySkillsOptions {
  roots: ReadonlyArray<ReadOnlySkillRoot>;
  excludedDirs: ReadonlyArray<string>;
  fs: ReadOnlyDiscoveryFs;
}

export function collectReadOnlySkillRoots(
  agents: ReadonlyArray<AgentSkillFolders>,
  vaultRootAbs: string | null
): ReadOnlySkillRoot[] {
  const byDir = new Map<string, ReadOnlySkillRoot>();
  const add = (
    dirPath: string,
    agentIds: readonly BackendId[],
    scope: ReadOnlySkillRoot["scope"]
  ) => {
    const key = normalizeAbsPath(dirPath);
    const existing = byDir.get(key);
    byDir.set(key, {
      dirPath: key,
      agents: unique([...(existing?.agents ?? []), ...agentIds]),
      scope,
    });
  };
  for (const agent of agents) {
    for (const dir of agent.userSkillsDirs) add(dir, [agent.id], "computer");
    if (vaultRootAbs === null) continue;
    const readers = agents.filter((other) => other.crossDiscoveredAgents.includes(agent.id));
    add(
      joinPosix(vaultRootAbs, agent.skillsProjectDir),
      [agent.id, ...readers.map((reader) => reader.id)],
      "vault"
    );
  }
  return Array.from(byDir.values());
}

export async function discoverReadOnlySkills(
  options: DiscoverReadOnlySkillsOptions
): Promise<ReadOnlySkill[]> {
  const { roots, excludedDirs, fs } = options;
  const found = await Promise.all(roots.map((root) => discoverRoot(root, excludedDirs, fs)));
  const byDir = new Map<string, ReadOnlySkill>();
  for (const skill of found.flat()) {
    const key = `${skill.scope}\u0000${skill.dirPath}`;
    const existing = byDir.get(key);
    byDir.set(
      key,
      existing === undefined
        ? skill
        : {
            ...existing,
            agents: unique([...existing.agents, ...skill.agents]),
            folders: unique([...existing.folders, ...skill.folders]),
          }
    );
  }
  return Array.from(byDir.values()).sort(
    (a, b) => a.name.localeCompare(b.name) || a.dirPath.localeCompare(b.dirPath)
  );
}

async function discoverRoot(
  root: ReadOnlySkillRoot,
  excludedDirs: ReadonlyArray<string>,
  fs: ReadOnlyDiscoveryFs
): Promise<ReadOnlySkill[]> {
  let entries: string[];
  try {
    entries = await fs.list(root.dirPath);
  } catch (err) {
    warnUnlessMissing(`list ${root.dirPath}`, err);
    return [];
  }
  const skills = await Promise.all(
    entries
      .filter((entry) => !entry.startsWith("."))
      .map(async (entry) => {
        try {
          return await readEntry(root, entry, excludedDirs, fs);
        } catch (err) {
          warnUnlessMissing(`read ${joinPosix(root.dirPath, entry)}`, err);
          return null;
        }
      })
  );
  return skills.filter((skill): skill is ReadOnlySkill => skill !== null);
}

async function readEntry(
  root: ReadOnlySkillRoot,
  entry: string,
  excludedDirs: ReadonlyArray<string>,
  fs: ReadOnlyDiscoveryFs
): Promise<ReadOnlySkill | null> {
  const entryPath = joinPosix(root.dirPath, entry);
  // Real folders in the vault's agent folders are already editable project skills; only links
  // to skills kept elsewhere are missing. https://github.com/logancyang/obsidian-copilot/issues/3659
  if (root.scope === "vault" && !(await fs.isSymlink(entryPath))) return null;
  const dirPath = normalizeAbsPath(await fs.realpath(entryPath));
  if (excludedDirs.some((excluded) => resolvesInto(dirPath, excluded))) return null;
  if (!(await fs.isDirectory(dirPath))) return null;
  const filePath = joinPosix(dirPath, "SKILL.md");
  const summary = readSkillSummary(await fs.readFile(filePath), entry);
  return {
    ...summary,
    filePath,
    dirPath,
    folders: [root.dirPath],
    agents: [...root.agents],
    scope: root.scope,
  };
}

// A folder an agent cannot read must leave the list empty, never stop the agent from starting.
// https://github.com/logancyang/obsidian-copilot/issues/3659
function warnUnlessMissing(action: string, err: unknown): void {
  if (errCode(err) === "ENOENT") return;
  logWarn(`[skills] Could not ${action}: ${err instanceof Error ? err.message : String(err)}`);
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
