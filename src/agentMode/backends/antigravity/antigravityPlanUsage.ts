import type { PlanUsage, UsageWindow } from "@/agentMode/session/planUsage";
import { toUsagePercent } from "@/agentMode/session/planUsage";
import { logInfo } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

const USAGE_READ_TIMEOUT_MS = 30_000;

const WINDOW_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "5h": "5h",
  weekly: "Weekly",
});

export interface AntigravityQuotaGroup {
  name: string;
  modelFamilies: string[];
  windows: UsageWindow[];
}

interface UsageBucket {
  id?: unknown;
  window?: unknown;
  remaining_fraction?: unknown;
  reset_time?: unknown;
}

interface UsageGroup {
  name?: unknown;
  description?: unknown;
  buckets?: unknown;
}

function bucketWindow(bucket: UsageBucket): UsageWindow | null {
  const remaining = toUsagePercent(bucket.remaining_fraction);
  if (typeof bucket.id !== "string" || typeof bucket.window !== "string" || remaining === null) {
    return null;
  }
  const resetsAt = typeof bucket.reset_time === "string" ? Date.parse(bucket.reset_time) : NaN;
  return {
    id: bucket.id,
    label: WINDOW_LABELS[bucket.window] ?? bucket.window,
    percent: Math.max(0, Math.round((1 - remaining) * 1000) / 10),
    ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
  };
}

function modelFamilies(description: unknown): string[] {
  if (typeof description !== "string") return [];
  const list = description.split(":")[1];
  if (!list) return [];
  return list
    .split(",")
    .map((family) => family.trim().toLowerCase())
    .filter((family) => family.length > 0);
}

export function parseAntigravityQuotaGroups(stdout: string): AntigravityQuotaGroup[] | null {
  let parsed: { command?: { data?: { groups?: unknown } } };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const groups = parsed.command?.data?.groups;
  if (!Array.isArray(groups)) return null;
  return groups.flatMap((group: UsageGroup): AntigravityQuotaGroup[] => {
    if (typeof group?.name !== "string" || !Array.isArray(group.buckets)) return [];
    const windows = (group.buckets as UsageBucket[])
      .map(bucketWindow)
      .filter((window): window is UsageWindow => window !== null);
    return windows.length > 0
      ? [{ name: group.name, modelFamilies: modelFamilies(group.description), windows }]
      : [];
  });
}

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "-");
}

function familyMatches(family: string, wireModelId: string): boolean {
  return family.split(/\s+/).every((word) => wireModelId.includes(word));
}

export function quotaGroupForModel(
  groups: ReadonlyArray<AntigravityQuotaGroup>,
  wireModelId: string | null | undefined
): AntigravityQuotaGroup | null {
  if (!wireModelId) return null;
  const id = wireModelId.toLowerCase();
  return (
    groups.find((group) => slug(group.name) === id) ??
    groups.find((group) => group.modelFamilies.some((family) => familyMatches(family, id))) ??
    null
  );
}

export function planUsageForModel(
  planUsage: PlanUsage,
  groups: ReadonlyArray<AntigravityQuotaGroup>,
  wireModelId: string | null | undefined
): PlanUsage | null {
  const group = quotaGroupForModel(groups, wireModelId);
  if (!group) return null;
  const ids = new Set(group.windows.map((window) => window.id));
  const windows = planUsage.windows.filter((window) => ids.has(window.id));
  return windows.length > 0 ? { ...planUsage, windows } : null;
}

export async function readAntigravityQuotaGroups(
  binaryPath: string,
  env: NodeJS.ProcessEnv
): Promise<AntigravityQuotaGroup[] | null> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  try {
    const { stdout } = await promisify(execFile)(
      binaryPath,
      ["-p", "/usage", "--output-format", "json"],
      { timeout: USAGE_READ_TIMEOUT_MS, env }
    );
    return parseAntigravityQuotaGroups(stdout);
  } catch (error) {
    logInfo("[AgentMode] Antigravity plan usage read failed; plan caps unavailable", error);
    return null;
  }
}
