import { CustomModel, ProjectConfig } from "@/aiParams";
import { ALL_MANAGED_SKILLS } from "@/builtinSkills/builtinSkills";
import { getModelKeyFromModel } from "@/lib/model-key";
import { atom, createStore, useAtomValue } from "jotai";
import { v4 as uuidv4 } from "uuid";

import type { CopilotMode, ModelSelection } from "@/agentMode";
import { ChainType } from "@/chainType";
import type {
  BackendConfig,
  BackendType,
  ConfiguredModel,
  PersistedCopilotPlusCatalog,
  Provider,
} from "@/modelManagement";
import { MODEL_SECRET_FIELDS, TOP_LEVEL_SECRET_FIELDS } from "@/services/settingsSecretTransforms";
import { isNotificationSoundId, type NotificationSoundId } from "@/utils/notificationSoundCatalog";
import { type SortStrategy, isSortStrategy } from "@/utils/recentUsageManager";
import {
  BUILTIN_CHAT_MODELS,
  DEFAULT_OPEN_AREA,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  DEFAULT_SKILLS_FOLDER,
  SEND_SHORTCUT,
} from "@/constants";

export { getModelKeyFromModel } from "@/lib/model-key";

export interface LegacyCommandSettings {
  name: string;

  modelKey?: string;

  prompt: string;

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
  googleApiKey: string;
  openRouterAiApiKey: string;
  xaiApiKey: string;
  mistralApiKey: string;
  deepseekApiKey: string;
  siliconflowApiKey: string;
  defaultChainType: ChainType;
  defaultModelKey: string;
  contextTurns: number;
  lastDismissedVersion: string | null;
  lastShownStartupVersion: string | null;
  userSystemPrompt: string;
  openAIProxyBaseUrl: string;
  stream: boolean;
  copilotFolder: string;
  copilotRootHistory: string[];
  upgradedToV8FromLegacy: boolean;
  defaultSaveFolder: string;
  defaultConversationTag: string;
  autosaveChat: boolean;
  autoAddActiveContentToContext: boolean;
  customPromptsFolder: string;
  chatNoteContextPath: string;
  chatNoteContextTags: string[];
  debug: boolean;
  maxSourceChunks: number;
  enableInlineCitations: boolean;
  qaExclusions: string;
  qaInclusions: string;
  groqApiKey: string;
  activeModels: Array<CustomModel>;
  promptUsageTimestamps: Record<string, number>;
  promptSortStrategy: string;
  chatHistorySortStrategy: SortStrategy;
  projectsFolder: string;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  defaultSendShortcut: SEND_SHORTCUT;
  defaultConversationNoteName: string;
  isPaidUser: boolean | undefined;
  isPlusUser: boolean | undefined;
  entitlementToken: string;
  entitlementExpiresAt: number;
  inlineEditCommands: LegacyCommandSettings[] | undefined;
  projectList: Array<ProjectConfig>;
  passMarkdownImages: boolean;
  enableAutonomousAgent: boolean;
  enableCustomPromptTemplating: boolean;
  enableSelfHostMode: boolean;
  enableMiyo: boolean;
  enableMiyoSearchSkill: boolean;
  miyoSearchAll: boolean;
  relevantNotesLiveUpdate: boolean;
  miyoServerUrl: string;
  miyoConnectionMode?: "local" | "remote";
  selfHostSearchProvider: SelfHostSearchProvider;
  firecrawlApiKey: string;
  perplexityApiKey: string;
  parallelApiKey: string;
  exaApiKey: string;
  supadataApiKey: string;
  docProcessorBackend: "plus" | "miyo";
  enableLexicalBoosts: boolean;
  lexicalSearchRamLimit: number;
  suggestedDefaultCommands: boolean;
  autonomousAgentEnabledToolIds: string[];
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  verbosity: "low" | "medium" | "high";
  memoryFolderName: string;
  enableRecentConversations: boolean;
  maxRecentConversations: number;
  enableSavedMemory: boolean;
  quickCommandModelKey: string | undefined;
  quickCommandIncludeNoteContext: boolean;
  autoAcceptEdits: boolean;
  diffViewMode: "side-by-side" | "split";
  userSystemPromptsFolder: string;
  defaultSystemPromptTitle: string;
  autoCompactThreshold: number;
  convertedDocOutputFolder: string;
  _keychainVaultId?: string;
  _pendingCredentialRecovery?: { deviceId: string; path: string; encrypted: boolean };
  settingsVersion?: number;
  agentMode: {
    byok: { anthropic?: string; openai?: string; google?: string };
    activeBackend: string;
    backends: {
      opencode?: OpencodeBackendSettings;
      claude?: ClaudeBackendSettings;
      codex?: CodexBackendSettings;
    };
    // Keyed by device id because binary paths must not sync across devices:
    // https://github.com/logancyang/obsidian-copilot/issues/2539
    deviceProfiles?: Record<string, DeviceAgentProfile>;
    claudeCli?: { path?: string };
    debugFullFrames: boolean;
    notificationSound: boolean;
    notificationSoundId: NotificationSoundId;
    welcomeDismissed: boolean;
    skills: {
      folder: string;
      suppressMigrationConfirm?: boolean;
      builtinPreferences?: Record<string, { disabled?: boolean; disabledAgents?: string[] }>;
    };
  };
  providers: Record<string, Provider>;
  configuredModels: ConfiguredModel[];
  backends: Partial<Record<BackendType, BackendConfig>>;
  // One value because the lineup and which of it a license switches on must not disagree:
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  copilotPlusCatalog: PersistedCopilotPlusCatalog;
}

export type SelfHostSearchProvider = "firecrawl" | "perplexity" | "parallel" | "exa";

export type ClaudeAutoModePermission = "acceptEdits" | "auto" | "bypassPermissions";

export interface ClaudeBackendSettings {
  defaultModel?: ModelSelection | null;
  defaultMode?: CopilotMode | null;
  autoModePermission?: ClaudeAutoModePermission;
  enableThinking?: boolean;
  envOverrides?: Record<string, string>;
}

