import { CustomModel, ProjectConfig } from "@/aiParams";
import { atom, createStore, useAtomValue } from "jotai";
import { v4 as uuidv4 } from "uuid";

import { type ChainType } from "@/chainFactory";
import { type SortStrategy, isSortStrategy } from "@/utils/recentUsageManager";
import {
  BUILTIN_CHAT_MODELS,
  BUILTIN_EMBEDDING_MODELS,
  COPILOT_FOLDER_ROOT,
  DEFAULT_OPEN_AREA,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  DEFAULT_VIM_NAVIGATION,
  EmbeddingModelProviders,
  SEND_SHORTCUT,
  type VimNavigationSettings,
} from "@/constants";

/**
 * We used to store commands in the settings file with the following interface.
 * It has been migrated to CustomCommand. This interface is needed to migrate
 * the legacy commands to the new format.
 */
export interface LegacyCommandSettings {
  /**
   * The name of the command. The name will be turned into id by replacing
   * spaces with underscores.
   */
  name: string;

  /**
   * The model key of the command. If not provided, the current chat model will
   * be used.
   */
  modelKey?: string;

  /**
   * The prompt of the command.
   */
  prompt: string;

  /**
   * Whether to show the command in the context menu.
   */
  showInContextMenu: boolean;
}

export interface CopilotSettings {
  userId: string;
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
  xaiApiKey: string;
  mistralApiKey: string;
  deepseekApiKey: string;
  amazonBedrockApiKey: string;
  amazonBedrockRegion: string;
  siliconflowApiKey: string;
  // GitHub Copilot OAuth tokens
  githubCopilotAccessToken: string;
  githubCopilotToken: string;
  githubCopilotTokenExpiresAt: number;
  defaultChainType: ChainType;
  defaultModelKey: string;
  embeddingModelKey: string;
  temperature: number;
  maxTokens: number;
  contextTurns: number;
  lastDismissedVersion: string | null;
  // DEPRECATED: Do not use this directly, migrated to file-based system prompts
  userSystemPrompt: string;
  openAIProxyBaseUrl: string;
  openAIEmbeddingProxyBaseUrl: string;
  stream: boolean;
  defaultSaveFolder: string;
  defaultConversationTag: string;
  autosaveChat: boolean;
  /**
   * When enabled, generate a short AI title for chat notes on save.
   * When disabled (default), use the first 10 words of the first user message.
   */
  generateAIChatTitleOnSave: boolean;
  autoAddActiveContentToContext: boolean;
  customPromptsFolder: string;
  indexVaultToVectorStore: string;
  chatNoteContextPath: string;
  chatNoteContextTags: string[];
  enableIndexSync: boolean;
  debug: boolean;
  enableEncryption: boolean;
  maxSourceChunks: number;
  enableInlineCitations: boolean;
  qaExclusions: string;
  qaInclusions: string;
  groqApiKey: string;
  activeModels: Array<CustomModel>;
  activeEmbeddingModels: Array<CustomModel>;
  promptUsageTimestamps: Record<string, number>;
  promptSortStrategy: string;
  chatHistorySortStrategy: SortStrategy;
  projectListSortStrategy: SortStrategy;
  embeddingRequestsPerMin: number;
  embeddingBatchSize: number;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  defaultSendShortcut: SEND_SHORTCUT;
  disableIndexOnMobile: boolean;
  showSuggestedPrompts: boolean;
  showRelevantNotes: boolean;
  numPartitions: number;
  defaultConversationNoteName: string;
  // undefined means never checked
  isPlusUser: boolean | undefined;
  inlineEditCommands: LegacyCommandSettings[] | undefined;
  projectList: Array<ProjectConfig>;
  passMarkdownImages: boolean;
  enableAutonomousAgent: boolean;
  enableCustomPromptTemplating: boolean;
  /** Enable semantic search using Orama for meaning-based document retrieval */
  enableSemanticSearchV3: boolean;
  /** Enable lexical boosts (folder and graph) in search - default: true */
  enableLexicalBoosts: boolean;
  /**
   * RAM limit for lexical search index (in MB)
   * Controls memory usage for full-text search operations
   * - Range: 20-1000 MB
   * - Default: 100 MB
   */
  lexicalSearchRamLimit: number;
  /** Whether we have suggested built-in default commands to the user once. */
  suggestedDefaultCommands: boolean;
  autonomousAgentMaxIterations: number;
  autonomousAgentEnabledToolIds: string[];
  /** Default reasoning effort for models that support it (GPT-5, O-series, etc.) */
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  /** Default verbosity level for models that support it */
  verbosity: "low" | "medium" | "high";
  /** Folder where memory data is stored */
  memoryFolderName: string;
  /** Reference recent conversation history to provide more contextually relevant responses */
  enableRecentConversations: boolean;
  /** Maximum number of recent conversations to remember (10-50) */
  maxRecentConversations: number;
  /** Reference saved memories that user explicitly asked to remember */
  enableSavedMemory: boolean;
  /** Last selected model for quick command */
  quickCommandModelKey: string | undefined;
  /** Last checkbox state for including note context in quick command */
  quickCommandIncludeNoteContext: boolean;
  /** Automatically add text selections to chat context */
  autoIncludeTextSelection: boolean;
  autoAddSelectionToContext: boolean;
  /** Automatically accept file edits without showing preview confirmation */
  autoAcceptEdits: boolean;
  /** Preferred diff view mode: side-by-side or split */
  diffViewMode: "side-by-side" | "split";
  /** Folder where user system prompts are stored */
  userSystemPromptsFolder: string;
  /**
   * Global default system prompt title
   * Used as the default for all new chat sessions
   * Empty string means no custom system prompt (use builtin)
   */
  defaultSystemPromptTitle: string;
  /** Token threshold for auto-compacting large context (range: 64k-1M tokens, default: 128000) */
  autoCompactThreshold: number;
  /** Vim-style keyboard navigation settings for the chat UI */
  vimNavigation: VimNavigationSettings;
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
 * Normalize QA exclusion patterns and guarantee the Copilot folder root is excluded.
 * @param rawValue - Persisted QA exclusion setting value.
 * @returns Encoded QA exclusion patterns string.
 */
export function sanitizeQaExclusions(rawValue: unknown): string {
  const rawValueString = typeof rawValue === "string" ? rawValue : DEFAULT_QA_EXCLUSIONS_SETTING;

  const decodedPatterns: string[] = rawValueString
    .split(",")
    .map((pattern: string) => decodeURIComponent(pattern.trim()))
    .filter((pattern: string) => pattern.length > 0);

  const canonicalToOriginalPattern = new Map<string, string>();

  decodedPatterns.forEach((pattern) => {
    const canonical = pattern.replace(/\/+$/, "");
    const canonicalKey = canonical.length > 0 ? canonical : pattern;
    if (canonicalKey === COPILOT_FOLDER_ROOT) {
      canonicalToOriginalPattern.set(COPILOT_FOLDER_ROOT, COPILOT_FOLDER_ROOT);
      return;
    }
    if (!canonicalToOriginalPattern.has(canonicalKey)) {
      const normalizedValue =
        canonical.length > 0 && pattern.endsWith("/") ? `${canonical}/` : pattern;
      canonicalToOriginalPattern.set(canonicalKey, normalizedValue);
    }
  });

  canonicalToOriginalPattern.set(COPILOT_FOLDER_ROOT, COPILOT_FOLDER_ROOT);

  return Array.from(canonicalToOriginalPattern.values())
    .map((pattern) => encodeURIComponent(pattern))
    .join(",");
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
export function subscribeToSettingsChange(
  callback: (prev: CopilotSettings, next: CopilotSettings) => void
): () => void {
  let previousValue = getSettings();

  return settingsStore.sub(settingsAtom, () => {
    const currentValue = getSettings();
    callback(previousValue, currentValue);
    previousValue = currentValue;
  });
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

  if (!settingsToSanitize.userId) {
    settingsToSanitize.userId = uuidv4();
  }

  // fix: Maintain consistency between EmbeddingModelProviders.AZURE_OPENAI and ChatModelProviders.AZURE_OPENAI,
  // where it was 'azure_openai' before EmbeddingModelProviders.AZURE_OPENAI.
  if (!settingsToSanitize.activeEmbeddingModels) {
    settingsToSanitize.activeEmbeddingModels = BUILTIN_EMBEDDING_MODELS.map((model) => ({
      ...model,
      enabled: true,
    }));
  } else {
    settingsToSanitize.activeEmbeddingModels = settingsToSanitize.activeEmbeddingModels.map((m) => {
      return {
        ...m,
        provider: m.provider === "azure_openai" ? EmbeddingModelProviders.AZURE_OPENAI : m.provider,
      };
    });
  }

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

  const embeddingRequestsPerMin = Number(settingsToSanitize.embeddingRequestsPerMin);
  sanitizedSettings.embeddingRequestsPerMin = isNaN(embeddingRequestsPerMin)
    ? DEFAULT_SETTINGS.embeddingRequestsPerMin
    : embeddingRequestsPerMin;

  const embeddingBatchSize = Number(settingsToSanitize.embeddingBatchSize);
  sanitizedSettings.embeddingBatchSize = isNaN(embeddingBatchSize)
    ? DEFAULT_SETTINGS.embeddingBatchSize
    : embeddingBatchSize;

  // Sanitize lexicalSearchRamLimit (20-1000 MB range)
  const lexicalSearchRamLimit = Number(settingsToSanitize.lexicalSearchRamLimit);
  if (isNaN(lexicalSearchRamLimit)) {
    sanitizedSettings.lexicalSearchRamLimit = DEFAULT_SETTINGS.lexicalSearchRamLimit;
  } else {
    // Clamp to valid range
    sanitizedSettings.lexicalSearchRamLimit = Math.min(1000, Math.max(20, lexicalSearchRamLimit));
  }

  // Ensure autoAddActiveContentToContext has a default value (migrate from old settings)
  if (typeof sanitizedSettings.autoAddActiveContentToContext !== "boolean") {
    // Migration: check old setting first (includeActiveNoteAsContext)
    const oldNoteContext = (settingsToSanitize as unknown as Record<string, unknown>)
      .includeActiveNoteAsContext;
    if (typeof oldNoteContext === "boolean") {
      sanitizedSettings.autoAddActiveContentToContext = oldNoteContext;
    } else {
      sanitizedSettings.autoAddActiveContentToContext =
        DEFAULT_SETTINGS.autoAddActiveContentToContext;
    }
  }

  // Ensure generateAIChatTitleOnSave has a default value
  if (typeof sanitizedSettings.generateAIChatTitleOnSave !== "boolean") {
    sanitizedSettings.generateAIChatTitleOnSave = DEFAULT_SETTINGS.generateAIChatTitleOnSave;
  }

  // Ensure passMarkdownImages has a default value
  if (typeof sanitizedSettings.passMarkdownImages !== "boolean") {
    sanitizedSettings.passMarkdownImages = DEFAULT_SETTINGS.passMarkdownImages;
  }

  // Ensure enableInlineCitations has a default value
  if (typeof sanitizedSettings.enableInlineCitations !== "boolean") {
    sanitizedSettings.enableInlineCitations = DEFAULT_SETTINGS.enableInlineCitations;
  }

  // Ensure enableCustomPromptTemplating has a default value
  if (typeof sanitizedSettings.enableCustomPromptTemplating !== "boolean") {
    sanitizedSettings.enableCustomPromptTemplating = DEFAULT_SETTINGS.enableCustomPromptTemplating;
  }

  // Ensure autonomousAgentMaxIterations has a valid value
  const autonomousAgentMaxIterations = Number(settingsToSanitize.autonomousAgentMaxIterations);
  if (
    isNaN(autonomousAgentMaxIterations) ||
    autonomousAgentMaxIterations < 4 ||
    autonomousAgentMaxIterations > 8
  ) {
    sanitizedSettings.autonomousAgentMaxIterations = DEFAULT_SETTINGS.autonomousAgentMaxIterations;
  } else {
    sanitizedSettings.autonomousAgentMaxIterations = autonomousAgentMaxIterations;
  }

  // Ensure autonomousAgentEnabledToolIds is an array
  if (!Array.isArray(sanitizedSettings.autonomousAgentEnabledToolIds)) {
    sanitizedSettings.autonomousAgentEnabledToolIds =
      DEFAULT_SETTINGS.autonomousAgentEnabledToolIds;
  }

  // Ensure memoryFolderName has a default value
  if (
    !sanitizedSettings.memoryFolderName ||
    typeof sanitizedSettings.memoryFolderName !== "string"
  ) {
    sanitizedSettings.memoryFolderName = DEFAULT_SETTINGS.memoryFolderName;
  }

  // Ensure enableRecentConversations has a default value
  if (typeof sanitizedSettings.enableRecentConversations !== "boolean") {
    sanitizedSettings.enableRecentConversations = DEFAULT_SETTINGS.enableRecentConversations;
  }

  // Ensure enableSavedMemory has a default value
  if (typeof sanitizedSettings.enableSavedMemory !== "boolean") {
    sanitizedSettings.enableSavedMemory = DEFAULT_SETTINGS.enableSavedMemory;
  }

  // Ensure maxRecentConversations has a valid value (10-50 range)
  const maxRecentConversations = Number(settingsToSanitize.maxRecentConversations);
  if (isNaN(maxRecentConversations) || maxRecentConversations < 10 || maxRecentConversations > 50) {
    sanitizedSettings.maxRecentConversations = DEFAULT_SETTINGS.maxRecentConversations;
  } else {
    sanitizedSettings.maxRecentConversations = maxRecentConversations;
  }

  // Ensure autosaveChat has a default value
  if (typeof sanitizedSettings.autosaveChat !== "boolean") {
    sanitizedSettings.autosaveChat = DEFAULT_SETTINGS.autosaveChat;
  }

  // Ensure autoCompactThreshold has a valid value (64k-1M tokens range)
  const autoCompactThreshold = Number(settingsToSanitize.autoCompactThreshold);
  if (isNaN(autoCompactThreshold)) {
    sanitizedSettings.autoCompactThreshold = DEFAULT_SETTINGS.autoCompactThreshold;
  } else {
    // Clamp to valid range
    sanitizedSettings.autoCompactThreshold = Math.min(
      1000000,
      Math.max(64000, autoCompactThreshold)
    );
  }

  // Ensure quickCommandIncludeNoteContext has a default value
  if (typeof sanitizedSettings.quickCommandIncludeNoteContext !== "boolean") {
    sanitizedSettings.quickCommandIncludeNoteContext =
      DEFAULT_SETTINGS.quickCommandIncludeNoteContext;
  }

  // Ensure quickCommandModelKey is either undefined or a string
  if (
    settingsToSanitize.quickCommandModelKey !== undefined &&
    typeof settingsToSanitize.quickCommandModelKey !== "string"
  ) {
    sanitizedSettings.quickCommandModelKey = DEFAULT_SETTINGS.quickCommandModelKey;
  }

  // Ensure autoAddSelectionToContext has a default value (migrate from old settings)
  if (typeof sanitizedSettings.autoAddSelectionToContext !== "boolean") {
    // Migration: check old setting first (autoIncludeTextSelection)
    const oldTextSelection = (settingsToSanitize as unknown as Record<string, unknown>)
      .autoIncludeTextSelection;
    if (typeof oldTextSelection === "boolean") {
      sanitizedSettings.autoAddSelectionToContext = oldTextSelection;
    } else {
      sanitizedSettings.autoAddSelectionToContext = DEFAULT_SETTINGS.autoAddSelectionToContext;
    }
  }

  // Ensure autoAcceptEdits has a default value
  if (typeof sanitizedSettings.autoAcceptEdits !== "boolean") {
    sanitizedSettings.autoAcceptEdits = DEFAULT_SETTINGS.autoAcceptEdits;
  }

  // Ensure defaultSendShortcut has a valid value
  if (!Object.values(SEND_SHORTCUT).includes(sanitizedSettings.defaultSendShortcut)) {
    sanitizedSettings.defaultSendShortcut = DEFAULT_SETTINGS.defaultSendShortcut;
  }

  // Ensure folder settings fall back to defaults when empty/whitespace
  const saveFolder = (settingsToSanitize.defaultSaveFolder || "").trim();
  sanitizedSettings.defaultSaveFolder =
    saveFolder.length > 0 ? saveFolder : DEFAULT_SETTINGS.defaultSaveFolder;

  const promptsFolder = (settingsToSanitize.customPromptsFolder || "").trim();
  sanitizedSettings.customPromptsFolder =
    promptsFolder.length > 0 ? promptsFolder : DEFAULT_SETTINGS.customPromptsFolder;

  // Ensure chatHistorySortStrategy has a valid value (exclude "manual" which is only for custom commands)
  if (
    !isSortStrategy(sanitizedSettings.chatHistorySortStrategy) ||
    sanitizedSettings.chatHistorySortStrategy === "manual"
  ) {
    sanitizedSettings.chatHistorySortStrategy = DEFAULT_SETTINGS.chatHistorySortStrategy;
  }

  // Ensure projectListSortStrategy has a valid value (exclude "manual" which is only for custom commands)
  if (
    !isSortStrategy(sanitizedSettings.projectListSortStrategy) ||
    sanitizedSettings.projectListSortStrategy === "manual"
  ) {
    sanitizedSettings.projectListSortStrategy = DEFAULT_SETTINGS.projectListSortStrategy;
  }

  const userSystemPromptsFolder = (settingsToSanitize.userSystemPromptsFolder || "").trim();
  sanitizedSettings.userSystemPromptsFolder =
    userSystemPromptsFolder.length > 0
      ? userSystemPromptsFolder
      : DEFAULT_SETTINGS.userSystemPromptsFolder;

  sanitizedSettings.qaExclusions = sanitizeQaExclusions(settingsToSanitize.qaExclusions);

  // Ensure vimNavigation has all required fields with defaults
  sanitizedSettings.vimNavigation = {
    ...DEFAULT_VIM_NAVIGATION,
    ...(settingsToSanitize.vimNavigation ?? {}),
  };

  return sanitizedSettings;
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

  // Add core models to the map first
  builtInModels
    .filter((model) => model.core)
    .forEach((model) => {
      modelMap.set(getModelKeyFromModel(model), { ...model });
    });

  // Add or update existing models in the map
  existingActiveModels.forEach((model) => {
    const key = getModelKeyFromModel(model);
    const existingModel = modelMap.get(key);
    if (existingModel) {
      // If it's a built-in model, preserve all built-in properties
      const builtInModel = builtInModels.find(
        (m) => m.name === model.name && m.provider === model.provider
      );
      if (builtInModel) {
        modelMap.set(key, {
          ...builtInModel,
          ...model,
          isBuiltIn: true,
          believerExclusive: builtInModel.believerExclusive,
        });
      } else {
        modelMap.set(key, {
          ...model,
          isBuiltIn: existingModel.isBuiltIn,
        });
      }
    } else {
      modelMap.set(key, model);
    }
  });

  return Array.from(modelMap.values());
}
