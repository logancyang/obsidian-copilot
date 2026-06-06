/**
 * Bridge: a model-management `ConfiguredModel` (+ its `Provider`) → the legacy
 * `CustomModel` shape `ChatModelManager` instantiates from.
 *
 * The v4 `ChatModelFactory` (which would build a LangChain client directly from
 * a `ConfiguredModel`) is still a stub. Rather than implement every provider
 * adapter, the chat backend reuses the proven `ChatModelManager` engine by
 * mapping a selected `ConfiguredModel` back into a `CustomModel`. Selection data
 * lives in the registries; instantiation stays on the battle-tested path.
 *
 * Pure — no registry/keychain access. The caller resolves the API key
 * (`resolveChatBackendModel`) and passes it in.
 */

import { CustomModel } from "@/aiParams";
import { ChatModelProviders, ModelCapability, ProviderInfo } from "@/constants";
import { logWarn } from "@/logger";
import { providerRequiresApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

/**
 * Canonical `models.dev` catalog-id → legacy `ChatModelProviders` table. Two consumers:
 *  - `mapProviderTypeToChatModelProvider` refines an `openai-compatible` provider into its
 *    dedicated `ChatModelManager` constructor. Everything else (the Ollama / LM Studio
 *    built-in templates, whose base URLs already carry `/v1`, and arbitrary custom proxies)
 *    routes through `OPENAI_FORMAT` — generic `ChatOpenAI` driven by the provider's
 *    `baseUrl`. Falling through is safe: it loses provider-specific niceties (e.g. OpenRouter
 *    reasoning/caching headers) but still serves chat.
 *  - `getLegacyChatModelKeys` (in `chatModelSelection`) enumerates legacy `name|provider`
 *    selection keys.
 * `anthropic`/`google` are included for the legacy-key path; the chat path reaches them via
 * the `providerType` switch *before* this lookup, so they're never consulted in the
 * `openai-compatible` branch.
 */
export const CATALOG_ID_TO_CHAT_PROVIDER: Record<string, ChatModelProviders> = {
  openai: ChatModelProviders.OPENAI,
  groq: ChatModelProviders.GROQ,
  mistral: ChatModelProviders.MISTRAL,
  openrouter: ChatModelProviders.OPENROUTERAI,
  deepseek: ChatModelProviders.DEEPSEEK,
  xai: ChatModelProviders.XAI,
  cohere: ChatModelProviders.COHEREAI,
  siliconflow: ChatModelProviders.SILICONFLOW,
  anthropic: ChatModelProviders.ANTHROPIC,
  google: ChatModelProviders.GOOGLE,
};

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Pick the `ChatModelProviders` value `ChatModelManager` dispatches on. This is
 * the load-bearing decision — it selects the LangChain class. `providerType` is
 * the coarse dispatch; for `openai-compatible` we refine via the BYOK origin's
 * `catalogProviderId` so the dedicated constructors (Groq, DeepSeek, …) are used
 * when known.
 */
export function mapProviderTypeToChatModelProvider(provider: Provider): ChatModelProviders {
  if (provider.origin.kind === "copilot-plus") {
    return ChatModelProviders.COPILOT_PLUS;
  }

  switch (provider.providerType) {
    case "anthropic":
      return ChatModelProviders.ANTHROPIC;
    case "google":
      return ChatModelProviders.GOOGLE;
    case "azure":
      return ChatModelProviders.AZURE_OPENAI;
    case "bedrock":
      return ChatModelProviders.AMAZON_BEDROCK;
    case "openai-compatible": {
      const catalogId =
        provider.origin.kind === "byok" ? provider.origin.catalogProviderId : undefined;
      if (
        catalogId === "xai" &&
        provider.baseUrl &&
        normalizeBaseUrl(provider.baseUrl) !==
          normalizeBaseUrl(ProviderInfo[ChatModelProviders.XAI].host)
      ) {
        return ChatModelProviders.OPENAI_FORMAT;
      }
      const mapped = catalogId ? CATALOG_ID_TO_CHAT_PROVIDER[catalogId] : undefined;
      return mapped ?? ChatModelProviders.OPENAI_FORMAT;
    }
    default: {
      // `ProviderType` is a closed union, so this is unreachable today; the
      // `never` binding makes a future member without a mapping a compile
      // error rather than a silent OpenAI-format fallback.
      const unknownType: never = provider.providerType;
      logWarn(
        `[chatBridge] unknown providerType "${String(unknownType)}"; defaulting to OpenAI-format`
      );
      return ChatModelProviders.OPENAI_FORMAT;
    }
  }
}

function extraString(extras: Record<string, unknown>, key: string): string | undefined {
  const value = extras[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Build the `CustomModel` for a resolved chat-backend selection.
 *
 * Per-model tuning (temperature / maxTokens / reasoning effort) is left unset:
 * `ChatModelManager.getModelConfig` falls back to the global settings defaults,
 * and reasoning/thinking behavior is derived from the wire model id
 * (`getModelInfo`). Re-homing per-model overrides onto `ConfiguredModel` is a
 * follow-up.
 */
export function configuredModelToCustomModel(params: {
  provider: Provider;
  configuredModel: ConfiguredModel;
  /** Plaintext key resolved from the keychain; `null` when none stored. */
  apiKey: string | null;
}): CustomModel {
  const { provider, configuredModel, apiKey } = params;
  const info = configuredModel.info;
  const extras = provider.extras ?? {};

  const trimmedKey = apiKey && apiKey.length > 0 ? apiKey : undefined;
  // Keyless providers (Ollama, LM Studio, unauthenticated proxies) still need a
  // non-empty placeholder so the OpenAI-format client constructs — the legacy
  // path used the same "default-key" sentinel. When a key IS required but
  // missing, leave it undefined so credential validation fails loudly.
  const resolvedApiKey =
    trimmedKey ??
    (provider.origin.kind === "copilot-plus" || providerRequiresApiKey(provider)
      ? undefined
      : "default-key");

  const capabilities: ModelCapability[] = [];
  if (info.reasoning) capabilities.push(ModelCapability.REASONING);
  if (info.modalities?.input?.includes("image")) capabilities.push(ModelCapability.VISION);

  return {
    configuredModelId: configuredModel.configuredModelId,
    name: info.id,
    provider: mapProviderTypeToChatModelProvider(provider),
    displayName: info.displayName,
    enabled: true,
    baseUrl: provider.baseUrl,
    apiKey: resolvedApiKey,
    capabilities,
    openAIOrgId: extraString(extras, "openAIOrgId"),
    azureOpenAIApiInstanceName: extraString(extras, "azureInstanceName"),
    azureOpenAIApiDeploymentName: extraString(extras, "azureDeploymentName"),
    azureOpenAIApiVersion: extraString(extras, "azureApiVersion"),
    bedrockRegion: extraString(extras, "bedrockRegion"),
  };
}
