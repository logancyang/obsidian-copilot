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
  | "amazonBedrockApiKey"
  | "siliconflowApiKey"
  | "githubCopilotToken"
  | "githubCopilotAccessToken"
>;

const PROVIDERS_WITHOUT_API_KEYS: ReadonlySet<Provider> = new Set([
  ChatModelProviders.OPENAI_FORMAT,
  ChatModelProviders.OLLAMA,
  ChatModelProviders.LM_STUDIO,
  ChatModelProviders.AZURE_OPENAI,
  ChatModelProviders.GITHUB_COPILOT,
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
  if (provider === ChatModelProviders.AMAZON_BEDROCK) {
    const apiKey = model.apiKey || settings.amazonBedrockApiKey;
    if (!apiKey) {
      return {
        hasApiKey: false,
        errorNotice:
          "Amazon Bedrock API key is missing. Please add a key in Settings > Copilot > BYOK or update the model configuration.",
      };
    }

    return { hasApiKey: true };
  }

  if (provider === ChatModelProviders.GITHUB_COPILOT) {
    const hasAuth = Boolean(
      model.apiKey || settings.githubCopilotToken || settings.githubCopilotAccessToken
    );
    if (!hasAuth) {
      return {
        hasApiKey: false,
        errorNotice:
          "GitHub Copilot is not authenticated. Please connect it in Settings > Copilot > BYOK.",
      };
    }
    return { hasApiKey: true };
  }

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
