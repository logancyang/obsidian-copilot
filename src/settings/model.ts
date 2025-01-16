import { CustomModel } from "@/aiParams";
import { atom, createStore, useAtomValue } from "jotai";

import { type ChainType } from "@/chainFactory";
import {
  BUILTIN_CHAT_MODELS,
  BUILTIN_EMBEDDING_MODELS,
  DEFAULT_OPEN_AREA,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  EmbeddingModelProviders,
} from "@/constants";

export interface CopilotSettings {
  plusLicenseKey: string;
  openAIApiKey: string;
  openAIOrgId: string;
  huggingfaceApiKey: string;
  cohereApiKey: string;
  anthropicApiKey: string;
  azureOpenAIApiKey: string;
  azureOpenAIApiInstanceName: string;
  azureOpenAIApiDeploymentName: string;
  azureOpenAIApiVersion: string;
  azureOpenAIApiEmbeddingDeploymentName: string;
  googleApiKey: string;
  openRouterAiApiKey: string;
  defaultChainType: ChainType;
  defaultModelKey: string;
  embeddingModelKey: string;
  temperature: number;
  maxTokens: number;
  contextTurns: number;
  // Do not use this directly, use getSystemPrompt() instead
  userSystemPrompt: string;
  openAIProxyBaseUrl: string;
  openAIEmbeddingProxyBaseUrl: string;
  stream: boolean;
  defaultSaveFolder: string;
  defaultConversationTag: string;
  autosaveChat: boolean;
  customPromptsFolder: string;
  indexVaultToVectorStore: string;
  chatNoteContextPath: string;
  chatNoteContextTags: string[];
  enableIndexSync: boolean;
  debug: boolean;
  enableEncryption: boolean;
  maxSourceChunks: number;
  qaExclusions: string;
  qaInclusions: string;
  groqApiKey: string;
  enabledCommands: Record<string, { enabled: boolean }>;
  activeModels: Array<CustomModel>;
  activeEmbeddingModels: Array<CustomModel>;
  promptUsageTimestamps: Record<string, number>;
  embeddingRequestsPerSecond: number;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  disableIndexOnMobile: boolean;
  showSuggestedPrompts: boolean;
  showRelevantNotes: boolean;
  numPartitions: number;
}

export const settingsStore = createStore();
export const settingsAtom = atom<CopilotSettings>(DEFAULT_SETTINGS);

/**
 * Sets the settings in the atom.
 */
