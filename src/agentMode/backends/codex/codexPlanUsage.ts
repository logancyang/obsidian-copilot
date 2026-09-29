import { requireNodeModule } from "@/utils/desktopRuntime";
import type { PlanUsageReading, UsageWindow } from "@/agentMode/session/planUsage";
import {
  planUsageReading,
  toUsagePercent,
  withoutExpiredWindows,
} from "@/agentMode/session/planUsage";
import { logInfo } from "@/logger";

// The rollout file's `rate_limits` is an undocumented internal format and the only structured
// source of Codex plan caps. Any failure reads as "unavailable" and a rollout never clears meters.
// https://github.com/logancyang/obsidian-copilot-preview/issues/193

interface CodexWindow {
  used_percent?: number | null;
  window_minutes?: number | null;
  resets_at?: number | null;
}

export interface CodexRateLimits {
  primary?: CodexWindow | null;
  secondary?: CodexWindow | null;
}

function codexWindowLabel(minutes: unknown): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes === 10_080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.round(minutes)}m`;
}

function epochSecondsToMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 1000);
}

const CODEX_WINDOWS = ["primary", "secondary"] as const;

export function planUsageFromCodexRateLimits(
  limits: CodexRateLimits | null | undefined,
  now: number = Date.now()
): PlanUsageReading {
  const windows: UsageWindow[] = [];
  for (const id of CODEX_WINDOWS) {
    const raw = limits?.[id];
    const percent = toUsagePercent(raw?.used_percent);
    const label = codexWindowLabel(raw?.window_minutes);
    if (percent === null || label === null) continue;
    windows.push({ id, label, percent, resetsAt: epochSecondsToMs(raw?.resets_at) });
  }
  return planUsageReading(windows, now);
}

const RECENT_DAY_DIRS = 7;

const MAX_ROLLOUT_CANDIDATES = 8;

const TAIL_BYTES = 256 * 1024;

function nodeFs(): typeof import("node:fs") {
  return requireNodeModule<typeof import("node:fs")>("fs");
}
function nodePath(): typeof import("node:path") {
  return requireNodeModule<typeof import("node:path")>("path");
}

export function defaultCodexHome(): string {
  const os = requireNodeModule<typeof import("node:os")>("os");
  return nodePath().join(os.homedir(), ".codex");
}

export async function readCodexPlanUsage(codexHome: string): Promise<PlanUsageReading> {
  try {
    const dirs = await recentDayDirs(nodePath().join(codexHome, "sessions"), RECENT_DAY_DIRS);
    const rollouts = await rolloutsByRecency(dirs);
    for (const rollout of rollouts.slice(0, MAX_ROLLOUT_CANDIDATES)) {
      const limits = lastRateLimits(await readTail(rollout));
      if (!limits) continue;
      const reading = planUsageFromCodexRateLimits(limits);
      if (reading.kind !== "usage") return reading;
      // A disk snapshot can be arbitrarily old. A window whose recorded reset has
      // passed describes a finished period — after a long idle it would present the
      // previous week's percentage as current — and an older rollout would only be
      // staler, so there is nothing better to fall back to
      // (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
      const current = withoutExpiredWindows(reading.planUsage);
      return current ? { kind: "usage", planUsage: current } : { kind: "unavailable" };
    }
    logInfo("[AgentMode] no Codex rollout carries rate limits; plan caps unavailable");
    return { kind: "unavailable" };
  } catch (error) {
    logInfo("[AgentMode] Codex plan cap read failed; plan caps unavailable", error);
    return { kind: "unavailable" };
  }
}

async function recentDayDirs(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  for (const year of await descendingSubdirs(root)) {
    for (const month of await descendingSubdirs(nodePath().join(root, year))) {
      for (const day of await descendingSubdirs(nodePath().join(root, year, month))) {
        out.push(nodePath().join(root, year, month, day));
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

async function descendingSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await nodeFs().promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function rolloutsByRecency(dirs: string[]): Promise<string[]> {
  const rollouts: { file: string; mtimeMs: number }[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await nodeFs().promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const file = nodePath().join(dir, name);
      try {
        const stat = await nodeFs().promises.stat(file);
        rollouts.push({ file, mtimeMs: stat.mtimeMs });
      } catch {}
    }
  }
  return rollouts.sort((a, b) => b.mtimeMs - a.mtimeMs).map((rollout) => rollout.file);
}

async function readTail(file: string): Promise<string> {
  const handle = await nodeFs().promises.open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf-8");
    if (start === 0) return text;
    const firstBreak = text.indexOf("\n");
    return firstBreak === -1 ? "" : text.slice(firstBreak + 1);
  } finally {
    await handle.close();
  }
}

export function lastRateLimits(tail: string): CodexRateLimits | null {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.includes('"rate_limits"')) continue;
    try {
      const event = JSON.parse(line) as { payload?: { rate_limits?: CodexRateLimits | null } };
      const limits = event.payload?.rate_limits;
      if (limits) return limits;
    } catch {}
  }
  return null;
}
