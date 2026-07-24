import { BREVILABS_MODELS_BASE_URL } from "@/constants";
import { logWarn } from "@/logger";
import type { PiCatalogModel, PiFetch } from "@/pi/types";

/** Provider id the Copilot Plus catalog models are registered under. */
export const COPILOT_PLUS_PROVIDER_ID = "copilot-plus";

/**
 * Context window assumed when the catalog reports a size this module cannot
 * parse. Deliberately small: under-reporting the budget makes the harness
 * compact early, while over-reporting would let a turn overflow the provider.
 */
export const FALLBACK_CONTEXT_WINDOW = 32_768;

/**
 * Output cap sent with OpenAI-compatible requests. Neither the Copilot Plus
 * catalog nor a BYOK endpoint publishes a per-model output limit, so one value
 * covers every model.
 */
export const MAX_OUTPUT_TOKENS = 8192;

/** Optional units the catalog uses for `context_length` ("1M", "256K", "8192"). */
const CONTEXT_LENGTH_PATTERN = /^(\d+(?:\.\d+)?)\s*([km]?)$/i;

const EMPTY_CATALOG_MODELS: readonly PiCatalogModel[] = Object.freeze([]);

interface CopilotPlusCatalogRow {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  context_length?: unknown;
  supports_images?: unknown;
  supports_reasoning?: unknown;
}

/**
 * Turns the catalog's human-readable context size into a token count. Values
 * arrive from the network, so anything unrecognized falls back rather than
 * producing `NaN` budgets downstream.
 *
 * @param value the raw `context_length` field as received from the catalog
 */
export function parseContextLength(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  const match = typeof value === "string" ? CONTEXT_LENGTH_PATTERN.exec(value.trim()) : null;
  if (!match) {
    logWarn(`Unparseable Copilot Plus context_length ${JSON.stringify(value)}`);
    return FALLBACK_CONTEXT_WINDOW;
  }
  const unit = match[2].toLowerCase();
  const multiplier = unit === "m" ? 1024 * 1024 : unit === "k" ? 1024 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function toCatalogModel(row: CopilotPlusCatalogRow): PiCatalogModel | undefined {
  if (typeof row?.id !== "string" || row.id.length === 0) return undefined;
  return {
    id: row.id,
    name: typeof row.label === "string" ? row.label : row.id,
    description: typeof row.description === "string" ? row.description : undefined,
    api: "openai-completions",
    provider: COPILOT_PLUS_PROVIDER_ID,
    baseUrl: BREVILABS_MODELS_BASE_URL,
    reasoning: row.supports_reasoning === true,
    input: row.supports_images === true ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: parseContextLength(row.context_length),
    maxTokens: MAX_OUTPUT_TOKENS,
  };
}

/**
 * Reads the Copilot Plus catalog so the model list tracks the server rather
 * than a hardcoded copy. The endpoint is public; the license key is only
 * needed when a completion is actually streamed.
 *
 * @param fetchFn network access, injected so callers control transport and tests stay offline
 * @throws when the catalog responds with a non-OK status, which pi treats as a
 * refresh failure and answers by keeping the previously known model list
 */
export async function fetchCopilotPlusModels(fetchFn: PiFetch): Promise<readonly PiCatalogModel[]> {
  const response = await fetchFn(`${BREVILABS_MODELS_BASE_URL}/models`);
  if (!response.ok) {
    throw new Error(`Copilot Plus model catalog request failed with status ${response.status}`);
  }
  const rows = (await response.json()) as { data?: unknown };
  if (!Array.isArray(rows?.data)) {
    logWarn("Copilot Plus model catalog response had no model list");
    return EMPTY_CATALOG_MODELS;
  }
  const models = rows.data
    .map((row) => toCatalogModel(row as CopilotPlusCatalogRow))
    .filter((model): model is PiCatalogModel => model !== undefined);
  return models.length > 0 ? models : EMPTY_CATALOG_MODELS;
}
