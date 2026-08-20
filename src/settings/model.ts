import { CustomModel, ProjectConfig } from "@/aiParams";
import { getModelKeyFromModel } from "@/lib/model-key";
import { atom, createStore, useAtomValue } from "jotai";
import { v4 as uuidv4 } from "uuid";

import type { CopilotMode, ModelSelection } from "@/agentMode";
import { ChainType } from "@/chainType";
import type { BackendConfig, BackendType, ConfiguredModel, Provider } from "@/modelManagement";
import { MODEL_SECRET_FIELDS, TOP_LEVEL_SECRET_FIELDS } from "@/services/settingsSecretTransforms";
import { type SortStrategy, isSortStrategy } from "@/utils/recentUsageManager";
import {
  AGENT_MAX_ITERATIONS_LIMIT,
  BUILTIN_CHAT_MODELS,
  BUILTIN_EMBEDDING_MODELS,
  DEFAULT_OPEN_AREA,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  DEFAULT_SKILLS_FOLDER,
  EmbeddingModelProviders,
  SEND_SHORTCUT,
} from "@/constants";

export { getModelKeyFromModel } from "@/lib/model-key";

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
  googleApiKey: string;
  openRouterAiApiKey: string;
  xaiApiKey: string;
  mistralApiKey: string;
  deepseekApiKey: string;
  siliconflowApiKey: string;
  defaultChainType: ChainType;
  defaultModelKey: string;
  embeddingModelKey: string;
  contextTurns: number;
  lastDismissedVersion: string | null;
  // DEPRECATED: Do not use this directly, migrated to file-based system prompts
  userSystemPrompt: string;
  openAIProxyBaseUrl: string;
  openAIEmbeddingProxyBaseUrl: string;
  stream: boolean;
  /** Configurable root folder all Copilot sub-folders derive from (default: "copilot"). */
  copilotFolder: string;
  /**
   * Every folder that has ever been the Copilot root (seeded with the legacy
   * `copilot` root in the v8 migration). Append-only: once a folder has held
   * Copilot data it stays here so it remains permanently excluded from QA
   * indexing, even after the root is changed away from it.
   *
   * DESIGN NOTE — this list is best-effort under multi-device Sync. Two offline
   * devices that each change to a different root can have one branch's history
   * overwritten by a covering Sync merge; the startup union in
   * {@link sanitizeSettings} only re-adds THIS device's current root, so a root
   * that only ever existed on the overwritten device can't be recovered.
   * Accepted as a residual because changing the root at all is rare, and two
   * devices concurrently changing to different roots rarer still.
   *
   * A second residual — a local persist failure activating a new root in memory
   * before its history lands on disk — is documented at the activation site in
   * {@link applyCopilotRootChange}; see that note before re-litigating whether
   * the switch should persist before activating.
   */
  copilotRootHistory: string[];
  /**
   * True only when a legacy (v1-v7) vault was migrated to v8. Consumed once by
   * the v3->v4 upgrade prompt (WS-D), which clears it back to false.
   */
  upgradedToV8FromLegacy: boolean;
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
  /** Projects config root folder in vault (default: "copilot/projects"). */
  projectsFolder: string;
  embeddingRequestsPerMin: number;
  embeddingBatchSize: number;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  defaultSendShortcut: SEND_SHORTCUT;
  disableIndexOnMobile: boolean;
  numPartitions: number;
  defaultConversationNoteName: string;
  // Any valid paid license (Lite and above). undefined means never checked.
  isPaidUser: boolean | undefined;
  // Tier >= Plus (Plus, Pro, Believer, Supporter; excludes Lite). Current
  // validations derive it from a verified signed entitlement; undefined means
  // never checked. See plusUtils + entitlement/.
  isPlusUser: boolean | undefined;
  // Raw server-signed entitlement token (JWS). Tamper-evident, so safe to persist
  // and trust offline until its `exp`. Empty when no verified token is stored.
  entitlementToken: string;
  // Epoch ms when the entitlement token expires (0 = no verified entitlement).
  // The reactive tier UI reads this; strict gates use the in-memory verified
  // claims. Derived from the token's `exp`.
  entitlementExpiresAt: number;
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
  /**
   * User-controlled install of the `miyo-search` agent skill (path B: agent tool +
   * system-prompt steering). Independent of `enableSemanticSearchV3` (path A: the
   * Copilot chat/QA vector retrieval), which stays owned by Miyo Connect/Disconnect.
   */
  enableMiyoSearchSkill: boolean;
  /** When true, omit folder_name from Miyo search requests so all indexed content is searched */
  miyoSearchAll: boolean;
  /** URL endpoint for the self-host mode backend */
  /** API key for the self-host mode backend (if required) */
  /** Custom Miyo server URL, e.g. "http://192.168.1.10:8742" (empty = use local service discovery) */
  miyoServerUrl: string;
  /**
   * Fingerprint of the system root exclusions last successfully synced to the
   * registered Miyo folder (empty = never synced). Compared against the current
   * fingerprint to detect that Miyo's server-side exclusions went stale after a
   * Copilot root change; see `getMiyoExclusionsFingerprint` in miyoUtils.
   */
  miyoSyncedExclusions: string;
  /** Which provider to use for self-host web search */
  selfHostSearchProvider: SelfHostSearchProvider;
  /** Firecrawl API key for self-host web search */
  firecrawlApiKey: string;
  /** Perplexity API key for self-host web search via Sonar */
  perplexityApiKey: string;
  /** Parallel API key for self-host web search */
  parallelApiKey: string;
  /** Exa API key for self-host web search */
  exaApiKey: string;
  /** Supadata API key for self-host YouTube transcripts */
  supadataApiKey: string;
  /**
   * Document-processor backend (settings v6). Seeded from `enableSelfHostMode &&
   * enableMiyo`; read at the parse boundary via `resolveDocProcessorBackend()`.
   */
  docProcessorBackend: "plus" | "miyo";
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
   * Stable namespace ID for keychain entries, persisted once on first use.
   * Reason: using a persisted ID (instead of deriving from vault path) means
   * renaming or moving the vault folder does not orphan keychain entries.
   */
  _keychainVaultId?: string;
  /** Device-owned backup receipt retained until its recovery instructions are shown. */
  _pendingCredentialRecovery?: { deviceId: string; path: string; encrypted: boolean };
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
     * Write the full untruncated ACP JSON-RPC frames as NDJSON to a per-vault
     * owner-only directory under the OS temp folder (see
     * `getFrameLogPaths()` in `src/agentMode/session/debugSink.ts`). On by
     * default; leaves the existing 400-char summary log unchanged.
     */
    debugFullFrames: boolean;
    /**
     * One-shot dismissal of the Agent Home "Try a project" welcome card. The card
     * only shows on the global landing while no projects exist; once dismissed it
     * stays hidden regardless of project count. Persisted so the nudge doesn't
     * reappear across reloads. Defaults to `false`.
     */
    welcomeDismissed: boolean;
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

