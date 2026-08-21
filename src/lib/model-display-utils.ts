import type { CustomModel } from "@/aiParams";
import {
  ChatModelProviders,
  EmbeddingModelProviders,
  ProviderInfo,
  ProviderSettingsKeyMap,
} from "@/constants";
import type { Provider, SettingKeyProviders } from "@/constants";
import type { CopilotSettings } from "@/settings/model";

export { err2String } from "@/errorFormat";

export type ModelApiKeySettings = Pick<
  CopilotSettings,
  | "anthropicApiKey"
  | "openAIApiKey"
  | "azureOpenAIApiKey"
  | "googleApiKey"
  | "groqApiKey"
  | "openRouterAiApiKey"
  | "cohereApiKey"
  | "xaiApiKey"
  | "plusLicenseKey"
  | "mistralApiKey"
  | "deepseekApiKey"
  | "siliconflowApiKey"
  | "orcarouterApiKey"
>;

const PROVIDERS_WITHOUT_API_KEYS: ReadonlySet<Provider> = new Set([
  ChatModelProviders.OPENAI_FORMAT,
  ChatModelProviders.OLLAMA,
  ChatModelProviders.LM_STUDIO,
  ChatModelProviders.AZURE_OPENAI,
  EmbeddingModelProviders.COPILOT_PLUS,
  EmbeddingModelProviders.COPILOT_PLUS_JINA,
]);

export function getProviderLabel(provider: string, model?: CustomModel): string {
  const baseLabel = ProviderInfo[provider as Provider]?.label || provider;
  return baseLabel + (model?.believerExclusive && baseLabel === "Copilot" ? "(Believer)" : "");
}

/**
 * Check whether a model has the credential its provider requires without reading plugin state.
 *
 * @param model - Model whose provider and optional per-model key determine credential requirements.
 * @param settings - Caller-owned settings snapshot used for provider credentials.
 */
export function checkModelApiKey(
  model: CustomModel,
  settings: Readonly<ModelApiKeySettings>
): {
  hasApiKey: boolean;
  errorNotice?: string;
} {
  const provider = model.provider as ChatModelProviders;
  const knownProvider = Object.prototype.hasOwnProperty.call(ProviderInfo, provider);
  const needsApiKey = knownProvider && !PROVIDERS_WITHOUT_API_KEYS.has(provider);
  const settingsKey = ProviderSettingsKeyMap[
    provider as SettingKeyProviders
  ] as keyof ModelApiKeySettings;
  const hasApiKey = Boolean(model.apiKey || (settingsKey && settings[settingsKey]));

  if (needsApiKey && !hasApiKey) {
    return {
      hasApiKey: false,
      errorNotice:
        `Please configure API Key for ${model.name} in settings first.` +
        "\nPath: Settings > Copilot > BYOK",
    };
  }

  return { hasApiKey: true };
}
