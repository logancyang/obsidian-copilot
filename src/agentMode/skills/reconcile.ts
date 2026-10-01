import { logWarn } from "@/logger";
import { basename, joinPosix, normalizeAbsPath, resolvesInto } from "@/utils/pathUtils";
import { mapWithConcurrency } from "./concurrency";
import { createAgentLink, removeAgentLink, replaceAgentLink, type SymlinksFs } from "./symlinks";
import type { BackendId, Skill } from "./types";

const RECONCILE_CONCURRENCY = 32;

export interface ReconcileFs extends SymlinksFs {
  list(absPath: string): Promise<string[]>;
  readlinkAbs(absPath: string): Promise<string | null>;
  readFile(absPath: string): Promise<string>;
  writeFile(absPath: string, content: string): Promise<void>;
}

export interface ReconcileReport {
  created: string[];
  removedOrphans: string[];
  errors: Array<{ path: string; reason: string }>;
}

export interface ReconcileOptions {
  skills: Skill[];
  canonicalAbsRoot: string;
  agentDirsAbs: Readonly<Record<BackendId, string>>;
  fs: ReconcileFs;
}

export async function reconcile(options: ReconcileOptions): Promise<ReconcileReport> {
  const { skills, canonicalAbsRoot, agentDirsAbs, fs } = options;

  const report: ReconcileReport = {
    created: [],
    removedOrphans: [],
    errors: [],
  };

  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));

  const forwardOps = skills.flatMap((skill) =>
    skill.enabledAgents.flatMap((agent) => {
      const agentDir = agentDirsAbs[agent];
      if (agentDir === undefined) return [];
      return [() => syncOneLink(fs, agentDir, skill)];
    })
  );
  for (const entry of await mapWithConcurrency(forwardOps, RECONCILE_CONCURRENCY, (op) => op())) {
    if (entry.created !== undefined) report.created.push(entry.created);
    if (entry.error !== undefined) report.errors.push(entry.error);
  }

  const agentEntries = await Promise.all(
    Object.entries(agentDirsAbs).map(async ([agent, agentDir]) => {
      try {
        return { agent, agentDir, entries: await fs.list(agentDir) };
      } catch {
        return { agent, agentDir, entries: [] as string[] };
      }
    })
  );

  const reverseOps = agentEntries.flatMap(({ agent, agentDir, entries }) =>
    entries.map(
      (name) => () =>
        sweepOneReverseEntry({
          fs,
          canonicalAbsRoot,
          skillByName,
          agent,
          agentDir,
          name,
        })
    )
  );

  for (const entry of await mapWithConcurrency(reverseOps, RECONCILE_CONCURRENCY, (op) => op())) {
    if (entry?.removed !== undefined) report.removedOrphans.push(entry.removed);
    if (entry?.error !== undefined) report.errors.push(entry.error);
  }

  return report;
}

interface ForwardSyncEntry {
  created?: string;
  error?: { path: string; reason: string };
}

interface ReverseSweepEntry {
  removed?: string;
  error?: { path: string; reason: string };
}

interface ReverseSweepOptions {
  fs: ReconcileFs;
  canonicalAbsRoot: string;
  skillByName: ReadonlyMap<string, Skill>;
  agent: BackendId;
  agentDir: string;
  name: string;
}

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

async function sweepOneReverseEntry(options: ReverseSweepOptions): Promise<ReverseSweepEntry> {
  const { fs, canonicalAbsRoot, skillByName, agent, agentDir, name } = options;
  if (name.endsWith(".replacing")) return {};
  const linkPath = joinPosix(agentDir, name);

  let isLink = false;
  try {
    isLink = await fs.isSymlink(linkPath);
  } catch {
    return {};
  }
  if (!isLink) return {};

  const target = await fs.readlinkAbs(linkPath);
  if (target === null) return {};

  if (!resolvesInto(target, canonicalAbsRoot)) return {};

  const basenameMatches = basename(target) === name;
  const skill = skillByName.get(name);
  if (skill !== undefined && basenameMatches && skill.enabledAgents.includes(agent)) return {};

  try {
    await removeAgentLink(fs, agentDir, name);
    return { removed: linkPath };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { error: { path: linkPath, reason } };
  }
}
