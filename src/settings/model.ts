import { CustomModel, ProjectConfig } from "@/aiParams";
import { atom, createStore, useAtomValue } from "jotai";
import { v4 as uuidv4 } from "uuid";

import type { CopilotMode, ModelSelection } from "@/agentMode";
import { type ChainType } from "@/chainType";
import type { BackendConfig, BackendType, ConfiguredModel, Provider } from "@/modelManagement";
import { type SortStrategy, isSortStrategy } from "@/utils/recentUsageManager";
import {
  AGENT_MAX_ITERATIONS_LIMIT,
  BUILTIN_CHAT_MODELS,
  BUILTIN_EMBEDDING_MODELS,
  COPILOT_FOLDER_ROOT,
  DEFAULT_OPEN_AREA,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  DEFAULT_SKILLS_FOLDER,
  EmbeddingModelProviders,
  SEND_SHORTCUT,
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
  autoAddActiveContentToContext: boolean;
  customPromptsFolder: string;
  indexVaultToVectorStore: string;
  chatNoteContextPath: string;
  chatNoteContextTags: string[];
  enableIndexSync: boolean;
  debug: boolean;
  /** @deprecated Removed — keychain is now the sole encryption mechanism. */
  enableEncryption?: never;
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
  /** Projects config root folder in vault (default: "copilot/projects"). */
  projectsFolder: string;
  embeddingRequestsPerMin: number;
  embeddingBatchSize: number;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  defaultSendShortcut: SEND_SHORTCUT;
  disableIndexOnMobile: boolean;
  showSuggestedPrompts: boolean;
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
  /** Enable self-host mode (e.g., Miyo) - uses self-hosted services for search, LLMs, OCR, etc. */
  enableSelfHostMode: boolean;
  /** Enable Miyo-backed indexing and semantic search when self-host mode is active */
  enableMiyo: boolean;
  /** When true, omit folder_name from Miyo search requests so all indexed content is searched */
  miyoSearchAll: boolean;
  /** Timestamp of last successful Believer validation for self-host mode (null if never validated) */
  selfHostModeValidatedAt: number | null;
  /** Count of successful periodic validations (3 = permanently valid) */
  selfHostValidationCount: number;
  /** URL endpoint for the self-host mode backend */
  selfHostUrl: string;
  /** API key for the self-host mode backend (if required) */
  selfHostApiKey: string;
  /** Custom Miyo server URL, e.g. "http://192.168.1.10:8742" (empty = use local service discovery) */
  miyoServerUrl: string;
  /** Which provider to use for self-host web search */
  selfHostSearchProvider: "firecrawl" | "perplexity";
  /** Firecrawl API key for self-host web search */
  firecrawlApiKey: string;
  /** Perplexity API key for self-host web search via Sonar */
  perplexityApiKey: string;
  /** Supadata API key for self-host YouTube transcripts */
  supadataApiKey: string;
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
  /** Folder where converted document markdown files are saved */
  convertedDocOutputFolder: string;
  /**
   * When `true`, the OS keychain is the single source of truth for secrets;
   * data.json must never contain plaintext secret values.
   *
   * Set on:
   * - Fresh installs (no prior data.json) when keychain is available
   * - User clicking "Migrate to Keychain" in Advanced Settings
   * - `forgetAllSecrets` (after stripping disk + clearing keychain)
   */
  _keychainOnly?: boolean;
  /**
   * Stable namespace ID for keychain entries, persisted once on first use.
   * Reason: using a persisted ID (instead of deriving from vault path) means
   * renaming or moving the vault folder does not orphan keychain entries.
   */
  _keychainVaultId?: string;
  /**
   * Schema version, bumped by one-time migrations in `src/settings/migrations`.
   * Absent on pre-versioned installs (treated as `0`). Deliberately NOT in
   * `DEFAULT_SETTINGS` — a default value would defeat the migration gate via
   * the `setSettings` merge. See `runSettingsMigrations`.
   */
  settingsVersion?: number;
  /** Agent Mode (ACP-backed BYOK agent harness). Desktop only. */
  agentMode: {
    byok: { anthropic?: string; openai?: string; google?: string };
    /**
     * User-configured MCP servers passed to the agent on session start.
     * Stored as `unknown[]` here to keep settings independent of the
     * agentMode module. The agentMode layer owns the typed shape
     * (`StoredMcpServer`) and sanitizes on read via `sanitizeStoredMcpServers`.
     */
    mcpServers: unknown[];
    /** Which registered backend to use. Defaults to "opencode". */
    activeBackend: string;
    /** Per-backend config slice, keyed by BackendId. Each backend owns its slice. */
    backends: {
      opencode?: OpencodeBackendSettings;
      claude?: ClaudeBackendSettings;
      codex?: CodexBackendSettings;
    };
    /**
     * Per-device agent config (binary paths, env overrides, …) keyed by a
     * device-local id (see `getDeviceId`). A binary's location is
     * device-specific, but `data.json` syncs across devices — storing paths as
     * a single global value corrupts on sync (GitHub #2539). These live
     * here instead and are mirrored into the flat `claudeCli`/`backends.*`
     * fields in memory: `hydrateDeviceProfile` populates the flat fields from
     * this device's segment on load; `dehydrateDeviceProfile` moves them back
     * here and strips the flat fields on save. Other devices' segments are
     * preserved untouched. See `src/settings/deviceProfiles.ts`.
     */
    deviceProfiles?: Record<string, DeviceAgentProfile>;
    /**
     * Override path to the user-installed `claude` CLI used by the Claude
     * Agent SDK adapter. When unset, the resolver auto-detects across
     * Volta/asdf/NVM/Homebrew/npm-global. Surfaced in Advanced Settings
     * with a "Re-detect" button.
     */
    claudeCli?: { path?: string };
    /**
     * Opt-in: write the full untruncated ACP JSON-RPC frames as NDJSON to
     * `<vault>/copilot/acp-frames.ndjson`. Heavyweight — leaves the existing
     * 400-char summary log unchanged.
     */
    debugFullFrames: boolean;
    /**
     * Skills management — canonical-store discovery, symlink lifecycle,
     * reconciliation. See `designdocs/SKILLS_MANAGEMENT.md` and
     * `designdocs/SKILLS_DISCOVERY_REDESIGN.md`.
     */
    skills: {
      /**
       * Vault-root-relative POSIX path of the canonical skills folder.
       * Default `"copilot/skills"`. Validated by `validateSkillsFolder`.
       */
      folder: string;
      /**
       * Suppress the migration confirmation dialog when sharing a
       * project-managed skill across agents (or consolidating mirrored
       * duplicates). Set by the "Don't ask again" checkbox in the dialog.
       * Unset/false by default — the dialog appears for every qualifying
       * action until the user opts out.
       */
      suppressMigrationConfirm?: boolean;
    };
  };
  /**
   * Model-management persisted slices.
   */
  providers: Record<string, Provider>;
  configuredModels: ConfiguredModel[];
  backends: Partial<Record<BackendType, BackendConfig>>;
}

