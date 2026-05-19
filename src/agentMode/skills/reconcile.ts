import { logWarn } from "@/logger";
import { basename, joinPosix, normalizeAbsPath, resolvesInto } from "@/utils/pathUtils";
import { createAgentLink, removeAgentLink, replaceAgentLink, type SymlinksFs } from "./symlinks";
import type { BackendId, Skill } from "./types";

/**
 * FS surface for reconciliation. Extends {@link SymlinksFs} with the bare
 * directory-listing + symlink-target reading needed to find orphan links.
 *
 * Modeled as a leaf adapter so tests can pass an in-memory FS without
 * touching disk (see AGENTS.md "Avoiding Deep Dependency Chains in Tests").
 */
export interface ReconcileFs extends SymlinksFs {
  /** List immediate entries (files + dirs + symlinks) under `absPath`. */
  list(absPath: string): Promise<string[]>;
  /**
   * Resolve a symlink at `absPath` to an absolute target. Caller has
   * already verified `absPath` is a symlink. Returns `null` on failure
   * (broken link, permission, missing target).
   */
  readlinkAbs(absPath: string): Promise<string | null>;
  /** Read a UTF-8 file. Required for toggle/delete paths that share this adapter. */
  readFile(absPath: string): Promise<string>;
  /** Write a UTF-8 file (overwriting). */
  writeFile(absPath: string, content: string): Promise<void>;
}

/**
 * Outcome of one reconciliation pass. Lists are absolute paths; `errors`
 * each carry a human-readable reason. EPERM surfaces here as a
 * `reason: "eperm"` entry (callers render the durable banner from that
 * signal).
 */
export interface ReconcileReport {
  /** Symlinks newly created or repaired by the pass. */
  created: string[];
  /** Symlinks removed as orphans (no managed skill matches). */
  removedOrphans: string[];
  /** Per-path failures. Never thrown — collected and returned. */
  errors: Array<{ path: string; reason: string }>;
}

/** Options bag for {@link reconcile}. All paths must be absolute. */
export interface ReconcileOptions {
  /** Managed skills as resolved by the latest discovery pass. */
  skills: Skill[];
  /** Absolute path of the canonical skills folder (e.g. `<vault>/copilot/skills`). */
  canonicalAbsRoot: string;
  /**
   * Absolute path of each registered backend's project-relative skills
   * directory under the vault. Built by the host from each
   * `BackendDescriptor.skillsProjectDir`; see `SkillManager`.
   */
  agentDirsAbs: Readonly<Record<BackendId, string>>;
  /** Injected FS adapter (production wires the node fs adapter). */
  fs: ReconcileFs;
}

/**
 * Single idempotent reconciliation pass. Two phases:
 *
 * 1. **Forward sync** — for each skill, for each agent in
 *    `enabledAgents`, ensure the symlink at
 *    `<vault>/.<agent>/skills/<name>` exists and points at the canonical
 *    dir. Missing → create. Pointing elsewhere → repair via
 *    {@link replaceAgentLink}.
 * 2. **Reverse sync (orphan removal)** — for each agent path, list
 *    entries and remove symlinks pointing into `canonicalAbsRoot` whose
 *    basename is not in the managed skill list. **Real directories are
 *    never touched** — they're user-owned.
 *
 * EPERM and other write errors are non-fatal: the pass continues for
 * remaining skills and surfaces the failure in {@link ReconcileReport.errors}.
 */
