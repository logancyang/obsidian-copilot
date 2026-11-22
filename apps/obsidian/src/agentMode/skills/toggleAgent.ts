import { logError, logWarn } from "@/logger";
import { parseSkillFile, serializeSkillFile } from "./skillFormat";
import {
  removeAgentLink,
  removeAgentLinksPointingTo,
  replaceAgentLink,
  type LinkSweepFs,
  type SymlinkResult,
} from "./symlinks";
import type { BackendId, Skill } from "./types";

export interface ToggleAgentFs {
  exists(absPath: string): Promise<boolean>;
  isDirectory(absPath: string): Promise<boolean>;
  isSymlink(absPath: string): Promise<boolean>;
  symlink(target: string, linkPath: string): Promise<void>;
  unlink(absPath: string): Promise<void>;
  rmRecursive(absPath: string): Promise<void>;
  readFile(absPath: string): Promise<string>;
  writeFile(absPath: string, content: string): Promise<void>;
}

export type DeleteSkillFs = ToggleAgentFs & LinkSweepFs;

export type ToggleAgentResult = { ok: true } | { ok: false; reason: string };

export interface ToggleAgentOptions {
  skill: Skill;
  agent: BackendId;
  enabled: boolean;
  agentDirAbs: string;
  fs: ToggleAgentFs;
}

export async function runToggleAgent(options: ToggleAgentOptions): Promise<ToggleAgentResult> {
  const { skill, agent, enabled, agentDirAbs: agentDir, fs } = options;

  const nextAgents = computeNextAgents(skill.enabledAgents, agent, enabled);

  try {
    const raw = await fs.readFile(skill.filePath);
    const parsed = parseSkillFile(raw, skill.name);
    const stamped = serializeSkillFile(parsed, { enabledAgents: nextAgents });
    await fs.writeFile(skill.filePath, stamped);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] toggleAgent: failed to rewrite ${skill.filePath}`, err);
    return { ok: false, reason };
  }

  if (enabled) {
    const result: SymlinkResult = await replaceAgentLink(fs, agentDir, skill.name, skill.dirPath);
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true };
  }

  try {
    await removeAgentLink(fs, agentDir, skill.name);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logWarn(`[skills] toggleAgent: failed to remove link: ${reason}`);
    return { ok: false, reason };
  }
  return { ok: true };
}

export interface DeleteSkillOptions {
  skill: Skill;
  agentDirsAbs: Readonly<Record<BackendId, string>>;
  fs: DeleteSkillFs;
}

export async function runDeleteSkill(
  options: DeleteSkillOptions
): Promise<{ ok: boolean; reason?: string }> {
  const { skill, agentDirsAbs, fs } = options;

  await Promise.all(
    skill.enabledAgents.map(async (agent) => {
      const agentDir = agentDirsAbs[agent];
      if (agentDir === undefined) return;
      try {
        await removeAgentLink(fs, agentDir, skill.name);
      } catch (err) {
        logWarn(
          `[skills] deleteSkill: failed to remove link for ${agent}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  const sweep = await removeAgentLinksPointingTo(fs, agentDirsAbs, skill.dirPath);
  for (const error of sweep.errors) {
    logWarn(`[skills] deleteSkill: failed to remove stale link ${error.path}: ${error.reason}`);
  }

  try {
    await fs.rmRecursive(skill.dirPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] deleteSkill: failed to remove ${skill.dirPath}`, err);
    return { ok: false, reason };
  }
  return { ok: true };
}

function computeNextAgents(current: BackendId[], agent: BackendId, enabled: boolean): BackendId[] {
  const has = current.includes(agent);
  if (enabled && !has) return [...current, agent];
  if (!enabled && has) return current.filter((a) => a !== agent);
  return current;
}