/**
 * Settings slice owned by the Claude (Agent SDK) backend. The user-
 * installed `claude` CLI path lives at top-level `agentMode.claudeCli.path`
 * so the resolver can be reused independently of which Anthropic
 * descriptor is active.
 */
export interface ClaudeBackendSettings {
  /** Sticky model preference — `{ baseModelId, effort }`. Unset = use the agent's default. */
  defaultModel?: ModelSelection | null;
  /** Sticky permission-mode preference (default/plan/auto). Unset = the agent's natural starting mode. */
  defaultMode?: CopilotMode | null;
  /**
   * Opt-in: pass `thinking: { type: "enabled" }` to the SDK so the agent
   * surfaces reasoning chunks. Off by default (matches SDK default).
   */
  enableThinking?: boolean;
  /**
   * User-defined environment variables merged on top of `process.env` when
   * spawning the `claude` CLI. Used to redirect config dirs
   * (`CLAUDE_CONFIG_DIR`), set proxies, or toggle vendor flags without
   * polluting the parent shell environment.
   */
  envOverrides?: Record<string, string>;
}

/** Settings slice owned by the Codex backend. */
export interface CodexBackendSettings {
  /** Path to the user-provided `codex-acp` binary. */
  binaryPath?: string;
  /** Sticky model preference — `{ baseModelId, effort }`. Unset = use the agent's default. */
  defaultModel?: ModelSelection | null;
  /** Sticky permission-mode preference (default/plan/auto). Unset = the agent's natural starting mode. */
  defaultMode?: CopilotMode | null;
  /** See `ClaudeBackendSettings.envOverrides`. Applied to the spawned `codex-acp` subprocess. */
  envOverrides?: Record<string, string>;
}