export interface CodexBackendSettings {
  binaryVersion?: string;
  binaryPath?: string;
  binarySource?: "managed" | "custom";
  defaultModel?: ModelSelection | null;
  defaultMode?: CopilotMode | null;
  envOverrides?: Record<string, string>;
}

export interface OpencodeBackendSettings {
  binaryVersion?: string;
  binaryPath?: string;
  binarySource?: "managed" | "custom";
  defaultModel?: ModelSelection | null;
  defaultMode?: CopilotMode | null;
  probeSessionId?: string;
  envOverrides?: Record<string, string>;
}

export interface DeviceAgentProfile {
  claudeCliPath?: string;
  codex?: {
    binaryPath?: string;
    binaryVersion?: string;
    binarySource?: "managed" | "custom";
    envOverrides?: Record<string, string>;
  };
  opencode?: {
    binaryPath?: string;
    binaryVersion?: string;
    binarySource?: "managed" | "custom";
    probeSessionId?: string;
    envOverrides?: Record<string, string>;
  };
  claude?: {
    envOverrides?: Record<string, string>;
  };
}

export const settingsStore = createStore();
export const settingsAtom = atom<CopilotSettings>(DEFAULT_SETTINGS);

const EMPTY_PROVIDERS = Object.freeze({}) as unknown as Record<string, Provider>;
const EMPTY_CONFIGURED_MODELS = Object.freeze([]) as unknown as ConfiguredModel[];
const EMPTY_BACKENDS = Object.freeze({}) as unknown as Partial<Record<BackendType, BackendConfig>>;
const EMPTY_COPILOT_PLUS_CATALOG = Object.freeze({
  models: Object.freeze([]),
  defaultEnabledIds: Object.freeze([]),
}) as unknown as PersistedCopilotPlusCatalog;

const EMPTY_COPILOT_ROOT_HISTORY = Object.freeze([]) as unknown as string[];

export function normalizeRootFolders(input: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const normalized = raw
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .split("/")
      .filter((segment) => segment !== ".")
      .join("/")
      .replace(/\/+$/, "");
    if (normalized.length === 0) continue;
    const escapesVault =
      /(^|\/)\.\.(\/|$)/.test(normalized) ||
      /^[a-zA-Z]:/.test(normalized) ||
      normalized.startsWith("/");
    if (escapesVault) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.length > 0 ? result : EMPTY_COPILOT_ROOT_HISTORY;
}

export function setSettings(
  settings: Partial<CopilotSettings> | ((current: CopilotSettings) => Partial<CopilotSettings>)
) {
  settingsStore.set(settingsAtom, (prev) => {
    const partial = typeof settings === "function" ? settings(prev) : settings;
    return mergeActiveChatModelsWithCoreModels({ ...prev, ...partial });
  });
}

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
    if (!canonicalToOriginalPattern.has(canonicalKey)) {
      const normalizedValue =
        canonical.length > 0 && pattern.endsWith("/") ? `${canonical}/` : pattern;
      canonicalToOriginalPattern.set(canonicalKey, normalizedValue);
    }
  });

  return Array.from(canonicalToOriginalPattern.values())
    .map((pattern) => encodeURIComponent(pattern))
    .join(",");
}

export function updateSetting<K extends keyof CopilotSettings>(key: K, value: CopilotSettings[K]) {
  setSettings((cur) => ({ ...cur, [key]: value }));
}

export function updateAgentModeBackendFields<
  K extends keyof CopilotSettings["agentMode"]["backends"],
>(key: K, partial: Partial<NonNullable<CopilotSettings["agentMode"]["backends"][K]>>): void {
  setSettings((cur) => ({
    agentMode: {
      ...cur.agentMode,
      backends: {
        ...cur.agentMode.backends,
        [key]: { ...(cur.agentMode.backends?.[key] ?? {}), ...partial },
      },
    },
  }));
}

export function getSettings(): Readonly<CopilotSettings> {
  return settingsStore.get(settingsAtom);
}

// Non-secret routing fields stay out of `MODEL_SECRET_FIELDS` (persist-time stripping would blank them),
// but a key without its `baseUrl` could be sent to the provider's default host after reset:
// https://github.com/logancyang/obsidian-copilot-preview/issues/259
const MODEL_CREDENTIAL_BUNDLE_FIELDS = [
  ...MODEL_SECRET_FIELDS,
  "baseUrl",
  "enableCors",
  "openAIOrgId",
] as const satisfies readonly (keyof CustomModel)[];

// Session proof, not a credential: it is bound to `settings.userId`, which reset replaces, so a
// carried-over token could never verify again:
// https://github.com/logancyang/obsidian-copilot-preview/issues/259
const SESSION_PROOF_FIELD = "entitlementToken";

const TOP_LEVEL_CREDENTIAL_COMPANION_FIELDS = [
  "openAIOrgId",
] as const satisfies readonly (keyof CopilotSettings)[];

const TOP_LEVEL_CREDENTIAL_BUNDLE_FIELDS: readonly string[] = [
  ...TOP_LEVEL_SECRET_FIELDS.filter((field) => field !== SESSION_PROOF_FIELD),
  ...TOP_LEVEL_CREDENTIAL_COMPANION_FIELDS,
];

// Only `enableCors` is legitimately non-string; the string check stops a corrupted value from
// surviving reset and throwing at its consumer:
// https://github.com/logancyang/obsidian-copilot-preview/issues/259
function carriesConfiguration(field: string, value: unknown): boolean {
  if (field === "enableCors") return typeof value === "boolean";
  return typeof value === "string" && value.length > 0;
}

