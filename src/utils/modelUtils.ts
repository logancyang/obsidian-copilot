import {
  ChatModelProviders,
  ChatModels,
  ProviderSettingsKeyMap,
  SettingKeyProviders,
} from "@/constants";
import { getSettings } from "@/settings/model";
import { CustomModel } from "@/aiParams";

/**
 * Check if a provider requires an API key.
 * Local providers (OLLAMA, LM_STUDIO, OPENAI_FORMAT) don't require API keys.
 *
 * @param provider - The provider to check
 * @returns true if the provider requires an API key, false for local providers
 *
 * @example
 * if (providerRequiresApiKey(model.provider)) {
 *   // This is a cloud provider, check for API key
 * } else {
 *   // This is a local provider, no API key needed
 * }
 */
export function providerRequiresApiKey(provider: string): provider is SettingKeyProviders {
  return provider in ProviderSettingsKeyMap;
}

/**
 * Get API key for a provider, with model-specific key taking precedence over global settings.
 *
 * @param provider - The provider to get the API key for
 * @param model - Optional model instance; if provided and has apiKey, it will be used instead of global key
 * @returns The API key (model-specific if available, otherwise global provider key, or empty string)
 *
 * @example
 * // Get global API key for OpenAI
 * const globalKey = getApiKeyForProvider(ChatModelProviders.OPENAI);
 *
 * // Get model-specific key (falls back to global if model.apiKey is empty)
 * const modelKey = getApiKeyForProvider(ChatModelProviders.OPENAI, customModel);
 */
export function getApiKeyForProvider(provider: SettingKeyProviders, model?: CustomModel): string {
  const settings = getSettings();
  return model?.apiKey || (settings[ProviderSettingsKeyMap[provider]] as string | undefined) || "";
}

/**
 * List of models that are always required and cannot be disabled.
 * These models provide essential functionality for the plugin.
 */
const REQUIRED_MODELS: ReadonlyArray<{ name: string; provider: string }> = [
  { name: ChatModels.COPILOT_PLUS_FLASH, provider: ChatModelProviders.COPILOT_PLUS },
  { name: ChatModels.OPENROUTER_GEMINI_2_5_FLASH, provider: ChatModelProviders.OPENROUTERAI },
];

/**
 * Checks if a model is required and should always be enabled.
 * Required models cannot be disabled by users as they provide core plugin functionality.
 *
 * @param model - The model to check
 * @returns true if the model is required and must remain enabled, false otherwise
 *
 * @example
 * if (isRequiredChatModel(model)) {
 *   // This model cannot be disabled
 * }
 */
export function isRequiredChatModel(model: CustomModel): boolean {
  return REQUIRED_MODELS.some(
    (required) => required.name === model.name && required.provider === model.provider
  );
}
