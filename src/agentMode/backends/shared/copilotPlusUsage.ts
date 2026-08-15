import type { PlanUsageReading, UsageWindow } from "@/agentMode/session/planUsage";
import { planUsageReading, toUsagePercent } from "@/agentMode/session/planUsage";
import { BrevilabsClient, type UsageResponse } from "@/LLMProviders/brevilabsClient";
import { logInfo } from "@/logger";

/**
 * Copilot Plus account caps and model context windows, read from the Brevilabs hosts.
 *
 * Shared rather than owned by one backend: the caps belong to the Copilot Plus account,
 * and the same models reach the agent through more than one backend. Each backend knows
 * how its own wire ids are spelled and hands this module a bare Copilot Plus model id;
 * nothing here knows or cares which backend asked.
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

/**
 * Token count from the display string the models endpoint publishes (`1M`, `256K`,
 * `192K`), or null when it is not a form we recognize.
 *
 * The suffixes are binary: `1M` is the 1,048,576-token Gemini window and `256K` the
 * 262,144-token Kimi one, both rounded for display. Reading them as powers of ten would
 * put every meter about 5% off — harmless for a gauge, but wrong for no reason.
 */
export function parseContextLength(display: unknown): number | null {
  if (typeof display !== "string") return null;
  const match = /^\s*([\d.]+)\s*([KMkm])?\s*$/.exec(display);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2]?.toUpperCase();
  const multiplier = unit === "M" ? 1024 * 1024 : unit === "K" ? 1024 : 1;
  return Math.round(value * multiplier);
}

/**
 * Reads Copilot Plus caps and model context windows on behalf of whichever backend is
 * serving those models, caching the published catalog for that backend's lifetime.
 *
 * The catalog changes when we publish a new model list, not while a vault is open, so it
 * is fetched at most once — but only a successful fetch is remembered. Caching a failure
 * would strand the context ring for the rest of the session after one transient outage
 * (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
 */
export class CopilotPlusUsageReader {
  private contextWindows: Map<string, number> | null = null;
  private inFlight: Promise<Map<string, number> | null> | null = null;

  /** The account's cap utilization as the models host currently reports it. */
  async readPlanUsage(): Promise<PlanUsageReading> {
    const snapshot = await BrevilabsClient.getInstance().getUsage();
    return planUsageFromCopilotPlusUsage(snapshot);
  }

  /**
   * Published context window of a Copilot Plus model.
   *
   * @param modelId - Bare Copilot Plus model id, with any backend-specific wire prefix
   *   already stripped by the caller. Null for a model this account does not serve.
   */
  async readContextWindow(modelId: string | null): Promise<number | null> {
    if (!modelId) return null;
    const catalog = await this.loadCatalog();
    return catalog?.get(modelId) ?? null;
  }

  private async loadCatalog(): Promise<Map<string, number> | null> {
    if (this.contextWindows) return this.contextWindows;
    // Share one request between concurrent callers, but do not remember a failed one.
    this.inFlight ??= this.fetchCatalog().finally(() => {
      this.inFlight = null;
    });
    const catalog = await this.inFlight;
    if (catalog) this.contextWindows = catalog;
    return catalog;
  }

  private async fetchCatalog(): Promise<Map<string, number> | null> {
    const response = await BrevilabsClient.getInstance().getModels();
    if (!response?.data) {
      logInfo("[AgentMode] Copilot Plus catalog unavailable; context ring will retry");
      return null;
    }
    const windows = new Map<string, number>();
    for (const entry of response.data) {
      const tokens = parseContextLength(entry?.context_length);
      if (entry?.id && tokens !== null) windows.set(entry.id, tokens);
    }
    return windows;
  }
}