function withPreservedModelCredential(defaultModel: CustomModel, source: CustomModel): CustomModel {
  const merged = { ...defaultModel } as unknown as Record<string, unknown>;
  const sourceRecord = source as unknown as Record<string, unknown>;
  for (const field of MODEL_CREDENTIAL_BUNDLE_FIELDS) {
    const value = sourceRecord[field];
    if (carriesConfiguration(field, value)) {
      merged[field] = value;
    }
  }
  return merged as unknown as CustomModel;
}

function preserveModelCredentials(
  defaultModels: CustomModel[],
  currentModels: CustomModel[]
): CustomModel[] {
  const currentByKey = new Map(currentModels.map((model) => [getModelKeyFromModel(model), model]));
  const defaultKeys = new Set(defaultModels.map((model) => getModelKeyFromModel(model)));

  const restoredBuiltIns = defaultModels.map((defaultModel) => {
    const previous = currentByKey.get(getModelKeyFromModel(defaultModel));
    return previous ? withPreservedModelCredential(defaultModel, previous) : defaultModel;
  });

  // Reason: every custom row is kept, including apparently keyless ones. The
  // keychain is the sole secret store, so an empty in-memory `apiKey` is
  // ambiguous — it means either "no credential" or "this session's keychain
  // read failed". Dropping the row on that signal would strand the keychain
  // entry with no `name|provider` identity left to reattach it to. Reset is not
  // a cleanup tool, so it errs toward keeping rows.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/259
  const customModels = currentModels.filter(
    (model) => !defaultKeys.has(getModelKeyFromModel(model))
  );

  return [...restoredBuiltIns, ...customModels];
}

// Selection is by pointer truthiness, not `requiresApiKey`: Plus creates its provider with
// `requiresApiKey: false` and stores the license key via `setApiKey`:
// https://github.com/logancyang/obsidian-copilot-preview/issues/259
function preserveProvidersWithCredentials(
  providers: Record<string, Provider> | undefined
): Record<string, Provider> {
  const preserved = Object.entries(providers ?? {}).filter(
    ([, provider]) => !!provider?.apiKeyKeychainId
  );
  return preserved.length > 0 ? Object.fromEntries(preserved) : EMPTY_PROVIDERS;
}

function preserveConfiguredModelsForProviders(
  configuredModels: ConfiguredModel[] | undefined,
  preservedProviderIds: Set<string>
): ConfiguredModel[] {
  if (!Array.isArray(configuredModels) || configuredModels.length === 0) {
    return EMPTY_CONFIGURED_MODELS;
  }
  const preserved = configuredModels.filter((model) => preservedProviderIds.has(model.providerId));
  return preserved.length > 0 ? preserved : EMPTY_CONFIGURED_MODELS;
}

export function resetSettings(): void {
  const current = getSettings();
  const currentRecord = current as unknown as Record<string, unknown>;
  const preservedRootHistory = normalizeRootFolders([
    ...(Array.isArray(current.copilotRootHistory) ? current.copilotRootHistory : []),
    current.copilotFolder,
  ]);
  const preservedTopLevelSecrets: Record<string, unknown> = {};
  for (const field of TOP_LEVEL_CREDENTIAL_BUNDLE_FIELDS) {
    const value = currentRecord[field];
    if (carriesConfiguration(field, value)) {
      preservedTopLevelSecrets[field] = value;
    }
  }
  const preservedProviders = preserveProvidersWithCredentials(current.providers);
  const preservedProviderIds = new Set(Object.keys(preservedProviders));
  const defaultSettingsWithBuiltIns = {
    ...DEFAULT_SETTINGS,
    ...preservedTopLevelSecrets,
    // Reason: reset is not a sign-out event. Flipping `isPaidUser` to the
    // default `false` reads as sign-out to the settings subscriber, whose
    // Plus reconcile tears down the preserved Plus provider, its models, and
    // its keychain entry (`plusSyncNeeded` → `unregisterPlusProvider`). Keep
    // the last server-confirmed paid state AND its original expiry bound until
    // the preserved license is revalidated — the expiry is tighten-only data
    // (`isEntitlementExpired`), so keeping it can only close the license UI
    // earlier, never hold it open; zeroing it would leave a tokenless
    // paid-Active display with no time bound while offline. The strict
    // `isPlusUser` flag is NOT kept: reset drops the signed entitlement
    // token, and the strict gate must never trust a bare boolean without
    // that proof — the next validation re-derives it.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/259
    isPaidUser: current.isPaidUser,
    entitlementExpiresAt: current.entitlementExpiresAt,
    activeModels: preserveModelCredentials(
      BUILTIN_CHAT_MODELS.map((model) => ({ ...model, enabled: true })),
      current.activeModels ?? []
    ),
    providers: preservedProviders,
    configuredModels: preserveConfiguredModelsForProviders(
      current.configuredModels,
      preservedProviderIds
    ),
    // Reset keeps the Plus provider and its models without re-syncing
    // (`plusSyncNeeded` stays false), so clearing this cache would leave those
    // models with no context window for the rest of the session.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
    copilotPlusCatalog: current.copilotPlusCatalog ?? EMPTY_COPILOT_PLUS_CATALOG,
    copilotRootHistory: preservedRootHistory,
  };
  setSettings(defaultSettingsWithBuiltIns);
}

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

export function useSettingsValue(): Readonly<CopilotSettings> {
  return useAtomValue(settingsAtom, {
    store: settingsStore,
  });
}