/** Settings slice owned by the OpenCode backend. */
export interface OpencodeBackendSettings {
  binaryVersion?: string;
  binaryPath?: string;
  /**
   * Whether the binary at `binaryPath` was installed by the plugin
   * (`"managed"`) or pointed at by the user (`"custom"`). Undefined for
   * legacy installs predating this field; sanitizer defaults to `"managed"`
   * when a `binaryPath` exists.
   */
  binarySource?: "managed" | "custom";
  /**
   * Sticky model preference — `{ baseModelId, effort }`. For opencode,
   * `baseModelId` is the `<provider>/<model>` form (no effort suffix).
   */
  defaultModel?: ModelSelection | null;
  /** Sticky permission-mode preference (default/plan/auto). Unset = the agent's natural starting mode. */
  defaultMode?: CopilotMode | null;
  /**
   * ACP sessionId of the dedicated "probe session" used by AgentModelPreloader
   * to enumerate live models without disturbing user chats. Persisted across
   * plugin reloads so subsequent loads can `session/resume` (or `session/load`)
   * the same record instead of accumulating one new session per startup. Never
   * surfaced in the Copilot tab strip or chat history.
   */
  probeSessionId?: string;
  /** See `ClaudeBackendSettings.envOverrides`. Applied to the spawned `opencode` subprocess. */
  envOverrides?: Record<string, string>;
}

/**
 * The device-specific subset of agent settings, stored per device under
 * `agentMode.deviceProfiles[deviceId]`. Mirrors the flat
 * `agentMode.claudeCli`/`backends.*` fields, but only the fields whose correct
 * value differs per device — binary paths, env overrides, and the opencode
 * probe session id. Synced, non-device fields (e.g. `defaultModel`,
 * `enableThinking`) deliberately stay in the flat `backends.*` slices.
 */