export type SelfHostSearchProvider = "firecrawl" | "perplexity" | "parallel" | "exa";

/**
 * Native Claude permission mode that Copilot's canonical `auto` pill drives.
 * `auto` lets Claude's classifier approve or deny each request, `acceptEdits`
 * auto-approves file edits only, and `bypassPermissions` skips every check.
 */
export type ClaudeAutoModePermission = "acceptEdits" | "auto" | "bypassPermissions";

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
   * Which native permission mode the `auto` pill switches Claude into. Unset =
   * Claude's classifier-driven `auto`.
   */
  autoModePermission?: ClaudeAutoModePermission;
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

/** Frozen fallback for an empty {@link CopilotSettings.copilotRootHistory}. */
const EMPTY_COPILOT_ROOT_HISTORY = Object.freeze([]) as unknown as string[];

/**
 * Canonicalize Copilot root-folder paths into the form the QA folder matcher
 * (`matchFilePathWithFolders`) compares against: forward slashes, collapsed
 * duplicate separators, no `.` segments, no trailing slash, and case preserved
 * (the matcher is case-sensitive, so lowercasing here would break exact-root
 * matching). Collapsing `//` and dropping `.` segments matters because history
 * entries can arrive from Obsidian Sync merges or hand-edited `data.json` in a
 * non-`normalizePath` form (e.g. `a//b`, `a/./b`); real file paths are compared
 * post-`normalizePath`, so an un-collapsed root would fail the prefix match and
 * silently leak that root's notes into QA. Legitimate roots already pass through
 * `validateCopilotFolder` free of `//`/`.` segments, so this is a no-op for them
 * and only repairs anomalous entries. Entries that are empty or escape the vault
 * root (parent traversal, drive-absolute, or root-absolute paths) are dropped
 * rather than coerced to a default, and duplicates are removed preserving
 * first-seen order.
 *
 * @param input - Raw root paths; non-string, empty, and unsafe entries are skipped.
 * @returns A deduped, normalized list, or a frozen empty constant when none survive.
 */