export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  const settingsToSanitize = settings || DEFAULT_SETTINGS;
  const rawSettings = settingsToSanitize as unknown as Record<string, unknown>;
  const {
    enableSelfHostedSearch: legacyEnableSelfHostedSearch,
    enableMiyoSearch: legacyEnableMiyoSearch,
  } = rawSettings;

  if (!settingsToSanitize.userId) {
    settingsToSanitize.userId = uuidv4();
  }

  const sanitizedSettings: CopilotSettings = { ...settingsToSanitize };
  sanitizedSettings.lastShownStartupVersion ??= null;
  const sanitizedSettingsRecord = sanitizedSettings as unknown as Record<string, unknown>;
  delete sanitizedSettingsRecord.miyoRemoteVaultPath;
  delete sanitizedSettingsRecord.miyoVaultName;
  delete sanitizedSettingsRecord.enableMiyoSearch;
  // Amazon Bedrock is no longer a chat provider, so a stored key and region
  // would only be credentials for a service Copilot can no longer reach.
  // https://github.com/logancyang/obsidian-copilot/issues/2928
  delete sanitizedSettingsRecord.amazonBedrockApiKey;
  delete sanitizedSettingsRecord.amazonBedrockRegion;
  // Azure OpenAI is no longer a chat provider, so a stored key and its routing
  // fields would only address a service Copilot cannot reach.
  // https://github.com/logancyang/obsidian-copilot/issues/2932
  delete sanitizedSettingsRecord.azureOpenAIApiKey;
  delete sanitizedSettingsRecord.azureOpenAIApiInstanceName;
  delete sanitizedSettingsRecord.azureOpenAIApiDeploymentName;
  delete sanitizedSettingsRecord.azureOpenAIApiVersion;
  // Copilot no longer limits how long an answer may be, so a stored limit
  // would only cut off answers the model was willing to finish.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/312
  delete sanitizedSettingsRecord.maxTokens;

  if (
    legacyEnableSelfHostedSearch !== undefined &&
    sanitizedSettings.enableSelfHostMode === undefined
  ) {
    sanitizedSettings.enableSelfHostMode = legacyEnableSelfHostedSearch as boolean;
  }

  if (legacyEnableMiyoSearch !== undefined && sanitizedSettings.enableMiyo === undefined) {
    sanitizedSettings.enableMiyo = legacyEnableMiyoSearch as boolean;
  }

  if (
    typeof sanitizedSettings.isPaidUser !== "boolean" &&
    typeof rawSettings.isPlusUser === "boolean"
  ) {
    sanitizedSettings.isPaidUser = rawSettings.isPlusUser;
  }

  const contextTurns = Number(settingsToSanitize.contextTurns);
  sanitizedSettings.contextTurns = isNaN(contextTurns)
    ? DEFAULT_SETTINGS.contextTurns
    : contextTurns;

  const lexicalSearchRamLimit = Number(settingsToSanitize.lexicalSearchRamLimit);
  if (isNaN(lexicalSearchRamLimit)) {
    sanitizedSettings.lexicalSearchRamLimit = DEFAULT_SETTINGS.lexicalSearchRamLimit;
  } else {
    sanitizedSettings.lexicalSearchRamLimit = Math.min(1000, Math.max(20, lexicalSearchRamLimit));
  }

  if (typeof sanitizedSettings.autoAddActiveContentToContext !== "boolean") {
    const oldNoteContext = (settingsToSanitize as unknown as Record<string, unknown>)
      .includeActiveNoteAsContext;
    if (typeof oldNoteContext === "boolean") {
      sanitizedSettings.autoAddActiveContentToContext = oldNoteContext;
    } else {
      sanitizedSettings.autoAddActiveContentToContext =
        DEFAULT_SETTINGS.autoAddActiveContentToContext;
    }
  }

  if (typeof sanitizedSettings.enableMiyo !== "boolean") {
    sanitizedSettings.enableMiyo = DEFAULT_SETTINGS.enableMiyo;
  }

  if (typeof sanitizedSettings.enableMiyoSearchSkill !== "boolean") {
    sanitizedSettings.enableMiyoSearchSkill = DEFAULT_SETTINGS.enableMiyoSearchSkill;
  }

  if (typeof sanitizedSettings.miyoSearchAll !== "boolean") {
    sanitizedSettings.miyoSearchAll = DEFAULT_SETTINGS.miyoSearchAll;
  }

  if (typeof sanitizedSettings.relevantNotesLiveUpdate !== "boolean") {
    sanitizedSettings.relevantNotesLiveUpdate = DEFAULT_SETTINGS.relevantNotesLiveUpdate;
  }

  if (typeof sanitizedSettings.miyoServerUrl !== "string") {
    sanitizedSettings.miyoServerUrl = DEFAULT_SETTINGS.miyoServerUrl;
  }
  if (!["local", "remote"].includes(sanitizedSettings.miyoConnectionMode || "")) {
    sanitizedSettings.miyoConnectionMode = sanitizedSettings.miyoServerUrl.trim()
      ? "remote"
      : "local";
  }

  // Persisted Parallel and Exa choices must survive reload instead of silently
  // reverting to Firecrawl. https://github.com/Brevilabs/obsidian-copilot-private/issues/285
  const validSearchProviders = ["firecrawl", "perplexity", "parallel", "exa"] as const;
  if (!validSearchProviders.includes(sanitizedSettings.selfHostSearchProvider)) {
    sanitizedSettings.selfHostSearchProvider = DEFAULT_SETTINGS.selfHostSearchProvider;
  }

  const validDocProcessorBackends = ["plus", "miyo"] as const;
  if (!validDocProcessorBackends.includes(sanitizedSettings.docProcessorBackend)) {
    sanitizedSettings.docProcessorBackend = DEFAULT_SETTINGS.docProcessorBackend;
  }

  if (typeof sanitizedSettings.passMarkdownImages !== "boolean") {
    sanitizedSettings.passMarkdownImages = DEFAULT_SETTINGS.passMarkdownImages;
  }

  if (typeof sanitizedSettings.enableInlineCitations !== "boolean") {
    sanitizedSettings.enableInlineCitations = DEFAULT_SETTINGS.enableInlineCitations;
  }

  if (typeof sanitizedSettings.enableCustomPromptTemplating !== "boolean") {
    sanitizedSettings.enableCustomPromptTemplating = DEFAULT_SETTINGS.enableCustomPromptTemplating;
  }

  if (!Array.isArray(sanitizedSettings.autonomousAgentEnabledToolIds)) {
    sanitizedSettings.autonomousAgentEnabledToolIds =
      DEFAULT_SETTINGS.autonomousAgentEnabledToolIds;
  }

  const toolIdRenames: Record<string, string> = {
    writeToFile: "writeFile",
    replaceInFile: "editFile",
  };
  sanitizedSettings.autonomousAgentEnabledToolIds =
    sanitizedSettings.autonomousAgentEnabledToolIds.map((id) => toolIdRenames[id] ?? id);

  if (
    !sanitizedSettings.memoryFolderName ||
    typeof sanitizedSettings.memoryFolderName !== "string"
  ) {
    sanitizedSettings.memoryFolderName = DEFAULT_SETTINGS.memoryFolderName;
  }

  if (typeof sanitizedSettings.enableRecentConversations !== "boolean") {
    sanitizedSettings.enableRecentConversations = DEFAULT_SETTINGS.enableRecentConversations;
  }

  if (typeof sanitizedSettings.enableSavedMemory !== "boolean") {
    sanitizedSettings.enableSavedMemory = DEFAULT_SETTINGS.enableSavedMemory;
  }

  const maxRecentConversations = Number(settingsToSanitize.maxRecentConversations);
  if (isNaN(maxRecentConversations) || maxRecentConversations < 10 || maxRecentConversations > 50) {
    sanitizedSettings.maxRecentConversations = DEFAULT_SETTINGS.maxRecentConversations;
  } else {
    sanitizedSettings.maxRecentConversations = maxRecentConversations;
  }

  if (typeof sanitizedSettings.autosaveChat !== "boolean") {
    sanitizedSettings.autosaveChat = DEFAULT_SETTINGS.autosaveChat;
  }

  const autoCompactThreshold = Number(settingsToSanitize.autoCompactThreshold);
  if (isNaN(autoCompactThreshold)) {
    sanitizedSettings.autoCompactThreshold = DEFAULT_SETTINGS.autoCompactThreshold;
  } else {
    sanitizedSettings.autoCompactThreshold = Math.min(
      1000000,
      Math.max(64000, autoCompactThreshold)
    );
  }

  if (typeof sanitizedSettings.quickCommandIncludeNoteContext !== "boolean") {
    sanitizedSettings.quickCommandIncludeNoteContext =
      DEFAULT_SETTINGS.quickCommandIncludeNoteContext;
  }

  if (
    settingsToSanitize.quickCommandModelKey !== undefined &&
    typeof settingsToSanitize.quickCommandModelKey !== "string"
  ) {
    sanitizedSettings.quickCommandModelKey = DEFAULT_SETTINGS.quickCommandModelKey;
  }

  if (typeof sanitizedSettings.autoAcceptEdits !== "boolean") {
    sanitizedSettings.autoAcceptEdits = DEFAULT_SETTINGS.autoAcceptEdits;
  }

  if (!Object.values(SEND_SHORTCUT).includes(sanitizedSettings.defaultSendShortcut)) {
    sanitizedSettings.defaultSendShortcut = DEFAULT_SETTINGS.defaultSendShortcut;
  }

  const copilotFolderValidation = validateCopilotFolder(
    typeof settingsToSanitize.copilotFolder === "string" ? settingsToSanitize.copilotFolder : ""
  );
  sanitizedSettings.copilotFolder = copilotFolderValidation.ok
    ? copilotFolderValidation.folder
    : DEFAULT_SETTINGS.copilotFolder;

  const rawRootHistory = Array.isArray(settingsToSanitize.copilotRootHistory)
    ? settingsToSanitize.copilotRootHistory
    : [];
  sanitizedSettings.copilotRootHistory = normalizeRootFolders([
    ...rawRootHistory,
    sanitizedSettings.copilotFolder,
  ]);

  if (typeof sanitizedSettings.upgradedToV8FromLegacy !== "boolean") {
    sanitizedSettings.upgradedToV8FromLegacy = DEFAULT_SETTINGS.upgradedToV8FromLegacy;
  }

  const saveFolder = (settingsToSanitize.defaultSaveFolder || "").trim();
  sanitizedSettings.defaultSaveFolder =
    saveFolder.length > 0 ? saveFolder : DEFAULT_SETTINGS.defaultSaveFolder;

  const promptsFolder = (settingsToSanitize.customPromptsFolder || "").trim();
  sanitizedSettings.customPromptsFolder =
    promptsFolder.length > 0 ? promptsFolder : DEFAULT_SETTINGS.customPromptsFolder;

  const projectsFolder = (settingsToSanitize.projectsFolder || "").trim();
  const hasTraversal =
    /(^|[/\\])\.\.[/\\]?/.test(projectsFolder) ||
    /^[a-zA-Z]:/.test(projectsFolder) ||
    /^[/\\]/.test(projectsFolder);
  sanitizedSettings.projectsFolder =
    projectsFolder.length > 0 && !hasTraversal ? projectsFolder : DEFAULT_SETTINGS.projectsFolder;

  if (
    !isSortStrategy(sanitizedSettings.chatHistorySortStrategy) ||
    sanitizedSettings.chatHistorySortStrategy === "manual"
  ) {
    sanitizedSettings.chatHistorySortStrategy = DEFAULT_SETTINGS.chatHistorySortStrategy;
  }

  // Fall back when a vault still holds a retired Quick Chat mode. Both Vault QA
  // and Projects were persisted here, and chain construction would otherwise
  // fail before the mode picker could render.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/286
  // https://github.com/logancyang/obsidian-copilot-preview/issues/310
  if (!Object.values(ChainType).includes(sanitizedSettings.defaultChainType)) {
    sanitizedSettings.defaultChainType = DEFAULT_SETTINGS.defaultChainType;
  }

  const userSystemPromptsFolder = (settingsToSanitize.userSystemPromptsFolder || "").trim();
  sanitizedSettings.userSystemPromptsFolder =
    userSystemPromptsFolder.length > 0
      ? userSystemPromptsFolder
      : DEFAULT_SETTINGS.userSystemPromptsFolder;

  sanitizedSettings.qaExclusions = sanitizeQaExclusions(settingsToSanitize.qaExclusions);

  sanitizedSettings.agentMode = sanitizeAgentMode(sanitizedSettings.agentMode);

  if (
    !sanitizedSettings.providers ||
    typeof sanitizedSettings.providers !== "object" ||
    Array.isArray(sanitizedSettings.providers)
  ) {
    sanitizedSettings.providers = EMPTY_PROVIDERS;
  }
  if (!Array.isArray(sanitizedSettings.configuredModels)) {
    sanitizedSettings.configuredModels = EMPTY_CONFIGURED_MODELS;
  }
  // Absent on every data.json written before the lineup was cached, and
  // arbitrary on a synced or hand-edited one. Consumers dereference `model.id`
  // straight out of this array, so one malformed entry would crash the pickers.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
  const cachedCatalog = sanitizedSettings.copilotPlusCatalog;
  const catalogIsUsable =
    !!cachedCatalog &&
    typeof cachedCatalog === "object" &&
    Array.isArray(cachedCatalog.models) &&
    Array.isArray(cachedCatalog.defaultEnabledIds) &&
    cachedCatalog.models.every(
      (model) =>
        !!model &&
        typeof model === "object" &&
        typeof model.id === "string" &&
        typeof model.displayName === "string"
    ) &&
    cachedCatalog.defaultEnabledIds.every((id) => typeof id === "string");
  if (!catalogIsUsable) {
    sanitizedSettings.copilotPlusCatalog = EMPTY_COPILOT_PLUS_CATALOG;
  }
  if (
    !sanitizedSettings.backends ||
    typeof sanitizedSettings.backends !== "object" ||
    Array.isArray(sanitizedSettings.backends)
  ) {
    sanitizedSettings.backends = EMPTY_BACKENDS;
  }

  return sanitizedSettings;
}