export interface DeviceAgentProfile {
  /** Mirror of `agentMode.claudeCli.path`. */
  claudeCliPath?: string;
  codex?: {
    binaryPath?: string;
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

/**
 * Frozen empty fallbacks for the model-management persisted slices.
 */
const EMPTY_PROVIDERS = Object.freeze({}) as unknown as Record<string, Provider>;
const EMPTY_CONFIGURED_MODELS = Object.freeze([]) as unknown as ConfiguredModel[];
const EMPTY_BACKENDS = Object.freeze({}) as unknown as Partial<Record<BackendType, BackendConfig>>;

/**
 * Resolve a valid embedding model key for the current settings.
 *
 * @param settings - Current Copilot settings.
 * @returns A valid embedding model key.
 */
function resolveEmbeddingModelKey(settings: CopilotSettings): string {
  const activeEmbeddingModelKeys = new Set(
    (settings.activeEmbeddingModels || []).map((model) => getModelKeyFromModel(model))
  );

  if (settings.embeddingModelKey && activeEmbeddingModelKeys.has(settings.embeddingModelKey)) {
    return settings.embeddingModelKey;
  }

  return DEFAULT_SETTINGS.embeddingModelKey;
}

/**
 * Sets the settings in the atom. Accepts either a partial object or an
 * updater function `(prev) => partial`. Prefer the updater form for any
 * read-modify-write — it routes through jotai's atom-setter callback so the
 * read and write are atomic at the store level (no stale-snapshot races
 * between concurrent writers, even across `await` boundaries in the caller).
 */
export function setSettings(
  settings: Partial<CopilotSettings> | ((current: CopilotSettings) => Partial<CopilotSettings>)
) {
  settingsStore.set(settingsAtom, (prev) => {
    const partial = typeof settings === "function" ? settings(prev) : settings;
    const merged = mergeAllActiveModelsWithCoreModels({ ...prev, ...partial });
    merged.embeddingModelKey = resolveEmbeddingModelKey(merged);
    return merged;
  });
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
  setSettings((cur) => ({ ...cur, [key]: value }));
}

/**
 * Patch one slice of `agentMode.backends` without forcing every caller to
 * spread four levels of nested objects.
 */
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

/**
 * Gets the settings from the atom. Use this if you don't need to subscribe to
 * changes.
 */
export function getSettings(): Readonly<CopilotSettings> {
  return settingsStore.get(settingsAtom);
}

/**
 * Resets the settings to the default values.
 *
 * DESIGN NOTE — does NOT clear secrets from the Obsidian Keychain. Reset only
 * rewrites `data.json` to defaults; a keychain-only vault keeps its OS keychain
 * entries. "Delete All Keys" (Advanced Settings → API Key Storage, backed by
 * `KeychainService.forgetAllSecrets`) is the dedicated path for erasing keychain
 * secrets. Wiring that async transaction into this synchronous reset would pull
 * the keychain service and its callbacks through `SettingsMainV2`, and is
 * intentionally left out of the first-stage migration.
 * If a future review flags this again, point them at this note.
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
 * Normalize persisted model provider values so identity keys stay stable across migrations.
 * Reason: Legacy data may store "azure_openai" while runtime uses "azure-openai".
 */
export function normalizeModelProvider(provider: string): string {
  return provider === "azure_openai" ? EmbeddingModelProviders.AZURE_OPENAI : provider;
}

/**
 * Sanitizes the settings to ensure they are valid.
 * Note: This will be better handled by Zod in the future.
 */
export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  // If settings is null/undefined, use DEFAULT_SETTINGS
  const settingsToSanitize = settings || DEFAULT_SETTINGS;
  const rawSettings = settingsToSanitize as unknown as Record<string, unknown>;
  const {
    enableSelfHostedSearch: legacyEnableSelfHostedSearch,
    selfHostedSearchUrl: legacySelfHostedSearchUrl,
    selfHostedSearchApiKey: legacySelfHostedSearchApiKey,
    enableMiyoSearch: legacyEnableMiyoSearch,
  } = rawSettings;

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
        provider: normalizeModelProvider(m.provider),
      };
    });
  }

  const sanitizedSettings: CopilotSettings = { ...settingsToSanitize };
  const sanitizedSettingsRecord = sanitizedSettings as unknown as Record<string, unknown>;
  delete sanitizedSettingsRecord.miyoRemoteVaultPath;
  delete sanitizedSettingsRecord.miyoVaultName;
  delete sanitizedSettingsRecord.enableMiyoSearch;

  // Migration: Rename self-hosted search settings to self-host mode (v3.2.0+)
  if (
    legacyEnableSelfHostedSearch !== undefined &&
    sanitizedSettings.enableSelfHostMode === undefined
  ) {
    sanitizedSettings.enableSelfHostMode = legacyEnableSelfHostedSearch as boolean;
  }
  if (legacySelfHostedSearchUrl !== undefined && !sanitizedSettings.selfHostUrl) {
    sanitizedSettings.selfHostUrl = legacySelfHostedSearchUrl as string;
  }
  if (legacySelfHostedSearchApiKey !== undefined && !sanitizedSettings.selfHostApiKey) {
    sanitizedSettings.selfHostApiKey = legacySelfHostedSearchApiKey as string;
  }

  // Migration: Rename legacy enableMiyoSearch to enableMiyo.
  if (legacyEnableMiyoSearch !== undefined && sanitizedSettings.enableMiyo === undefined) {
    sanitizedSettings.enableMiyo = legacyEnableMiyoSearch as boolean;
  }

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

  // Ensure enableMiyo has a default value
  if (typeof sanitizedSettings.enableMiyo !== "boolean") {
    sanitizedSettings.enableMiyo = DEFAULT_SETTINGS.enableMiyo;
  }

  // Ensure miyoSearchAll has a default value
  if (typeof sanitizedSettings.miyoSearchAll !== "boolean") {
    sanitizedSettings.miyoSearchAll = DEFAULT_SETTINGS.miyoSearchAll;
  }

  // Ensure miyoServerUrl has a default value
  if (typeof sanitizedSettings.miyoServerUrl !== "string") {
    sanitizedSettings.miyoServerUrl = DEFAULT_SETTINGS.miyoServerUrl;
  }

  // Ensure selfHostSearchProvider is a valid value
  const validSearchProviders = ["firecrawl", "perplexity"] as const;
  if (!validSearchProviders.includes(sanitizedSettings.selfHostSearchProvider)) {
    sanitizedSettings.selfHostSearchProvider = DEFAULT_SETTINGS.selfHostSearchProvider;
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
    autonomousAgentMaxIterations > AGENT_MAX_ITERATIONS_LIMIT
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

  // Migration: rename legacy tool IDs to their new names
  const toolIdRenames: Record<string, string> = {
    writeToFile: "writeFile",
    replaceInFile: "editFile",
  };
  sanitizedSettings.autonomousAgentEnabledToolIds =
    sanitizedSettings.autonomousAgentEnabledToolIds.map((id) => toolIdRenames[id] ?? id);

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

  // Ensure projectsFolder falls back to default when empty/whitespace.
  // Reason: reject path traversal segments ("..") and absolute paths to prevent
  // writes outside the vault root.
  const projectsFolder = (settingsToSanitize.projectsFolder || "").trim();
  // Reason: also reject Unix absolute paths (/foo) and UNC paths (\\server\share)
  const hasTraversal =
    /(^|[/\\])\.\.[/\\]?/.test(projectsFolder) ||
    /^[a-zA-Z]:/.test(projectsFolder) ||
    /^[/\\]/.test(projectsFolder);
  sanitizedSettings.projectsFolder =
    projectsFolder.length > 0 && !hasTraversal ? projectsFolder : DEFAULT_SETTINGS.projectsFolder;

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
  if (
    !sanitizedSettings.backends ||
    typeof sanitizedSettings.backends !== "object" ||
    Array.isArray(sanitizedSettings.backends)
  ) {
    sanitizedSettings.backends = EMPTY_BACKENDS;
  }

  return sanitizedSettings;
}

