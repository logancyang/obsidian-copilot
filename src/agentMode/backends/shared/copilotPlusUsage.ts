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

/** What the published catalog says about one Copilot Plus model. */
interface CatalogEntry {
  /** Input context window in tokens, or null when the endpoint published none. */
  contextWindow: number | null;
  /**
   * Thinking-effort levels this model distinguishes, or null when the endpoint did
   * not publish any — an older service the caller must not read a menu into.
   */
  reasoningEfforts: readonly string[] | null;
}

/** A model that honors no effort level at all, shared so "empty" stays one value. */
const NO_REASONING_EFFORTS: readonly string[] = Object.freeze([]);

/**
 * Upper bound on one catalog read.
 *
 * The opencode spawn path waits on this to learn a model's effort levels, and
 * `requestUrl` enforces no timeout of its own, so an unreachable host would otherwise
 * hold up starting the agent for as long as the OS takes to give up on the connection.
 * Giving up early costs an accurate effort menu for that session; not giving up costs
 * the agent.
 */
const CATALOG_TIMEOUT_MS = 3_000;

/** Resolve with null if `promise` has not settled within `ms`. */
function withDeadline<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    const settle = (value: T | null) => {
      window.clearTimeout(timer);
      resolve(value);
    };
    promise.then(settle, () => settle(null));
  });
}

/**
 * Levels a published list may contain, or null when the field is missing or unusable.
 *
 * An empty list is a real answer — the model honors no level and its caller should
 * offer no control — so it is kept distinct from the absent case. Anything the caller
 * cannot act on collapses into the absent case rather than into the empty one.
 */
function parseReasoningEfforts(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return NO_REASONING_EFFORTS;
  const levels = raw.filter(
    (level): level is string => typeof level === "string" && level.length > 0
  );
  // A list that arrived with entries but none usable is a malformed answer, not a model
  // that honors no level. Reading it as the latter would delete a working effort menu on
  // the strength of garbage.
  return levels.length > 0 ? Object.freeze(levels) : null;
}

/**
 * Reads Copilot Plus caps and per-model capabilities on behalf of whichever backend is
 * serving those models, caching the published catalog for that backend's lifetime.
 *
 * The catalog changes when we publish a new model list, not while a vault is open, so it
 * is fetched at most once — but only a successful fetch is remembered. Caching a failure
 * would strand the context ring for the rest of the session after one transient outage
 * (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
 */
export class CopilotPlusUsageReader {
  private catalog: Map<string, CatalogEntry> | null = null;
  private inFlight: Promise<Map<string, CatalogEntry> | null> | null = null;

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
    return catalog?.get(modelId)?.contextWindow ?? null;
  }

  /**
   * Thinking-effort levels a Copilot Plus model distinguishes, as the service publishes
   * them, or null when they cannot be read.
   *
   * The caller must not treat null as "no levels": an agent harness left without a
   * published list falls back to guessing the menu from the model id, and dropping the
   * control instead would remove a working one over a transient outage.
   *
   * @param modelId - Bare Copilot Plus model id, with any backend-specific wire prefix
   *   already stripped by the caller. Null for a model this account does not serve.
   */
  async readReasoningEfforts(modelId: string | null): Promise<readonly string[] | null> {
    if (!modelId) return null;
    const catalog = await this.loadCatalog();
    return catalog?.get(modelId)?.reasoningEfforts ?? null;
  }

  private async loadCatalog(): Promise<Map<string, CatalogEntry> | null> {
    if (this.catalog) return this.catalog;
    // Share one request between concurrent callers, but do not remember a failed one.
    this.inFlight ??= this.fetchCatalog().finally(() => {
      this.inFlight = null;
    });
    const catalog = await withDeadline(this.inFlight, CATALOG_TIMEOUT_MS);
    if (catalog) this.catalog = catalog;
    return catalog;
  }

  private async fetchCatalog(): Promise<Map<string, CatalogEntry> | null> {
    const response = await BrevilabsClient.getInstance().getModels();
    if (!response?.data) {
      logInfo("[AgentMode] Copilot Plus catalog unavailable; context ring will retry");
      return null;
    }
    const catalog = new Map<string, CatalogEntry>();
    for (const entry of response.data) {
      if (!entry?.id) continue;
      catalog.set(entry.id, {
        contextWindow: parseContextLength(entry.context_length),
        reasoningEfforts: parseReasoningEfforts(entry.reasoning_efforts),
      });
    }
    return catalog;
  }
}