function sanitizeAgentMode(raw: unknown): CopilotSettings["agentMode"] {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS.agentMode };
  }
  const r = raw as Record<string, unknown>;
  const byok =
    r.byok && typeof r.byok === "object"
      ? (r.byok as { anthropic?: string; openai?: string; google?: string })
      : {};
  const activeBackend =
    typeof r.activeBackend === "string"
      ? r.activeBackend
      : DEFAULT_SETTINGS.agentMode.activeBackend;

  const backendsRaw =
    r.backends && typeof r.backends === "object" ? (r.backends as Record<string, unknown>) : {};
  const existingOpencode = backendsRaw.opencode as Record<string, unknown> | undefined;
  const existingClaude = backendsRaw.claude as Record<string, unknown> | undefined;
  const existingCodex = backendsRaw.codex as Record<string, unknown> | undefined;

  const opencodeSlice = existingOpencode
    ? sanitizeOpencodeBackendSettings(existingOpencode)
    : undefined;
  const claudeSlice = existingClaude ? sanitizeClaudeBackendSettings(existingClaude) : undefined;
  const codexSlice = existingCodex ? sanitizeCodexBackendSettings(existingCodex) : undefined;

  const backends: CopilotSettings["agentMode"]["backends"] = {};
  if (opencodeSlice) backends.opencode = opencodeSlice;
  if (claudeSlice) backends.claude = claudeSlice;
  if (codexSlice) backends.codex = codexSlice;

  const deviceProfiles = sanitizeDeviceProfiles(r.deviceProfiles);

  const debugFullFrames =
    typeof r.debugFullFrames === "boolean"
      ? r.debugFullFrames
      : DEFAULT_SETTINGS.agentMode.debugFullFrames;

  const notificationSound =
    typeof r.notificationSound === "boolean"
      ? r.notificationSound
      : DEFAULT_SETTINGS.agentMode.notificationSound;

  // A sound dropped from the catalog would otherwise persist as a name nothing
  // can play, leaving the user silently unnotified.
  // https://github.com/logancyang/obsidian-copilot/issues/2987
  const notificationSoundId = isNotificationSoundId(r.notificationSoundId)
    ? r.notificationSoundId
    : DEFAULT_SETTINGS.agentMode.notificationSoundId;

  const welcomeDismissed =
    typeof r.welcomeDismissed === "boolean"
      ? r.welcomeDismissed
      : DEFAULT_SETTINGS.agentMode.welcomeDismissed;

  const claudeCliRaw =
    r.claudeCli && typeof r.claudeCli === "object"
      ? (r.claudeCli as Record<string, unknown>)
      : null;
  const claudeCliPath =
    claudeCliRaw && typeof claudeCliRaw.path === "string" ? claudeCliRaw.path : undefined;
  const claudeCli = claudeCliPath ? { path: claudeCliPath } : undefined;

  const skillsRaw =
    r.skills && typeof r.skills === "object" ? (r.skills as Record<string, unknown>) : null;
  const skillsFolderRaw = skillsRaw && typeof skillsRaw.folder === "string" ? skillsRaw.folder : "";
  const skillsValidation = validateSkillsFolder(skillsFolderRaw);
  const suppressMigrationConfirm =
    skillsRaw && typeof skillsRaw.suppressMigrationConfirm === "boolean"
      ? skillsRaw.suppressMigrationConfirm
      : undefined;
  const skills: CopilotSettings["agentMode"]["skills"] = {
    folder: skillsValidation.ok
      ? skillsValidation.folder
      : DEFAULT_SETTINGS.agentMode.skills.folder,
    ...(suppressMigrationConfirm !== undefined ? { suppressMigrationConfirm } : {}),
    ...(skillsRaw?.builtinPreferences !== undefined
      ? { builtinPreferences: sanitizeBuiltinPreferences(skillsRaw.builtinPreferences) }
      : {}),
  };

  return {
    byok,
    activeBackend,
    backends,
    debugFullFrames,
    notificationSound,
    notificationSoundId,
    welcomeDismissed,
    skills,
    ...(claudeCli ? { claudeCli } : {}),
    ...(deviceProfiles ? { deviceProfiles } : {}),
  };
}

