import type { PlanUsageReading, UsageWindow } from "@/agentMode/session/planUsage";
import { planUsageReading, toUsagePercent } from "@/agentMode/session/planUsage";
import { BrevilabsClient, type UsageResponse } from "@/LLMProviders/brevilabsClient";
import { getSettings } from "@/settings/model";

/**
 * Copilot Plus account caps and model context windows.
 *
 * Shared rather than owned by one backend: the caps belong to the Copilot Plus account,
 * and the same models reach the agent through more than one backend. Each backend knows
 * how its own wire ids are spelled and hands this module a bare Copilot Plus model id;
 * nothing here knows or cares which backend asked.
 *
 * Caps are live — they change as the account is used. Context windows are not, so they
 * come from the cached lineup instead of a second request.
 */

/** The windows the endpoint can report, in the order they should be shown. */
const COPILOT_PLUS_WINDOWS: ReadonlyArray<readonly [string, string]> = [
  ["five_hour", "5h"],
  ["weekly", "Weekly"],
];

/**
 * Epoch milliseconds from the endpoint's epoch SECONDS, or undefined when unusable.
 * Providers disagree on encoding — Claude sends ISO 8601, this sends seconds — so each
 * adapter converts its own.
 */
function epochSecondsToMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 1000);
}

/**
 * Normalize the Brevilabs usage endpoint.
 *
 * The endpoint omits a window the plan does not cap, and returns no windows at all when
 * the counters cannot be read. Those two are indistinguishable in the response, so
 * neither clears the meters: an absent window is reported as an unusable read rather than
 * as "this account has no caps"
 * (https://github.com/logancyang/obsidian-copilot-preview/issues/193). Percentages above
 * 100 are real — an account served past its cap on purchased credit — and pass through
 * unclamped.
 */
export function planUsageFromCopilotPlusUsage(
  snapshot: UsageResponse | null | undefined,
  now: number = Date.now()
): PlanUsageReading {
  const used = snapshot?.used;
  if (!used) return { kind: "unavailable" };

  const windows: UsageWindow[] = [];
  for (const [id, label] of COPILOT_PLUS_WINDOWS) {
    const raw = used[id];
    const percent = toUsagePercent(raw?.usedPercent);
    if (percent === null) continue;
    windows.push({ id, label, percent, resetsAt: epochSecondsToMs(raw?.resetsAt) });
  }

  return planUsageReading(windows, now);
}

export class CopilotPlusUsageReader {
  /** The account's cap utilization as the models host currently reports it. */
  async readPlanUsage(): Promise<PlanUsageReading> {
    const snapshot = await BrevilabsClient.getInstance().getUsage();
    return planUsageFromCopilotPlusUsage(snapshot);
  }

  /**
   * Published context window of a Copilot Plus model, from the cached lineup.
   *
   * Read from the cache rather than the service so sizing a meter never waits on
   * a network round trip, and so the window a session reports always agrees with
   * the model row the agent was actually configured from.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/319
   *
   * @param modelId - Bare Copilot Plus model id, with any backend-specific wire prefix
   *   already stripped by the caller. Null for a model this account does not serve.
   */
  async readContextWindow(modelId: string | null): Promise<number | null> {
    if (!modelId) return null;
    const model = getSettings().copilotPlusCatalog.models.find((m) => m.id === modelId);
    return model?.limits?.context ?? null;
  }
}