export async function reconcile(options: ReconcileOptions): Promise<ReconcileReport> {
  const { skills, canonicalAbsRoot, agentDirsAbs, fs } = options;

  const report: ReconcileReport = {
    created: [],
    removedOrphans: [],
    errors: [],
  };

  // Pre-index managed skills by name for the orphan-removal phase.
  const managedNames = new Set(skills.map((s) => s.name));

  // -- Phase 1: forward sync ----------------------------------------------
  // Each (skill, agent) pair is independent: launch in parallel and merge
  // results so a vault with N skills × M agents costs ~max(per-pair latency)
  // rather than the sum.
  const forwardOps = skills.flatMap((skill) =>
    skill.enabledAgents.flatMap((agent) => {
      const agentDir = agentDirsAbs[agent];
      if (agentDir === undefined) return [];
      return [syncOneLink(fs, agentDir, skill)];
    })
  );
  for (const entry of await Promise.all(forwardOps)) {
    if (entry.created !== undefined) report.created.push(entry.created);
    if (entry.error !== undefined) report.errors.push(entry.error);
  }

  // -- Phase 2: reverse sync (orphan removal) -----------------------------
  // List each agent dir in parallel — they're independent.
  const agentEntries = await Promise.all(
    Object.entries(agentDirsAbs).map(async ([agent, agentDir]) => {
      try {
        return { agent, agentDir, entries: await fs.list(agentDir) };
      } catch {
        return { agent, agentDir, entries: [] as string[] };
      }
    })
  );

  for (const { agent, agentDir, entries } of agentEntries) {
    for (const name of entries) {
      // Skip aside-during-rename markers used by replaceAgentLink.
      if (name.endsWith(".replacing")) continue;
      const linkPath = joinPosix(agentDir, name);

      let isLink = false;
      try {
        isLink = await fs.isSymlink(linkPath);
      } catch {
        // Treat unreadable lstat as non-link — never delete real dirs.
        continue;
      }
      if (!isLink) continue;

      const target = await fs.readlinkAbs(linkPath);
      if (target === null) continue;

      // Only touch links pointing into the canonical store. Anything else
      // is user-owned per the design spec.
      if (!resolvesInto(target, canonicalAbsRoot)) continue;

      // Determine the expected managed name from the link's basename. Orphan
      // = (a) basename has no matching managed skill, or (b) the link's
      // basename doesn't match its target's parent dir basename.
      const targetBase = basename(target);
      const basenameMatches = targetBase === name;
      const managed = managedNames.has(name);
      // Also ensure the matched managed skill actually enables this agent.
      const skill = skills.find((s) => s.name === name);
      const agentEnabled = skill !== undefined && skill.enabledAgents.includes(agent);

      if (managed && basenameMatches && agentEnabled) continue;

      try {
        await removeAgentLink(fs, agentDir, name);
        report.removedOrphans.push(linkPath);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        report.errors.push({ path: linkPath, reason });
      }
    }
  }

  return report;
}

/** Identifies agent paths during orphan sweep — exported for tests / docs. */
export function getAgentDirs(
  agentDirsAbs: Readonly<Record<BackendId, string>>
): Array<{ agent: BackendId; dir: string }> {
  return Object.entries(agentDirsAbs).map(([agent, dir]) => ({ agent, dir }));
}

interface ForwardSyncEntry {
  created?: string;
  error?: { path: string; reason: string };
}

/** Reconcile a single (skill, agent) slot. Returns the report deltas. */
async function syncOneLink(
  fs: ReconcileFs,
  agentDir: string,
  skill: Skill
): Promise<ForwardSyncEntry> {
  const linkPath = joinPosix(agentDir, skill.name);
  try {
    const exists = await fs.exists(linkPath);
    if (!exists) {
      const result = await createAgentLink(fs, agentDir, skill.name, skill.dirPath);
      return result.ok
        ? { created: linkPath }
        : { error: { path: linkPath, reason: result.reason } };
    }

    const isLink = await fs.isSymlink(linkPath);
    if (!isLink) {
      logWarn(`[skills] Refusing to replace real directory at ${linkPath} during reconcile`);
      return {};
    }

    const target = await fs.readlinkAbs(linkPath);
    if (target !== null && normalizeAbsPath(target) === normalizeAbsPath(skill.dirPath)) {
      return {};
    }

    const result = await replaceAgentLink(fs, agentDir, skill.name, skill.dirPath);
    return result.ok ? { created: linkPath } : { error: { path: linkPath, reason: result.reason } };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { error: { path: linkPath, reason } };
  }
}
