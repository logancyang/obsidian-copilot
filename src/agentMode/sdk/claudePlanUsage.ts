import type { PlanUsageReading, UsageWindow } from "@/agentMode/session/planUsage";
import { planUsageReading, toUsagePercent } from "@/agentMode/session/planUsage";
import { logInfo } from "@/logger";

const USAGE_METHOD = "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET" as const;

type UsageCapableQuery = {
  [USAGE_METHOD]?: () => Promise<unknown>;
};

interface ClaudeWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

interface ClaudeModelScopedWindow extends ClaudeWindow {
  display_name?: string | null;
}

export interface ClaudeUsageSnapshot {
  rate_limits_available?: boolean;
  rate_limits?: {
    five_hour?: ClaudeWindow | null;
    seven_day?: ClaudeWindow | null;
    seven_day_oauth_apps?: ClaudeWindow | null;
    seven_day_opus?: ClaudeWindow | null;
    seven_day_sonnet?: ClaudeWindow | null;
    model_scoped?: ClaudeModelScopedWindow[] | null;
  } | null;
}

// Legacy plans deliver per-model weekly limits as `seven_day_opus`/`seven_day_sonnet`, not
// `model_scoped`; omitting them would leave those users unwarned. https://github.com/logancyang/obsidian-copilot-preview/issues/193
const CLAUDE_WINDOWS = [
  ["five_hour", "5h"],
  ["seven_day", "Weekly"],
  ["seven_day_oauth_apps", "Weekly (OAuth apps)"],
  ["seven_day_opus", "Weekly (Opus)"],
  ["seven_day_sonnet", "Weekly (Sonnet)"],
] as const;

export function isoToEpochMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function claudeWindow(
  id: string,
  label: string,
  raw: ClaudeWindow | null | undefined
): UsageWindow | null {
  if (!raw) return null;
  const percent = toUsagePercent(raw.utilization);
  if (percent === null) return null;
  return { id, label, percent, resetsAt: isoToEpochMs(raw.resets_at) };
}

export function planUsageFromClaudeUsage(
  snapshot: ClaudeUsageSnapshot | null | undefined,
  now: number = Date.now()
): PlanUsageReading {
  // Only an explicit `false` clears meters; any other empty answer is an unusable read. https://github.com/logancyang/obsidian-copilot-preview/issues/193
  if (snapshot?.rate_limits_available === false) return { kind: "none" };
  const limits = snapshot?.rate_limits;
  if (!limits) return { kind: "unavailable" };

  const windows: UsageWindow[] = [];
  for (const [id, label] of CLAUDE_WINDOWS) {
    const window = claudeWindow(id, label, limits[id]);
    if (window) windows.push(window);
  }

  for (const scoped of limits.model_scoped ?? []) {
    const name = typeof scoped?.display_name === "string" ? scoped.display_name.trim() : "";
    if (!name) continue;
    const scopedWindow = claudeWindow(`model_scoped:${name}`, `Weekly (${name})`, scoped);
    if (scopedWindow) windows.push(scopedWindow);
  }

  return planUsageReading(windows, now);
}

export async function readClaudePlanUsage(query: unknown): Promise<PlanUsageReading> {
  const usageMethod = (query as UsageCapableQuery | null | undefined)?.[USAGE_METHOD];
  if (typeof usageMethod !== "function") {
    logInfo("[AgentMode] Claude SDK exposes no usage API; plan caps unavailable");
    return { kind: "unavailable" };
  }

  try {
    const snapshot = await usageMethod.call(query);
    const reading = planUsageFromClaudeUsage(snapshot as ClaudeUsageSnapshot);
    logInfo(
      reading.kind === "usage"
        ? `[AgentMode] read ${reading.planUsage.windows.length} plan cap window(s)`
        : `[AgentMode] usage read reported ${reading.kind === "none" ? "no plan caps" : "nothing usable"}`
    );
    return reading;
  } catch (error) {
    logInfo("[AgentMode] Claude SDK usage read failed; plan caps unavailable", error);
    return { kind: "unavailable" };
  }
}