/** Validate the agentMode slice. */
function sanitizeAgentMode(raw: unknown): CopilotSettings["agentMode"] {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS.agentMode };
  }
  const r = raw as Record<string, unknown>;
  const byok =
    r.byok && typeof r.byok === "object"
      ? (r.byok as { anthropic?: string; openai?: string; google?: string })
      : {};
  const mcpServers = Array.isArray(r.mcpServers) ? r.mcpServers : [];
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
  // `importSkipList` is not part of the skills settings shape, so sanitize
  // doesn't carry it forward. Any value left in an older data.json is read
  // but never written back — it falls off on the next save.
  const suppressMigrationConfirm =
    skillsRaw && typeof skillsRaw.suppressMigrationConfirm === "boolean"
      ? skillsRaw.suppressMigrationConfirm
      : undefined;
  const skills: CopilotSettings["agentMode"]["skills"] = {
    folder: skillsValidation.ok
      ? skillsValidation.folder
      : DEFAULT_SETTINGS.agentMode.skills.folder,
    ...(suppressMigrationConfirm !== undefined ? { suppressMigrationConfirm } : {}),
  };

  return {
    byok,
    mcpServers,
    activeBackend,
    backends,
    debugFullFrames,
    skills,
    ...(claudeCli ? { claudeCli } : {}),
    ...(deviceProfiles ? { deviceProfiles } : {}),
  };
}

/**
 * Match NUL, the C0 control range (0x01–0x1F), and DEL (0x7F). Uses explicit
 * `\uXXXX` escapes so the source stays plain ASCII — an earlier form
 * embedded literal control bytes, which made the source file binary and
 * missed DEL.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * Validate a user-entered "Skills folder" value against the rules in
 * `designdocs/SKILLS_MANAGEMENT.md` §Skills folder setting.
 *
 * Rules:
 *   - Empty / whitespace-only → falls back to default `copilot/skills`.
 *   - Leading `/` and `./` are stripped before use (still considered ok).
 *   - `..` segments are rejected.
 *   - OS-illegal characters (NUL, C0 controls, DEL, `<>:"|?*` on Windows)
 *     rejected.
 *   - Stored as a vault-root-relative POSIX path with forward slashes only.
 *
 * @param value Raw user input.
 * @returns Discriminated union: `{ ok: true, folder }` with the cleaned
 *   value, or `{ ok: false, reason }` for inline UI validation errors.
 */
