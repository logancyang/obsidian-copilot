import { logError, logWarn } from "@/logger";
import { parseSkillFile, serializeSkillFile } from "./skillFormat";
import { removeAgentLink, replaceAgentLink, type SymlinkResult } from "./symlinks";
import type { BackendId, Skill } from "./types";

/**
 * FS surface for {@link runToggleAgent}. Mirrors the read/write subset of
 * {@link ReconcileFs} that's actually needed for a toggle pass — kept
 * separate so tests can construct a tiny in-memory adapter without
 * pulling in the full reconcile fixture.
 */
export interface ToggleAgentFs {
  /** Does the path exist (any kind)? */
  exists(absPath: string): Promise<boolean>;
  /** Is the path a directory (real or junction)? */
  isDirectory(absPath: string): Promise<boolean>;
  /** Is the path itself a symlink/junction? */
  isSymlink(absPath: string): Promise<boolean>;
  /** Create a directory symlink/junction. May throw with code "EPERM". */
  symlink(target: string, linkPath: string): Promise<void>;
  /** Remove a symlink/junction. No-op when missing. */
  unlink(absPath: string): Promise<void>;
  /** Recursively remove a real directory. */
  rmRecursive(absPath: string): Promise<void>;
  /** Read a UTF-8 file. */
  readFile(absPath: string): Promise<string>;
  /** Write a UTF-8 file (overwriting). */
  writeFile(absPath: string, content: string): Promise<void>;
}

/** Discriminated result identical to {@link SymlinkResult}, re-exported for callers. */
export type ToggleAgentResult = { ok: true } | { ok: false; reason: string };

/** Options for {@link runToggleAgent}. */
export interface ToggleAgentOptions {
  skill: Skill;
  agent: BackendId;
  enabled: boolean;
  /** Absolute path of this agent's project skills directory. */
  agentDirAbs: string;
  fs: ToggleAgentFs;
}

/**
 * Pure-fs core of `SkillManager.toggleAgent`. Two steps:
 *
 * 1. Rewrite `metadata.copilot-enabled-agents` in the canonical SKILL.md.
 *    On failure, return early — the source of truth never goes stale.
 * 2. Create or remove the agent's symlink. EPERM bubbles up as
 *    `{ ok: false, reason: 'eperm' }`; the frontmatter is **not** rolled
 *    back so reconciliation can heal the link on a future pass once the
 *    user enables Windows Developer Mode.
 */
export async function runToggleAgent(options: ToggleAgentOptions): Promise<ToggleAgentResult> {
  const { skill, agent, enabled, agentDirAbs: agentDir, fs } = options;

  const nextAgents = computeNextAgents(skill.enabledAgents, agent, enabled);

  // Step 1 — update SKILL.md (source of truth).
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

  // Step 2 — create / remove the symlink.
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

/** Options for {@link runDeleteSkill}. */
export interface DeleteSkillOptions {
  skill: Skill;
  /** Absolute path of each registered agent's project skills directory. */
  agentDirsAbs: Readonly<Record<BackendId, string>>;
  fs: ToggleAgentFs;
}

/**
 * Pure-fs core of `SkillManager.deleteSkill`. Removes every enabled
 * agent's symlink first (so any orphan-sweep race sees no dangling
 * links), then rms the canonical directory recursively. Symlink-removal
 * failures are non-fatal — they're logged but don't block the rm.
 */
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

  try {
    await fs.rmRecursive(skill.dirPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] deleteSkill: failed to remove ${skill.dirPath}`, err);
    return { ok: false, reason };
  }
  return { ok: true };
}

/**
 * Compute the new `enabledAgents` list when toggling `agent`. Preserves
 * the order of unaffected agents so the canonical SKILL.md rewrite stays
 * diff-friendly.
 */
function computeNextAgents(current: BackendId[], agent: BackendId, enabled: boolean): BackendId[] {
  const has = current.includes(agent);
  if (enabled && !has) return [...current, agent];
  if (!enabled && has) return current.filter((a) => a !== agent);
  return current;
}