export function setSettings(settings: Partial<CopilotSettings>) {
  try {
    const newSettings = mergeAllActiveModelsWithCoreModels({ ...getSettings(), ...settings });
    validateSettings(newSettings);
    settingsStore.set(settingsAtom, newSettings);
  } catch (error) {
    console.error("Validation error:", error);
    alert(`Validation error: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Sets a single setting in the atom.
 */
export function updateSetting<K extends keyof CopilotSettings>(key: K, value: CopilotSettings[K]) {
  try {
    const settings = getSettings();
    const newSettings = { ...settings, [key]: value };
    validateSettings(newSettings);
    setSettings(newSettings);
  } catch (error) {
    console.error("Validation error:", error);
    alert(`Validation error: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Gets the settings from the atom. Use this if you don't need to subscribe to
 * changes.
 */
export function getSettings(): Readonly<CopilotSettings> {
  return settingsStore.get(settingsAtom);
}

/**
 * Resets the settings to the default values.
 */
export function resetSettings(): void {
  const defaultSettingsWithBuiltIns = {
    ...DEFAULT_SETTINGS,
    activeModels: BUILTIN_CHAT_MODELS.map((model) => ({ ...model, enabled: true })),
    activeEmbeddingModels: BUILTIN_EMBEDDING_MODELS.map((model) => ({ ...model, enabled: true })),
  };
  setSettings(defaultSettingsWithBuiltIns);
}

/**
 * Subscribes to changes in the settings atom.
 */
export function subscribeToSettingsChange(callback: () => void): () => void {
  return settingsStore.sub(settingsAtom, callback);
}

/**
 * Hook to get the settings value from the atom.
 */
export function useSettingsValue(): Readonly<CopilotSettings> {
  return useAtomValue(settingsAtom, {
    store: settingsStore,
  });
}

/**
 * Sanitizes the settings to ensure they are valid.
 * Note: This will be better handled by Zod in the future.
 */
export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  // If settings is null/undefined, use DEFAULT_SETTINGS
  const settingsToSanitize = settings || DEFAULT_SETTINGS;

  // fix: Maintain consistency between EmbeddingModelProviders.AZURE_OPENAI and ChatModelProviders.AZURE_OPENAI,
  // where it was 'azure_openai' before EmbeddingModelProviders.AZURE_OPENAI.
  settingsToSanitize.activeEmbeddingModels = settingsToSanitize.activeEmbeddingModels.map((m) => {
    return {
      ...m,
      provider: m.provider === "azure_openai" ? EmbeddingModelProviders.AZURE_OPENAI : m.provider,
    };
  });

  const sanitizedSettings: CopilotSettings = { ...settingsToSanitize };

  // Stuff in settings are string even when the interface has number type!
  const temperature = Number(settingsToSanitize.temperature);
  sanitizedSettings.temperature = isNaN(temperature) ? DEFAULT_SETTINGS.temperature : temperature;

  const maxTokens = Number(settingsToSanitize.maxTokens);
  sanitizedSettings.maxTokens = isNaN(maxTokens) ? DEFAULT_SETTINGS.maxTokens : maxTokens;

  const contextTurns = Number(settingsToSanitize.contextTurns);
  sanitizedSettings.contextTurns = isNaN(contextTurns)
    ? DEFAULT_SETTINGS.contextTurns
    : contextTurns;

  return sanitizedSettings;
}

export function getSystemPrompt(): string {
  const userPrompt = getSettings().userSystemPrompt;
  return userPrompt ? `${DEFAULT_SYSTEM_PROMPT}\n\n${userPrompt}` : DEFAULT_SYSTEM_PROMPT;
}

function mergeAllActiveModelsWithCoreModels(settings: CopilotSettings): CopilotSettings {
  settings.activeModels = mergeActiveModels(settings.activeModels, BUILTIN_CHAT_MODELS);
  settings.activeEmbeddingModels = mergeActiveModels(
    settings.activeEmbeddingModels,
    BUILTIN_EMBEDDING_MODELS
  );
  return settings;
}

/**
 * Get a unique model key from a CustomModel instance
 * Format: modelName|provider
 */
export function getModelKeyFromModel(model: CustomModel): string {
  return `${model.name}|${model.provider}`;
}

function mergeActiveModels(
  existingActiveModels: CustomModel[],
  builtInModels: CustomModel[]
): CustomModel[] {
  const modelMap = new Map<string, CustomModel>();

  // Create a unique key for each model, it's model (name + provider)

  // Add core models to the map
  builtInModels
    .filter((model) => model.core)
    .forEach((model) => {
      modelMap.set(getModelKeyFromModel(model), { ...model, core: true });
    });

  // Add or update existing models in the map
  existingActiveModels.forEach((model) => {
    const key = getModelKeyFromModel(model);
    const existingModel = modelMap.get(key);
    if (existingModel) {
      // If it's a built-in model, preserve the built-in status
      modelMap.set(key, {
        ...model,
        isBuiltIn: existingModel.isBuiltIn || model.isBuiltIn,
      });
    } else {
      modelMap.set(key, model);
    }
  });

  return Array.from(modelMap.values());
}

function validateSettings(settings: CopilotSettings): void {
  settings.activeModels.forEach((model) => {
    validateModelConfig(model);
  });
}

function validateModelConfig(model: CustomModel): void {
  switch (model.provider) {
    case "openai":
      validateOpenAIConfig(model);
      break;
    case "azure openai":
      validateAzureOpenAIConfig(model);
      break;
    case "anthropic":
      validateAnthropicConfig(model);
      break;
    case "cohereai":
      validateCohereAIConfig(model);
      break;
    case "google":
      validateGoogleConfig(model);
      break;
    case "openrouterai":
      validateOpenRouterAIConfig(model);
      break;
    case "groq":
      validateGroqConfig(model);
      break;
    case "ollama":
      validateOllamaConfig(model);
      break;
    case "lm-studio":
      validateLMStudioConfig(model);
      break;
    case "3rd party (openai-format)":
      validateOpenAIFormatConfig(model);
      break;
    default:
      throw new Error(`Unknown provider: ${model.provider}`);
  }
}

function validateOpenAIConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("OpenAI API key is required.");
  }
}

function validateAzureOpenAIConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("Azure OpenAI API key is required.");
  }
  if (!model.azureOpenAIApiInstanceName) {
    throw new Error("Azure OpenAI API instance name is required.");
  }
  if (!model.azureOpenAIApiDeploymentName) {
    throw new Error("Azure OpenAI API deployment name is required.");
  }
  if (!model.azureOpenAIApiVersion) {
    throw new Error("Azure OpenAI API version is required.");
  }
}

function validateAnthropicConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("Anthropic API key is required.");
  }
}

function validateCohereAIConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("Cohere AI API key is required.");
  }
}

function validateGoogleConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("Google API key is required.");
  }
}

function validateOpenRouterAIConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("OpenRouter AI API key is required.");
  }
}

function validateGroqConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("Groq API key is required.");
  }
}

function validateOllamaConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("Ollama API key is required.");
  }
}

function validateLMStudioConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("LM Studio API key is required.");
  }
}

function validateOpenAIFormatConfig(model: CustomModel): void {
  if (!model.apiKey) {
    throw new Error("OpenAI Format API key is required.");
  }
}
