import type { PlanUsageReading, UsageWindow } from "@/agentMode/session/planUsage";
import { planUsageReading, toUsagePercent } from "@/agentMode/session/planUsage";
import { logInfo } from "@/logger";

/**
 * The SDK method that reports plan-cap utilization. Its name says what it is: the API is
 * experimental and the SDK asks callers not to depend on it. We do, because it is the
 * only source of these numbers — the streamed `rate_limit_event` carries a reset time and
 * a status but no utilization at all — and a cap meter needs a percentage.
 *
 * That dependency is why every call goes through this module: one place that reaches for
 * the method, one place that stops caring the moment it disappears.
 */
const USAGE_METHOD = "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET" as const;

/** The slice of the SDK `Query` this module needs. */
type UsageCapableQuery = {
  [USAGE_METHOD]?: () => Promise<unknown>;
};

/** One window of the Claude Agent SDK's usage response. */
interface ClaudeWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

interface ClaudeModelScopedWindow extends ClaudeWindow {
  display_name?: string | null;
}

/**
 * The part of the SDK's usage response we read. Declared structurally rather than
 * imported: the SDK marks this API experimental, so the plugin states the shape it
 * depends on and validates against it instead of binding to a type that may move.
 */
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

/**
 * The account-level windows the SDK documents, in the order they should be shown. The
 * three qualified weekly buckets are real caps an account can hit — a legacy plan's
 * per-model weekly limit arrives as `seven_day_opus`/`seven_day_sonnet`, not as
 * `model_scoped` — so omitting them would leave exactly those users unwarned
 * (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
 */
const CLAUDE_WINDOWS = [
  ["five_hour", "5h"],
  ["seven_day", "Weekly"],
  ["seven_day_oauth_apps", "Weekly (OAuth apps)"],
  ["seven_day_opus", "Weekly (Opus)"],
  ["seven_day_sonnet", "Weekly (Sonnet)"],
] as const;

/**
 * Epoch milliseconds from an ISO 8601 timestamp, or undefined when unparseable — a bad
 * timestamp costs the reset countdown, never the meter. Claude sends ISO 8601 where other
 * providers send epoch seconds, so each adapter converts its own encoding.
 */
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

/**
 * Normalize Claude Code's usage response.
 *
 * `utilization` is a percentage, 0–100 — not a fraction. The same numbers appear in the
 * response's parallel `limits[]` array under a field named `percent`, which is what
 * settles it.
 *
 * Reports no caps when plan limits do not apply to the session at all: an API-key,
 * Bedrock, or Vertex run answers `rate_limits_available: false`. That is a successful
 * answer, not a failed read, and the caller must clear any caps it was showing rather
 * than keep them (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
 *
 * Only the windows the SDK documents are read. The live response also carries codenamed
 * buckets that come and go between releases; rendering those would put unexplained rows
 * in front of users.
 */
export function planUsageFromClaudeUsage(
  snapshot: ClaudeUsageSnapshot | null | undefined,
  now: number = Date.now()
): PlanUsageReading {
  // The one statement that justifies clearing meters: this login is not metered by plan
  // caps at all. Every other empty answer is a read we could not use, which changes
  // nothing (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
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

/**
 * Read the account's plan-cap utilization from a live SDK query.
 *
 * Reports `unavailable` for every way the read itself can fail, because none of them tell
 * us anything about the account:
 *
 *   - the SDK renamed or dropped the method (it warned us it might);
 *   - the call threw or the transport died mid-turn;
 *   - the response is not the shape we validate.
 *
 * Reports `none` only when the SDK answers that plan limits do not apply. The caller
 * treats those two very differently, which is the whole reason they are separate.
 *
 * It never throws, so a usage read can't fail a turn that was otherwise fine.
 */
export async function readClaudePlanUsage(query: unknown): Promise<PlanUsageReading> {
  const usageMethod = (query as UsageCapableQuery | null | undefined)?.[USAGE_METHOD];
  if (typeof usageMethod !== "function") {
    // Expected the day the SDK stabilizes or removes it; not an error condition.
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
