import { BREVILABS_MODELS_BASE_URL } from "@/constants";
import {
  COPILOT_PLUS_PROVIDER_ID,
  FALLBACK_CONTEXT_WINDOW,
  MAX_OUTPUT_TOKENS,
  fetchCopilotPlusModels,
} from "@/pi/catalog";
import type { PiByokProvider, PiCatalogModel, PiModelEntry, PiProviderDeps } from "@/pi/types";
import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type Models,
  type Provider,
  type ProviderAuth,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const EMPTY_MODELS: readonly Model<"openai-completions">[] = Object.freeze([]);
const EMPTY_MODEL_ENTRIES: readonly PiModelEntry[] = Object.freeze([]);

/** Separates a provider id from a model id in a {@link piModelWireId}. */
const WIRE_SEPARATOR = "/";

/**
 * pi resolves api keys through provider auth rather than request options, so a
 * host-supplied key is wrapped as an auth method that returns it. Resolving to
 * `undefined` is how pi reports a provider the user has not set up, so that is
 * reserved for an endpoint that needs a key and has none — a keyless local
 * runner resolves as configured with no key rather than looking unconfigured.
 *
 * @param name label pi shows for this credential
 * @param apiKey the key, empty for a keyless endpoint
 * @param requiresApiKey whether an empty key means "not set up"
 */
function staticApiKeyAuth(name: string, apiKey: string, requiresApiKey: boolean): ProviderAuth {
  return {
    apiKey: {
      name,
      resolve: () => {
        if (apiKey) return Promise.resolve({ auth: { apiKey }, source: name });
        if (requiresApiKey) return Promise.resolve(undefined);
        return Promise.resolve({ auth: {}, source: "no key required" });
      },
    },
  };
}

/**
 * Address a model by the provider that serves it. Copilot Plus and a BYOK
 * endpoint (or two BYOK endpoints) can expose the same bare model id, so the
 * bare id cannot be used on its own: a selection would silently route to
 * whichever provider happened to be registered first.
 */
export function piModelWireId(providerId: string, modelId: string): string {
  return `${providerId}${WIRE_SEPARATOR}${modelId}`;
}

/**
 * Split a wire id back into its provider and model. Only the FIRST separator is
 * significant — model ids legitimately contain slashes (`deepseek-ai/DeepSeek-V3`),
 * while provider ids never do.
 */
export function parsePiModelWireId(wireId: string): { providerId: string; modelId: string } {
  const index = wireId.indexOf(WIRE_SEPARATOR);
  if (index <= 0) return { providerId: "", modelId: wireId };
  return { providerId: wireId.slice(0, index), modelId: wireId.slice(index + 1) };
}

function byokModel(row: PiByokProvider, id: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: row.id,
    baseUrl: row.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: FALLBACK_CONTEXT_WINDOW,
    maxTokens: MAX_OUTPUT_TOKENS,
  };
}

function byokProvider(row: PiByokProvider): Provider<"openai-completions"> {
  return createProvider<"openai-completions">({
    id: row.id,
    name: row.displayName,
    baseUrl: row.baseUrl,
    auth: staticApiKeyAuth(`${row.displayName} API key`, row.apiKey, row.requiresApiKey),
    models: row.modelIds.map((id) => byokModel(row, id)),
    api: openAICompletionsApi(),
  });
}

/**
 * Assembles the provider collection the engine streams through: Copilot Plus
 * plus every BYOK OpenAI-compatible endpoint the host passes in. The returned
 * collection starts with no Copilot Plus models; call `refresh()` on it to pull
 * the catalog.
 *
 * @param deps host-supplied license key, BYOK rows, and network access
 */
export function createPiModels(deps: PiProviderDeps): Models {
  const models = createModels();
  models.setProvider(
    createProvider<"openai-completions">({
      id: COPILOT_PLUS_PROVIDER_ID,
      name: "Copilot Plus",
      baseUrl: BREVILABS_MODELS_BASE_URL,
      auth: staticApiKeyAuth("Copilot Plus license key", deps.plusLicenseKey, true),
      models: EMPTY_MODELS,
      fetchModels: () => fetchCopilotPlusModels(deps.fetch),
      api: openAICompletionsApi(),
    })
  );
  for (const row of deps.byokProviders) {
    models.setProvider(byokProvider(row));
  }
  return models;
}

function toModelEntry(model: Model<Api>): PiModelEntry {
  return {
    id: model.id,
    wireId: piModelWireId(model.provider, model.id),
    providerId: model.provider,
    label: model.name,
    description: (model as PiCatalogModel).description,
    contextWindow: model.contextWindow,
    supportsImages: model.input.includes("image"),
    supportsReasoning: model.reasoning,
  };
}

/** Flattens every known provider's models into the shape host pickers render. */
export function listPiModels(models: Models): readonly PiModelEntry[] {
  const entries = models.getModels().map(toModelEntry);
  return entries.length > 0 ? entries : EMPTY_MODEL_ENTRIES;
}