export function normalizeRootFolders(input: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    // Reason: collapse `//` and strip `.` segments so anomalous history entries
    // land in the same canonical form the QA matcher compares real paths against.
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
 * Normalize the user's QA exclusion patterns (dedupe by canonical path key,
 * preserving a single trailing slash when the user wrote one).
 *
 * The Copilot root itself is NOT forced in here anymore: the always-on system
 * exclusion ({@link getSystemExcludedFolders} in `searchUtils`) permanently
 * excludes the `copilot` root plus the active and historical roots, so this
 * function only has to canonicalize what the user typed. A user-supplied
 * `copilot` entry is kept as-is and simply overlaps the system exclusion.
 *
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
 * A builtin model row's credential bundle: the key, plus the non-secret fields
 * without which that key cannot reach its service.
 *
 * Reason: none of the added fields is a secret, so they are deliberately kept
 * out of `MODEL_SECRET_FIELDS`, which also drives persist-time secret
 * stripping — listing them there would blank routing config on every save.
 * They belong here because a key without its routing is worse than no key at
 * all: `baseUrl` decides which host receives it, so a reset endpoint would send
 * a proxy key to the provider's default host. Custom rows survive whole and
 * never consult this list.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/259
 */
const MODEL_CREDENTIAL_BUNDLE_FIELDS = [
  ...MODEL_SECRET_FIELDS,
  "baseUrl",
  "enableCors",
  "openAIOrgId",
] as const satisfies readonly (keyof CustomModel)[];

/**
 * A session proof rather than a credential, despite matching the secret-key
 * heuristic. `verifyEntitlement` checks it against `settings.userId`, which
 * reset replaces with a fresh `uuidv4()`, so a carried-over token could never
 * verify again — it would only survive as dead state that keeps the
 * in-process entitlement looking live while the Plus provider is unregistered.
 * `plusLicenseKey` is the real credential and is preserved; the next license
 * check re-issues this token.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/259
 */
const SESSION_PROOF_FIELD = "entitlementToken";

/**
 * Non-secret top-level fields a preserved credential needs in order to reach
 * its service: the vendor config a model row falls back to when it does not
 * carry its own.
 *
 * Typed against `CopilotSettings` so a mistyped name fails the build. The
 * secret half cannot be typed this way because it is derived at runtime from
 * `DEFAULT_SETTINGS`, which is exactly why the hand-written half is.
 */
const TOP_LEVEL_CREDENTIAL_COMPANION_FIELDS = [
  "openAIOrgId",
] as const satisfies readonly (keyof CopilotSettings)[];

/**
 * The top-level counterpart of {@link MODEL_CREDENTIAL_BUNDLE_FIELDS}.
 *
 * Kept separate from the model list rather than merged into one array because
 * the two address different objects with different field names: `enableCors`
 * exists only per row, and the secret half is derived from a different source.
 */
const TOP_LEVEL_CREDENTIAL_BUNDLE_FIELDS: readonly string[] = [
  ...TOP_LEVEL_SECRET_FIELDS.filter((field) => field !== SESSION_PROOF_FIELD),
  ...TOP_LEVEL_CREDENTIAL_COMPANION_FIELDS,
];

