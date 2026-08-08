/**
 * Pure transform from the `models.dev/api.json` wire shape to the
 * module's persisted-snapshot-compatible `CatalogProvider[]` view.
 */

import { logWarn } from "@/logger";

import type { CatalogProvider, ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import { isPlainObject, type WireModel, type WireProvider } from "./modelsDevWire";

/**
 * Heuristic shared by the catalog transform and the catalog-less BYOK
 * template flow: an id whose token set contains `embed` / `embedding` is
 * an embedding model. Token-bounded so `embedded-*` chat models (the
 * `embed` substring not in an embedding context) don't get mis-flagged
 * out of chat backends. It's the only signal available for hand-typed
 * / `GET /models`-fetched ids, which carry no capability metadata on
 * the wire.
 */
const EMBEDDING_TOKEN = /(^|[-_/.\s])embed(ding)?($|[-_/.\s])/i;

export function looksLikeEmbeddingModel(idOrHaystack: string): boolean {
  return EMBEDDING_TOKEN.test(idOrHaystack);
}

/**
 * Maps the `models.dev` `npm` field to the closed `ProviderType` union.
 */
function mapNpmToProviderType(npm: string | undefined): ProviderType {
  switch (npm) {
    case "@ai-sdk/anthropic":
      return "anthropic";
    case "@ai-sdk/google":
      return "google";
    case "@ai-sdk/azure":
      return "azure";
    case "@ai-sdk/amazon-bedrock":
      return "bedrock";
    default:
      return "openai-compatible";
  }
}

function transformModel(wire: WireModel): ModelInfo | null {
  if (typeof wire.id !== "string") return null;
  const info: ModelInfo = {
    id: wire.id,
    displayName: wire.name ?? wire.id,
  };

  const modInput = Array.isArray(wire.modalities?.input) ? wire.modalities.input : undefined;
  const modOutput = Array.isArray(wire.modalities?.output) ? wire.modalities.output : undefined;
  if (modInput || modOutput) {
    info.modalities = {
      ...(modInput ? { input: modInput } : {}),
      ...(modOutput ? { output: modOutput } : {}),
    };
  }

  if (wire.limit) {
    const { context, output, input } = wire.limit;
    const limits: NonNullable<ModelInfo["limits"]> = {};
    if (typeof context === "number") limits.context = context;
    if (typeof output === "number") limits.output = output;
    if (typeof input === "number") limits.input = input;
    if (Object.keys(limits).length > 0) info.limits = limits;
  }

  if (typeof wire.reasoning === "boolean") info.reasoning = wire.reasoning;
  if (typeof wire.tool_call === "boolean") info.toolCall = wire.tool_call;
  // The `family` field is unreliable — it's often the base family
  // (`gemini`, `qwen`) or absent — so match the id too.
  if (looksLikeEmbeddingModel(`${wire.id} ${typeof wire.family === "string" ? wire.family : ""}`)) {
    info.isEmbedding = true;
  }
  if (typeof wire.release_date === "string") info.releaseDate = wire.release_date;

  if (wire.cost) {
    const { input, output, cache_read, cache_write } = wire.cost;
    const cost: NonNullable<ModelInfo["cost"]> = {};
    if (typeof input === "number") cost.input = input;
    if (typeof output === "number") cost.output = output;
    if (typeof cache_read === "number") cost.cacheRead = cache_read;
    if (typeof cache_write === "number") cost.cacheWrite = cache_write;
    if (Object.keys(cost).length > 0) info.cost = cost;
  }

  return info;
}

function transformProvider(providerKey: string, wire: unknown): CatalogProvider | null {
  if (!isPlainObject(wire)) return null;
  if (typeof (wire as { id?: unknown }).id !== "string") return null;
  const wireProv = wire as unknown as WireProvider;

  const models: Record<string, ModelInfo> = {};
  const wireModels = isPlainObject(wireProv.models) ? wireProv.models : {};
  for (const [modelKey, wireModel] of Object.entries(wireModels)) {
    if (!isPlainObject(wireModel)) {
      logWarn(
        `[modelsCatalog] dropping model "${modelKey}" under provider "${providerKey}": not an object`
      );
      continue;
    }
    const model = transformModel(wireModel);
    if (model) {
      models[model.id] = model;
    } else {
      logWarn(
        `[modelsCatalog] dropping model "${modelKey}" under provider "${providerKey}": invalid id`
      );
    }
  }
  const result: CatalogProvider = {
    id: wireProv.id,
    displayName: wireProv.name ?? wireProv.id,
    providerType: mapNpmToProviderType(wireProv.npm),
    models,
  };
  if (typeof wireProv.api === "string" && wireProv.api.length > 0) {
    result.defaultBaseUrl = wireProv.api;
  }
  return result;
}

/**
 * Convert an arbitrary wire payload into the in-memory provider list.
 * Accepts `unknown` so call sites don't repeat the top-level shape
 * check; non-object payloads return `[]`. Result is sorted alphabetically
 * by `displayName`. Top-level keys that don't look like providers (e.g.
 * a future `_meta` blob, non-object values) are silently dropped;
 * entries that look provider-shaped but fail finer validation are logged.
 */
export function transformWireToCatalog(wire: unknown): CatalogProvider[] {
  if (!isPlainObject(wire)) return [];
  const providers: CatalogProvider[] = [];
  for (const [key, wireProvider] of Object.entries(wire)) {
    const provider = transformProvider(key, wireProvider);
    if (provider) {
      providers.push(provider);
    } else if (isPlainObject(wireProvider) && "id" in wireProvider) {
      logWarn(`[modelsCatalog] dropping provider "${key}": invalid id`);
    }
  }
  providers.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return providers;
}