type BuiltinPreferences = NonNullable<CopilotSettings["agentMode"]["skills"]["builtinPreferences"]>;
const EMPTY_BUILTIN_PREFERENCES: BuiltinPreferences = Object.freeze({});

export function sanitizeBuiltinPreferences(raw: unknown): BuiltinPreferences {
  // Defaults need no records; removed skills must not leave stale settings behind.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_BUILTIN_PREFERENCES;
  }
  const preferences: BuiltinPreferences = {};
  for (const { name } of ALL_MANAGED_SKILLS) {
    const value = (raw as Record<string, unknown>)[name];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const pref = value as Record<string, unknown>;
    // Keep opt-outs for agents absent on this device so sync cannot re-enable them.
    // https://github.com/logancyang/obsidian-copilot/issues/3022
    const disabledAgents = Array.isArray(pref.disabledAgents)
      ? pref.disabledAgents.filter((agent): agent is string => typeof agent === "string")
      : [];
    if (pref.disabled === true || disabledAgents.length > 0) {
      preferences[name] = {
        ...(pref.disabled === true ? { disabled: true } : {}),
        ...(disabledAgents.length > 0 ? { disabledAgents } : {}),
      };
    }
  }
  return Object.keys(preferences).length > 0 ? preferences : EMPTY_BUILTIN_PREFERENCES;
}

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// eslint-disable-next-line no-control-regex -- settings paths must reject embedded control bytes
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