/**
 * Whether a pre-reset value is usable configuration worth carrying over.
 *
 * Reason: the bundles are almost entirely strings, and the string check is what
 * stops a corrupted or cross-version value (say `openAIOrgId: {}` from
 * a hand-edited `data.json`) from surviving reset and then throwing at its
 * consumer. Only `enableCors` is legitimately non-string, so it is named here
 * rather than widening the check for everything.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/259
 *
 * @param field - Bundle field being considered, which decides the expected type.
 * @param value - The pre-reset value.
 */
function carriesConfiguration(field: string, value: unknown): boolean {
  if (field === "enableCors") return typeof value === "boolean";
  return typeof value === "string" && value.length > 0;
}

/**
 * Overlay a preserved credential bundle onto a default model row.
 *
 * Reason: a builtin model's identity and parameters belong to the shipped
 * default, but its credential belongs to the user — and a credential is only
 * usable against the service it was issued for. This narrow allowlist resets
 * preferences such as enabled state while keeping the retained key pointed
 * where the user aimed it.
 *
 * @param defaultModel - The freshly built default row that owns the identity.
 * @param source - The pre-reset row supplying the credential bundle.
 */
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

/**
 * Rebuild one model list for reset: builtin rows return to their defaults but
 * keep their credential and its endpoint, and every custom row survives intact.
 *
 * @param defaultModels - Builtin rows as a fresh install would have them.
 * @param currentModels - The pre-reset rows to harvest credentials from.
 */
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

/**
 * Keep only the provider rows that own a credential, so reset does not orphan
 * the keychain entries those rows point at.
 *
 * Selection is by pointer truthiness rather than `requiresApiKey`: Plus sign-in
 * creates its provider with `requiresApiKey: false` and then stores the license
 * key via `setApiKey`, so filtering on that flag would silently drop a real
 * credential. Whole rows survive because `baseUrl` / `extras` / `providerType`
 * are what make the key usable; keyless rows (Ollama, LMStudio) carry nothing
 * and are reset away.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/259
 *
 * @param providers - The pre-reset provider rows.
 */
function preserveProvidersWithCredentials(
  providers: Record<string, Provider> | undefined
): Record<string, Provider> {
  const preserved = Object.entries(providers ?? {}).filter(
    ([, provider]) => !!provider?.apiKeyKeychainId
  );
  return preserved.length > 0 ? Object.fromEntries(preserved) : EMPTY_PROVIDERS;
}

/**
 * Keep only the configured models belonging to providers that were preserved.
 *
 * Reason: a `ConfiguredModel` doesn't directly carry a credential, but its
 * existence depends on the parent provider's credential. When a provider is
 * preserved, its models must be too — otherwise the user sees "API key set"
 * but "No models added", and their model configuration is lost. When a provider
 * is dropped (e.g. Ollama with no key), its models go with it.
 *
 * @param configuredModels - The pre-reset configured model rows.
 * @param preservedProviderIds - Set of provider IDs that survived the reset.
 */
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

/**
 * Resets the settings to the default values while preserving credentials.
 *
 * Reset restores every non-credential setting to its default, but deliberately
 * carries forward the user's API keys: the top-level secret fields, the
 * credential and endpoint on builtin model rows, custom model rows that carry a
 * credential, and the provider rows that own a keychain pointer. Configured
 * models belonging to preserved providers are also kept — dropping them would
 * orphan the user's model configuration while the provider's credential
 * survives.
 *
 * Reset is not a way to erase secrets — "Delete All Keys" (Advanced Settings →
 * API Key Storage, backed by `KeychainService.forgetAllSecrets`) is the
 * dedicated path for that, and it also clears the OS keychain, which reset
 * never touches.
 *
 * `backends` is cleared: it holds per-backend model enrollment (references to
 * `configuredModelId`), which is a user preference rather than structure needed
 * to address a keychain entry. Preserved models stay visible in settings, but
 * each backend's picker reads `enabledModels` as authoritative and shows
 * nothing until the user re-enables them there.
 *
 * DESIGN NOTE — does NOT clear secrets from the Obsidian Keychain. Reset only
 * rewrites `data.json` to defaults while leaving its Obsidian Keychain
 * entries. "Delete All Keys" (Advanced Settings → API Key Storage, backed by
 * `KeychainService.forgetAllSecrets`) is the dedicated path for erasing keychain
 * secrets. Wiring that async transaction into this synchronous reset would pull
 * the keychain service and its callbacks through `SettingsMainV2`, and is
 * intentionally left out of the synchronous reset path.
 * If a future review flags this again, point them at this note.
 *
 * Preserving the rows above is what makes that note safe: the keychain entries
 * this function deliberately leaves behind stay reachable, instead of becoming
 * orphans no surviving pointer names.
 *
 * DESIGN NOTE — `_keychainVaultId` needs no entry in the preserved lists.
 * `setSettings` merges (`{ ...prev, ...partial }`), and neither
 * `DEFAULT_SETTINGS` nor the preserved slices carry that key, so the
 * pre-reset keychain namespace flows through reset untouched; the
 * reset → persist → reload integration test asserts it survives to disk.
 * If a future review flags this again, point them at this note.
 */