export function validateSkillsFolder(
  value: string
): { ok: true; folder: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: true, folder: DEFAULT_SKILLS_FOLDER };
  }

  // Normalize path separators to POSIX so backslash-only inputs are caught
  // as illegal on non-Windows and stay validated uniformly elsewhere.
  let cleaned = value.trim().replace(/\\/g, "/");

  // Strip leading `./`
  while (cleaned.startsWith("./")) {
    cleaned = cleaned.slice(2);
  }
  // Strip a single leading `/` — vault-root-relative interpretation.
  if (cleaned.startsWith("/")) {
    cleaned = cleaned.replace(/^\/+/, "");
  }
  // Strip trailing slashes.
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
    // Windows-illegal characters (rejected everywhere for portability).
    if (/[<>:"|?*]/.test(segment)) {
      return {
        ok: false,
        reason: 'Folder path contains characters not allowed in folder names (< > : " | ? *).',
      };
    }
  }

  return { ok: true, folder: cleaned };
}

/** Truthy-string coerce: keep only non-empty string values. */
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

// Closed set mirroring the `CopilotMode` union; an unknown/legacy value is
// dropped so a corrupt data.json can't seed a mode the picker can't render.
const COPILOT_MODES: readonly CopilotMode[] = ["default", "plan", "auto"];
function sanitizeDefaultMode(raw: unknown): CopilotMode | undefined {
  return typeof raw === "string" && (COPILOT_MODES as readonly string[]).includes(raw)
    ? (raw as CopilotMode)
    : undefined;
}

/**
 * Strict env-var key check: POSIX-style identifier. Rejects empty strings,
 * leading digits, `=`, whitespace, dots, hyphens, and control chars. Shared
 * with the UI editor (`EnvOverridesSetting`) so live validation matches what
 * the sanitizer accepts.
 */
export const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Sanitize a user-supplied env-var override record. Drops entries whose key
 * fails POSIX-identifier validation or whose value isn't a string. Caps the
 * record at 64 entries to bound the persisted size. Returns `undefined`
 * when the record is empty so the persisted settings shape stays clean.
 */
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

function sanitizeClaudeBackendSettings(raw: unknown): ClaudeBackendSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    defaultModel: sanitizeDefaultModel(r.defaultModel),
    defaultMode: sanitizeDefaultMode(r.defaultMode),
    enableThinking: typeof r.enableThinking === "boolean" ? r.enableThinking : undefined,
    envOverrides: sanitizeEnvOverrides(r.envOverrides),
  };
}

function sanitizeCodexBackendSettings(raw: unknown): CodexBackendSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    binaryPath: nonEmptyString(r.binaryPath),
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

/** Sanitize one device's agent profile; returns undefined when nothing valid remains. */
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

/** Sanitize the per-device profile map; returns undefined when empty. */
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

function mergeAllActiveModelsWithCoreModels(settings: CopilotSettings): CopilotSettings {
  settings.activeModels = mergeActiveModels(settings.activeModels, BUILTIN_CHAT_MODELS);
  settings.activeEmbeddingModels = filterUnsupportedEmbeddingModels(
    mergeActiveModels(settings.activeEmbeddingModels, BUILTIN_EMBEDDING_MODELS)
  );
  return settings;
}

/**
 * Get a unique model key from a CustomModel instance.
 * Format: modelName|provider
 *
 * Agent Mode picker entries optionally carry `_backendId` (set by the picker
 * for synthesized agent models). When present, the key is prefixed with
 * the backend id so two backends reporting the same agent-native model id
 * (e.g. both surfacing a `sonnet` alias) get distinct keys / React ids.
 */
export function getModelKeyFromModel(model: CustomModel & { _backendId?: string }): string {
  const base = `${model.name}|${model.provider}`;
  return model._backendId ? `${model._backendId}:${base}` : base;
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

/**
 * Remove embedding models that use unsupported providers.
 *
 * @param models - Embedding models to validate.
 * @returns Filtered list containing only supported providers.
 */
function filterUnsupportedEmbeddingModels(models: CustomModel[]): CustomModel[] {
  const supportedProviders = new Set(Object.values(EmbeddingModelProviders));
  return models.filter((model) =>
    supportedProviders.has(model.provider as EmbeddingModelProviders)
  );
}
