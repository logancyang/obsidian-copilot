import { CustomModel } from "@/aiParams";
import { atom, createStore, useAtomValue } from "jotai";

import { type ChainType } from "@/chainFactory";
import {
  BUILTIN_CHAT_MODELS,
  BUILTIN_EMBEDDING_MODELS,
  DEFAULT_OPEN_AREA,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
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
  enabledCommands: Record<string, { enabled: boolean; name: string }>;
  activeModels: Array<CustomModel>;
  activeEmbeddingModels: Array<CustomModel>;
  promptUsageTimestamps: Record<string, number>;
  embeddingRequestsPerSecond: number;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  disableIndexOnMobile: boolean;
  showSuggestedPrompts: boolean;
  numPartitions: number;
}

export const settingsStore = createStore();
export const settingsAtom = atom<CopilotSettings>(DEFAULT_SETTINGS);

/**
 * Sets the settings in the atom.
 */
export function setSettings(settings: Partial<CopilotSettings>) {
  const newSettings = mergeAllActiveModelsWithCoreModels({ ...getSettings(), ...settings });
  settingsStore.set(settingsAtom, newSettings);
}

/**
 * Sets a single setting in the atom.
 */
export function updateSetting<K extends keyof CopilotSettings>(key: K, value: CopilotSettings[K]) {
  const settings = getSettings();
  setSettings({ ...settings, [key]: value });
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

function mergeActiveModels(
  existingActiveModels: CustomModel[],
  builtInModels: CustomModel[]
): CustomModel[] {
  const modelMap = new Map<string, CustomModel>();

  // Create a unique key for each model, it's model (name + provider)
  const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

  // Add core models to the map
  builtInModels
    .filter((model) => model.core)
    .forEach((model) => {
      modelMap.set(getModelKey(model), { ...model, core: true });
    });

  // Add or update existing models in the map
  existingActiveModels.forEach((model) => {
    const key = getModelKey(model);
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