export function resetSettings(): void {
  const current = getSettings();
  const currentRecord = current as unknown as Record<string, unknown>;
  // Reset is a deterministic path, not best-effort: preserve the root-exclusion
  // history and fold in the pre-reset active root before it is replaced by the
  // default. Otherwise a reset would drop every historical root and leave that
  // still-on-disk content exposed to QA indexing.
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
    activeEmbeddingModels: preserveModelCredentials(
      BUILTIN_EMBEDDING_MODELS.map((model) => ({ ...model, enabled: true })),
      current.activeEmbeddingModels ?? []
    ),
    providers: preservedProviders,
    configuredModels: preserveConfiguredModelsForProviders(
      current.configuredModels,
      preservedProviderIds
    ),
    copilotRootHistory: preservedRootHistory,
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
  const rawSettings = settingsToSanitize as unknown as Record<string, unknown>;
  const {
    enableSelfHostedSearch: legacyEnableSelfHostedSearch,
    enableMiyoSearch: legacyEnableMiyoSearch,
  } = rawSettings;

  if (!settingsToSanitize.userId) {
    settingsToSanitize.userId = uuidv4();
  }

  if (!settingsToSanitize.activeEmbeddingModels) {
    settingsToSanitize.activeEmbeddingModels = BUILTIN_EMBEDDING_MODELS.map((model) => ({
      ...model,
      enabled: true,
    }));
  }

  const sanitizedSettings: CopilotSettings = { ...settingsToSanitize };
  const sanitizedSettingsRecord = sanitizedSettings as unknown as Record<string, unknown>;
  delete sanitizedSettingsRecord.miyoRemoteVaultPath;
  delete sanitizedSettingsRecord.miyoVaultName;
  delete sanitizedSettingsRecord.enableMiyoSearch;
  // Amazon Bedrock is no longer a chat provider, so a stored key and region
  // would only be credentials for a service Copilot can no longer reach.
  // https://github.com/logancyang/obsidian-copilot/issues/2928
  delete sanitizedSettingsRecord.amazonBedrockApiKey;
  delete sanitizedSettingsRecord.amazonBedrockRegion;
  // Azure OpenAI is no longer a chat or embedding provider, so a stored key and
  // its routing fields would only address a service Copilot cannot reach.
  // https://github.com/logancyang/obsidian-copilot/issues/2932
  delete sanitizedSettingsRecord.azureOpenAIApiKey;
  delete sanitizedSettingsRecord.azureOpenAIApiInstanceName;
  delete sanitizedSettingsRecord.azureOpenAIApiDeploymentName;
  delete sanitizedSettingsRecord.azureOpenAIApiVersion;
  delete sanitizedSettingsRecord.azureOpenAIApiEmbeddingDeploymentName;
  // Copilot no longer limits how long an answer may be, so a stored limit
  // would only cut off answers the model was willing to finish.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/312
  delete sanitizedSettingsRecord.maxTokens;

  // Migration: Rename self-hosted search settings to self-host mode (v3.2.0+)
  if (
    legacyEnableSelfHostedSearch !== undefined &&
    sanitizedSettings.enableSelfHostMode === undefined
  ) {
    sanitizedSettings.enableSelfHostMode = legacyEnableSelfHostedSearch as boolean;
  }

  // Migration: Rename legacy enableMiyoSearch to enableMiyo.
  if (legacyEnableMiyoSearch !== undefined && sanitizedSettings.enableMiyo === undefined) {
    sanitizedSettings.enableMiyo = legacyEnableMiyoSearch as boolean;
  }

  // Migration: the old `isPlusUser` ("any valid license") was split into
  // `isPaidUser` (any paid, incl. Lite) + a new `isPlusUser` (tier >= Plus, used
  // by the multi-agent gate). Backfill `isPaidUser` from the legacy value. The
  // legacy value is also a correct seed for the new strict `isPlusUser` because
  // no sub-Plus paid tier existed before this split, so the carried-over
  // `isPlusUser` stays correct until the next license validation.
  if (
    typeof sanitizedSettings.isPaidUser !== "boolean" &&
    typeof rawSettings.isPlusUser === "boolean"
  ) {
    sanitizedSettings.isPaidUser = rawSettings.isPlusUser;
  }

  // Stuff in settings are string even when the interface has number type!
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

  // Ensure enableMiyoSearchSkill has a default value
  if (typeof sanitizedSettings.enableMiyoSearchSkill !== "boolean") {
    sanitizedSettings.enableMiyoSearchSkill = DEFAULT_SETTINGS.enableMiyoSearchSkill;
  }

  // Ensure miyoSearchAll has a default value
  if (typeof sanitizedSettings.miyoSearchAll !== "boolean") {
    sanitizedSettings.miyoSearchAll = DEFAULT_SETTINGS.miyoSearchAll;
  }

  // Ensure miyoServerUrl has a default value
  if (typeof sanitizedSettings.miyoServerUrl !== "string") {
    sanitizedSettings.miyoServerUrl = DEFAULT_SETTINGS.miyoServerUrl;
  }

  // Ensure miyoSyncedExclusions has a default value
  if (typeof sanitizedSettings.miyoSyncedExclusions !== "string") {
    sanitizedSettings.miyoSyncedExclusions = DEFAULT_SETTINGS.miyoSyncedExclusions;
  }

  // Ensure selfHostSearchProvider is a valid value
  // Persisted Parallel and Exa choices must survive reload instead of silently
  // reverting to Firecrawl. https://github.com/Brevilabs/obsidian-copilot-private/issues/285
  const validSearchProviders = ["firecrawl", "perplexity", "parallel", "exa"] as const;
  if (!validSearchProviders.includes(sanitizedSettings.selfHostSearchProvider)) {
    sanitizedSettings.selfHostSearchProvider = DEFAULT_SETTINGS.selfHostSearchProvider;
  }

  // Ensure docProcessorBackend is a valid value (settings v6)
  const validDocProcessorBackends = ["plus", "miyo"] as const;
  if (!validDocProcessorBackends.includes(sanitizedSettings.docProcessorBackend)) {
    sanitizedSettings.docProcessorBackend = DEFAULT_SETTINGS.docProcessorBackend;
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

  // Coerce copilotFolder to a valid vault-relative path. validateCopilotFolder
  // is the single source of truth for root syntax (empty, traversal, absolute,
  // control/Windows-illegal chars) shared with the settings UI; an
  // invalid persisted value falls back to the default rather than being trusted.
  const copilotFolderValidation = validateCopilotFolder(
    typeof settingsToSanitize.copilotFolder === "string" ? settingsToSanitize.copilotFolder : ""
  );
  sanitizedSettings.copilotFolder = copilotFolderValidation.ok
    ? copilotFolderValidation.folder
    : DEFAULT_SETTINGS.copilotFolder;

  // Normalize the append-only root history and idempotently union in the
  // active root, so this device's current root is always present in its own
  // history (the load-time self-heal referenced in the field's DESIGN NOTE).
  // These roots are excluded from QA indexing permanently — see
  // getSystemExcludedFolders in searchUtils.
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

  // Fall back when the persisted chain type isn't one this build offers. A vault
  // last used with Quick Chat's Projects mode still holds "project" here, and
  // chain construction would throw "Unsupported chain type" on it before the
  // user could pick anything else.
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
    activeBackend,
    backends,
    debugFullFrames,
    welcomeDismissed,
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
// Names Windows reserves at any path depth, with or without an extension —
// creating `NUL` or `con.md` fails or misbehaves at the filesystem layer.
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// eslint-disable-next-line no-control-regex -- settings paths must reject embedded control bytes
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

/**
 * Validate a Copilot root folder (`copilotFolder`) for portable path syntax and,
 * when supplied, overlap with the active Obsidian configuration directory.
 * Persisted settings intentionally omit `configDir` so changing a vault's
 * configuration directory cannot silently relocate existing Copilot data.
 * New settings values pass `configDir` before Apply. Vault-content scans that
 * need App/Vault access live in `copilotRootChange`, not here.
 *
 * Unlike {@link validateSkillsFolder}, absolute and drive-letter paths are
 * rejected rather than stripped: the root is the trust boundary every derived
 * sub-folder inherits, so a leading-slash value is treated as a mistake to
 * surface, not silently rewritten. The active config folder is rejected to
 * keep Copilot data from colliding with Obsidian's own configuration.
 *
 * @param value Raw user input.
 * @param configDir Active vault configuration directory when validating a new value.
 * @returns `{ ok: true, folder }` with the trimmed, trailing-slash-stripped
 *   value, or `{ ok: false, reason }` carrying a UI-ready message.
 */
export function validateCopilotFolder(
  value: string,
  configDir?: string
): { ok: true; folder: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: "Folder name cannot be empty." };
  }
  const trimmed = value.trim();
  // Reject (do not strip) absolute and drive-letter paths so a root can never
  // escape the vault; a stray leading slash is surfaced as an error instead.
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
    // DESIGN NOTE — leading-dot (hidden) folder names are deliberately
    // ACCEPTED.
    // Trigger: a root such as `.copilot` places every derived store under a
    // path Obsidian omits from the Vault cache.
    // Assessment: chat, projects, and skills carry adapter-backed hidden-path
    // support. Custom commands and system prompts do not — and the gap is wider
    // than discovery: `loadAllCustomCommands` / `loadAllSystemPrompts` enumerate
    // `vault.getFiles()`, while their create/update/delete paths also rely on
    // cached `TFile`s, metadataCache, and `processFrontMatter`. Under a hidden
    // root both can therefore read as empty AND fail to edit reliably.
    // Scope: the Vault-cache limitation predates this PR — the old
    // `customPromptsFolder` / `userSystemPromptsFolder` settings accepted hidden
    // paths too. What the single-root design adds is the coupling: a root chosen
    // for the supported hidden-chat capability now drags these two along.
    // Why not fixed here: rejecting dot segments would regress supported hidden
    // chats, and a scanner-only patch would leave them listable but not
    // editable — real support needs adapter-backed CRUD plus frontmatter
    // handling. Deferred as a follow-up.
    // If a future review flags this again, point them at this note.
    if (CONTROL_CHAR_RE.test(segment)) {
      return { ok: false, reason: "Folder path contains illegal control characters." };
    }
    if (/[<>:"|?*]/.test(segment)) {
      return {
        ok: false,
        reason: 'Folder path contains characters not allowed in folder names (< > : " | ? *).',
      };
    }
    // Rejected on every platform, not just Windows: vaults sync across
    // machines, so a root that persists fine on macOS would then fail every
    // folder creation on a Windows device — the same silent, persistent
    // write-failure mode as pointing the root at an existing file.
    if (/[. ]$/.test(segment)) {
      return { ok: false, reason: "Folder names cannot end with a dot or space." };
    }
    if (WINDOWS_RESERVED_NAME_RE.test(segment)) {
      return { ok: false, reason: `"${segment}" is a name reserved by Windows.` };
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

// Closed set mirroring the `ClaudeAutoModePermission` union; an unknown value
// falls back to the descriptor's default rather than reaching the SDK, which
// rejects permission modes it doesn't know.
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