function validateSkillsFolder(
  value: string
): { ok: true; folder: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: true, folder: DEFAULT_SKILLS_FOLDER };
  }

  let cleaned = value.trim().replace(/\\/g, "/");

  while (cleaned.startsWith("./")) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.startsWith("/")) {
    cleaned = cleaned.replace(/^\/+/, "");
  }
  cleaned = cleaned.replace(/\/+$/, "");

  if (cleaned.length === 0) {
    return { ok: true, folder: DEFAULT_SKILLS_FOLDER };
  }

  const segments = cleaned.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return { ok: false, reason: "Folder path cannot contain empty segments (//)." };
    }
    if (segment === "..") {
      return { ok: false, reason: 'Folder path cannot contain ".." segments.' };
    }
    if (segment === ".") {
      return { ok: false, reason: 'Folder path cannot contain "." segments.' };
    }
    if (CONTROL_CHAR_RE.test(segment)) {
      return { ok: false, reason: "Folder path contains illegal control characters." };
    }
    if (/[<>:"|?*]/.test(segment)) {
      return {
        ok: false,
        reason: 'Folder path contains characters not allowed in folder names (< > : " | ? *).',
      };
    }
  }

  return { ok: true, folder: cleaned };
}

export function validateCopilotFolder(
  value: string,
  configDir?: string
): { ok: true; folder: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: "Folder name cannot be empty." };
  }
  const trimmed = value.trim();
  if (/^[/\\]/.test(trimmed) || /^[a-zA-Z]:/.test(trimmed)) {
    return { ok: false, reason: "Folder path must be relative to the vault root." };
  }
  const cleaned = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  if (cleaned.length === 0) {
    return { ok: false, reason: "Folder name cannot be empty." };
  }
  const normalizedConfigDir = configDir
    ?.trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  const cleanedLower = cleaned.toLowerCase();
  if (
    normalizedConfigDir &&
    (cleanedLower === normalizedConfigDir ||
      cleanedLower.startsWith(`${normalizedConfigDir}/`) ||
      normalizedConfigDir.startsWith(`${cleanedLower}/`))
  ) {
    return {
      ok: false,
      reason: "Folder path cannot use the Obsidian config folder.",
    };
  }
  for (const segment of cleaned.split("/")) {
    if (segment.length === 0) {
      return { ok: false, reason: "Folder path cannot contain empty segments (//)." };
    }
    if (segment === "..") {
      return { ok: false, reason: 'Folder path cannot contain ".." segments.' };
    }
    if (segment === ".") {
      return { ok: false, reason: 'Folder path cannot contain "." segments.' };
    }
    if (CONTROL_CHAR_RE.test(segment)) {
      return { ok: false, reason: "Folder path contains illegal control characters." };
    }
    if (/[<>:"|?*]/.test(segment)) {
      return {
        ok: false,
        reason: 'Folder path contains characters not allowed in folder names (< > : " | ? *).',
      };
    }
    if (/[. ]$/.test(segment)) {
      return { ok: false, reason: "Folder names cannot end with a dot or space." };
    }
    if (WINDOWS_RESERVED_NAME_RE.test(segment)) {
      return { ok: false, reason: `"${segment}" is a name reserved by Windows.` };
    }
  }
  return { ok: true, folder: cleaned };
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function sanitizeDefaultModel(raw: unknown): ModelSelection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const baseModelId = typeof r.baseModelId === "string" && r.baseModelId ? r.baseModelId : null;
  if (!baseModelId) return undefined;
  const effort = typeof r.effort === "string" && r.effort ? r.effort : null;
  return { baseModelId, effort };
}

const COPILOT_MODES: readonly CopilotMode[] = ["default", "plan", "auto"];
function sanitizeDefaultMode(raw: unknown): CopilotMode | undefined {
  return typeof raw === "string" && (COPILOT_MODES as readonly string[]).includes(raw)
    ? (raw as CopilotMode)
    : undefined;
}

export const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function sanitizeEnvOverrides(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string") continue;
    if (!ENV_VAR_NAME_RE.test(k)) continue;
    if (typeof v !== "string") continue;
    if (CONTROL_CHAR_RE.test(v)) continue;
    out[k] = v;
    if (Object.keys(out).length >= 64) break;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const CLAUDE_AUTO_MODE_PERMISSIONS: readonly ClaudeAutoModePermission[] = [
  "acceptEdits",
  "auto",
  "bypassPermissions",
];
function sanitizeClaudeAutoModePermission(raw: unknown): ClaudeAutoModePermission | undefined {
  return typeof raw === "string" &&
    (CLAUDE_AUTO_MODE_PERMISSIONS as readonly string[]).includes(raw)
    ? (raw as ClaudeAutoModePermission)
    : undefined;
}

function sanitizeClaudeBackendSettings(raw: unknown): ClaudeBackendSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    defaultModel: sanitizeDefaultModel(r.defaultModel),
    defaultMode: sanitizeDefaultMode(r.defaultMode),
    autoModePermission: sanitizeClaudeAutoModePermission(r.autoModePermission),
    enableThinking: typeof r.enableThinking === "boolean" ? r.enableThinking : undefined,
    envOverrides: sanitizeEnvOverrides(r.envOverrides),
  };
}

function sanitizeCodexBackendSettings(raw: unknown): CodexBackendSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const binaryPath = nonEmptyString(r.binaryPath);
  const rawSource = r.binarySource;
  return {
    binaryPath,
    binaryVersion: binaryPath ? nonEmptyString(r.binaryVersion) : undefined,
    // Never take ownership of an existing or cross-device path.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    binarySource: binaryPath
      ? rawSource === "managed" || rawSource === "custom"
        ? rawSource
        : "custom"
      : undefined,
    defaultModel: sanitizeDefaultModel(r.defaultModel),
    defaultMode: sanitizeDefaultMode(r.defaultMode),
    envOverrides: sanitizeEnvOverrides(r.envOverrides),
  };
}

function sanitizeOpencodeBackendSettings(raw: unknown): OpencodeBackendSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const binaryPath = nonEmptyString(r.binaryPath);
  const binaryVersion = nonEmptyString(r.binaryVersion);
  const rawSource = r.binarySource;
  let binarySource: "managed" | "custom" | undefined;
  if (rawSource === "managed" || rawSource === "custom") {
    binarySource = binaryPath ? rawSource : undefined;
  } else {
    binarySource = binaryPath ? "managed" : undefined;
  }
  return {
    binaryPath,
    binaryVersion,
    binarySource,
    defaultModel: sanitizeDefaultModel(r.defaultModel),
    defaultMode: sanitizeDefaultMode(r.defaultMode),
    probeSessionId: nonEmptyString(r.probeSessionId),
    envOverrides: sanitizeEnvOverrides(r.envOverrides),
  };
}

function sanitizeDeviceAgentProfile(raw: unknown): DeviceAgentProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: DeviceAgentProfile = {};

  const claudeCliPath = nonEmptyString(r.claudeCliPath);
  if (claudeCliPath) out.claudeCliPath = claudeCliPath;

  const codexRaw =
    r.codex && typeof r.codex === "object" ? (r.codex as Record<string, unknown>) : null;
  if (codexRaw) {
    const codex: NonNullable<DeviceAgentProfile["codex"]> = {};
    const binaryPath = nonEmptyString(codexRaw.binaryPath);
    if (binaryPath) codex.binaryPath = binaryPath;
    const binaryVersion = binaryPath ? nonEmptyString(codexRaw.binaryVersion) : undefined;
    if (binaryVersion) codex.binaryVersion = binaryVersion;
    const rawSource = codexRaw.binarySource;
    if (binaryPath) {
      codex.binarySource = rawSource === "managed" || rawSource === "custom" ? rawSource : "custom";
    }
    const envOverrides = sanitizeEnvOverrides(codexRaw.envOverrides);
    if (envOverrides) codex.envOverrides = envOverrides;
    if (Object.keys(codex).length > 0) out.codex = codex;
  }

  const opencodeRaw =
    r.opencode && typeof r.opencode === "object" ? (r.opencode as Record<string, unknown>) : null;
  if (opencodeRaw) {
    const opencode: NonNullable<DeviceAgentProfile["opencode"]> = {};
    const binaryPath = nonEmptyString(opencodeRaw.binaryPath);
    if (binaryPath) opencode.binaryPath = binaryPath;
    const binaryVersion = nonEmptyString(opencodeRaw.binaryVersion);
    if (binaryVersion) opencode.binaryVersion = binaryVersion;
    if (binaryPath) {
      const rawSource = opencodeRaw.binarySource;
      opencode.binarySource = rawSource === "custom" ? "custom" : "managed";
    }
    const probeSessionId = nonEmptyString(opencodeRaw.probeSessionId);
    if (probeSessionId) opencode.probeSessionId = probeSessionId;
    const envOverrides = sanitizeEnvOverrides(opencodeRaw.envOverrides);
    if (envOverrides) opencode.envOverrides = envOverrides;
    if (Object.keys(opencode).length > 0) out.opencode = opencode;
  }

  const claudeRaw =
    r.claude && typeof r.claude === "object" ? (r.claude as Record<string, unknown>) : null;
  if (claudeRaw) {
    const envOverrides = sanitizeEnvOverrides(claudeRaw.envOverrides);
    if (envOverrides) out.claude = { envOverrides };
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDeviceProfiles(raw: unknown): Record<string, DeviceAgentProfile> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, DeviceAgentProfile> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || key.length === 0) continue;
    const profile = sanitizeDeviceAgentProfile(value);
    if (profile) out[key] = profile;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeActiveChatModelsWithCoreModels(settings: CopilotSettings): CopilotSettings {
  settings.activeModels = mergeActiveModels(settings.activeModels, BUILTIN_CHAT_MODELS);
  return settings;
}

function mergeActiveModels(
  existingActiveModels: CustomModel[],
  builtInModels: CustomModel[]
): CustomModel[] {
  const modelMap = new Map<string, CustomModel>();

  builtInModels
    .filter((model) => model.core)
    .forEach((model) => {
      modelMap.set(getModelKeyFromModel(model), { ...model });
    });

  existingActiveModels.forEach((model) => {
    const key = getModelKeyFromModel(model);
    const existingModel = modelMap.get(key);
    if (existingModel) {
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
