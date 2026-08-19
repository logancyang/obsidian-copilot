import { ChainType } from "@/chainType";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { ModelCapability, ReasoningEffort, Verbosity } from "@/constants";
import type { MaterializedSourceType } from "@/context/contextCacheStore";
import { settingsAtom, settingsStore } from "@/settings/model";
import { SelectedTextContext } from "@/types/message";
import { atom, useAtom } from "jotai";
import { TFile } from "obsidian";

const userModelKeyAtom = atom<string | null>(null);
const modelKeyAtom = atom(
  (get) => {
    const userValue = get(userModelKeyAtom);
    if (userValue !== null) {
      return userValue;
    }
    return get(settingsAtom).defaultModelKey;
  },
  (get, set, newValue) => {
    set(userModelKeyAtom, newValue);
  }
);

const userChainTypeAtom = atom<ChainType | null>(null);
const chainTypeAtom = atom(
  (get) => {
    const userValue = get(userChainTypeAtom);
    return userValue !== null ? userValue : get(settingsAtom).defaultChainType;
  },
  (get, set, newValue) => {
    set(userChainTypeAtom, newValue);
  }
);

export interface FailedItem {
  path: string;
  type: "md" | "web" | "youtube" | "nonMd";
  error?: string;
  timestamp?: number;
  /**
   * The source's refresh failed but a previous snapshot is still in use, so
   * it's stale-but-usable rather than missing. Lets the status icon stay
   * "ready" (green) while the popover flags the staleness.
   */
  usedStaleSnapshot?: boolean;
}

/** Done-of-total progress for one materialization step (prefetch / parse). */
export interface ContextLoadStepCount {
  done: number;
  total: number;
}

export interface AgentProjectContextLoadState {
  phase: "idle" | "resolve" | "prefetch" | "parse" | "done";
  blocking: boolean; // true while send should be gated for this project
  /**
   * In-vault binary files queued for text materialization, known once the
   * materializer resolves inclusions. Drives the card's "Resolve files (N)" row.
   * Omitted until resolve completes (and stays omitted for a context with none).
   */
  resolved?: number;
  /** Remote (web/YouTube) prefetch progress; omitted when there are no remotes. */
  prefetch?: ContextLoadStepCount;
  /** Binary-file parse progress; omitted when there are no files to parse. */
  parsed?: ContextLoadStepCount;
  /**
   * Per-source fetch/parse failures from the last run. A run with failures still
   * completes as `phase: "done"` (the session degrades gracefully); these drive
   * the status icon's warning state and the popover's failed-source list. Always
   * republished on `done` (empty array when everything succeeded) so a prior
   * run's failures never linger.
   */
  failedSources?: FailedItem[];
  /**
   * Sources the full materialization run is fetching/parsing RIGHT NOW.
   * Published incrementally as each source
   * starts and settles, so the popover renders a true queue: URLs (fetched in
   * parallel) appear together while files (parsed sequentially) appear one at a
   * time, and each flips to its real outcome the instant it settles — never
   * waiting for the whole run. Only the single-flight owner publishes it; cleared
   * on `done`. `failedSources` is likewise published incrementally during a run.
   */
  processingSources?: AgentInFlightSource[];
  /**
   * Sources whose per-source retry is currently in flight (the popover row
   * "Retry"). Drives an optimistic "processing" state on that row so a click has
   * immediate feedback even when the retry ends up failing again. Never gates
   * send (`blocking` stays false); cleared when each retry settles.
   */
  retryingSources?: AgentRetryingSource[];
}

/** A source whose per-source retry is currently in flight (popover row "Retry"). */
export interface AgentRetryingSource {
  kind: MaterializedSourceType;
  source: string;
}

/** A source the full materialization run is currently fetching/parsing. */
export interface AgentInFlightSource {
  kind: MaterializedSourceType;
  source: string;
}

/** Frozen empty list — referential stability for the "no retries in flight" case. */
export const EMPTY_RETRYING_SOURCES: readonly AgentRetryingSource[] = Object.freeze([]);
/** Frozen empty list — referential stability for the "nothing materializing" case. */
export const EMPTY_PROCESSING_SOURCES: readonly AgentInFlightSource[] = Object.freeze([]);
/** Per-project context-load state, keyed by projectId. Driven by AgentSessionManager's
 *  materialize step; read by AgentContextStatusIcon / AgentChatInput to show progress + gate send. */
export const agentProjectContextLoadAtom = atom<Record<string, AgentProjectContextLoadState>>({});

interface IndexingProgressState {
  isActive: boolean;
  isPaused: boolean;
  isCancelled: boolean;
  indexedCount: number;
  totalFiles: number;
  errors: string[];
  completionStatus: "none" | "success" | "cancelled" | "error";
}

const indexingProgressAtom = atom<IndexingProgressState>({
  isActive: false,
  isPaused: false,
  isCancelled: false,
  indexedCount: 0,
  totalFiles: 0,
  errors: [],
  completionStatus: "none",
});

const selectedTextContextsAtom = atom<SelectedTextContext[]>([]);

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  // Not read at runtime: Agent Mode picks its model from agentMode.activeBackend
  // plus that backend's default. Retained so the `project.md` frontmatter written
  // by earlier versions round-trips instead of being dropped on rewrite.
  projectModelKey: string;
  // Not read at runtime either, for the same reason as `projectModelKey`: the
  // dialog stopped surfacing these and no request consults them. Kept so the
  // frontmatter written by earlier versions round-trips.
  modelConfigs: {
    temperature?: number;
    maxTokens?: number;
  };
  contextSource: {
    inclusions?: string;
    exclusions?: string;
    webUrls?: string;
    youtubeUrls?: string;
  };
  created: number;
  UsageTimestamps: number;
}

export interface ModelConfig {
  modelName: string;
  temperature?: number;
  streaming: boolean;
  maxRetries: number;
  maxConcurrency: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  openAIApiKey?: string;
  openAIOrgId?: string;
  anthropicApiKey?: string;
  cohereApiKey?: string;
  azureOpenAIApiKey?: string;
  azureOpenAIApiInstanceName?: string;
  azureOpenAIApiDeploymentName?: string;
  azureOpenAIApiVersion?: string;
  // Google and TogetherAI API key share this property
  apiKey?: string;
  openAIProxyBaseUrl?: string;
  groqApiKey?: string;
  mistralApiKey?: string;
  enableCors?: boolean;
}

export interface SetChainOptions {
  prompt?: ChatPromptTemplate;
  chatModel?: BaseChatModel;
  noteFile?: TFile;
  abortController?: AbortController;
  refreshIndex?: boolean;
}

export interface CustomModel {
  /** Present for chat-backend bridged models; distinguishes same wire id across providers. */
  configuredModelId?: string;
  name: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  /** Runtime auth contract for bridged models; undefined preserves legacy behavior. */
  requiresApiKey?: boolean;
  enabled: boolean;
  isEmbeddingModel?: boolean;
  isBuiltIn?: boolean;
  enableCors?: boolean;
  core?: boolean;
  stream?: boolean;
  streamUsage?: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;

  // Ollama specific fields
  numCtx?: number;

  // LM Studio specific fields
  useResponsesApi?: boolean;

  // OpenRouter specific fields
  enablePromptCaching?: boolean;

  plusExclusive?: boolean;
  believerExclusive?: boolean;
  capabilities?: ModelCapability[];
  displayName?: string;

  // Embedding models only (Jina at the moment)
  dimensions?: number;
  // OpenAI specific fields
  openAIOrgId?: string;

  // Azure OpenAI specific fields
  azureOpenAIApiInstanceName?: string;
  azureOpenAIApiDeploymentName?: string;
  azureOpenAIApiVersion?: string;
  azureOpenAIApiEmbeddingDeploymentName?: string;

  // OpenAI GPT-5 and O-series specific fields
  reasoningEffort?: ReasoningEffort;
  verbosity?: Verbosity;
}

export function setModelKey(modelKey: string) {
  settingsStore.set(modelKeyAtom, modelKey);
}

export function getModelKey(): string {
  return settingsStore.get(modelKeyAtom);
}

export function subscribeToModelKeyChange(callback: () => void): () => void {
  return settingsStore.sub(modelKeyAtom, callback);
}

export function useModelKey() {
  return useAtom(modelKeyAtom, {
    store: settingsStore,
  });
}

export function getChainType(): ChainType {
  return settingsStore.get(chainTypeAtom);
}

export function setChainType(chainType: ChainType) {
  settingsStore.set(chainTypeAtom, chainType);
}

export function subscribeToChainTypeChange(callback: () => void): () => void {
  return settingsStore.sub(chainTypeAtom, callback);
}

export function useChainType() {
  return useAtom(chainTypeAtom, {
    store: settingsStore,
  });
}

export function setSelectedTextContexts(contexts: SelectedTextContext[]) {
  settingsStore.set(selectedTextContextsAtom, contexts);
}

export function getSelectedTextContexts(): SelectedTextContext[] {
  return settingsStore.get(selectedTextContextsAtom);
}

export function removeSelectedTextContext(id: string) {
  const current = getSelectedTextContexts();
  setSelectedTextContexts(current.filter((context) => context.id !== id));
}

export function clearSelectedTextContexts() {
  if (getSelectedTextContexts().length === 0) return;
  setSelectedTextContexts([]);
}

export function useSelectedTextContexts() {
  return useAtom(selectedTextContextsAtom, {
    store: settingsStore,
  });
}

/**
 * Gets the indexing progress state from the atom.
 */
export function getIndexingProgressState(): Readonly<IndexingProgressState> {
  return settingsStore.get(indexingProgressAtom);
}

/**
 * Sets the indexing progress state in the atom.
 */
export function setIndexingProgressState(state: IndexingProgressState) {
  settingsStore.set(indexingProgressAtom, state);
}

/**
 * Updates specific fields in the indexing progress state.
 */
export function updateIndexingProgressState(partial: Partial<IndexingProgressState>) {
  settingsStore.set(indexingProgressAtom, (prev) => ({
    ...prev,
    ...partial,
  }));
}

// --- Throttled indexing count updater ---
// Limits atom writes to at most once per 500ms during indexing to avoid
// cascading React re-renders from frequent Jotai atom updates.
let _lastUpdateTime = 0;
let _pendingCount = 0;
let _throttleTimer: number | null = null;
const THROTTLE_INTERVAL_MS = 500;

/**
 * Resets the indexing progress state to the default (idle) state.
 * Use when indexing completes with nothing to do (e.g. index already up to date).
 */
export function resetIndexingProgressState() {
  // Cancel any pending throttled indexing count write so a stale timer from a
  // previous run cannot corrupt the freshly-reset state.
  if (_throttleTimer !== null) {
    window.clearTimeout(_throttleTimer);
    _throttleTimer = null;
  }
  _lastUpdateTime = 0;
  _pendingCount = 0;

  settingsStore.set(indexingProgressAtom, {
    isActive: false,
    isPaused: false,
    isCancelled: false,
    indexedCount: 0,
    totalFiles: 0,
    errors: [],
    completionStatus: "none",
  });
}

/**
 * Throttled version of updateIndexingProgressState for indexedCount.
 * Limits atom writes to once per 500ms to reduce React re-renders.
 */
export function throttledUpdateIndexingCount(indexedCount: number): void {
  _pendingCount = indexedCount;
  const now = Date.now();

  if (now - _lastUpdateTime >= THROTTLE_INTERVAL_MS) {
    // Enough time has passed — write immediately
    _lastUpdateTime = now;
    if (_throttleTimer !== null) {
      window.clearTimeout(_throttleTimer);
      _throttleTimer = null;
    }
    updateIndexingProgressState({ indexedCount: _pendingCount });
  } else if (_throttleTimer === null) {
    // Schedule a trailing write
    _throttleTimer = window.setTimeout(
      () => {
        _lastUpdateTime = Date.now();
        _throttleTimer = null;
        updateIndexingProgressState({ indexedCount: _pendingCount });
      },
      THROTTLE_INTERVAL_MS - (now - _lastUpdateTime)
    );
  }
}

/**
 * Forces an immediate write of the pending indexedCount.
 * Call at indexing completion to ensure the final count is displayed.
 */
export function flushIndexingCount(): void {
  if (_throttleTimer !== null) {
    window.clearTimeout(_throttleTimer);
    _throttleTimer = null;
  }
  updateIndexingProgressState({ indexedCount: _pendingCount });
  _lastUpdateTime = 0;
  _pendingCount = 0;
}

/**
 * Hook to get the indexing progress state from the atom.
 */
export function useIndexingProgress() {
  return useAtom(indexingProgressAtom, {
    store: settingsStore,
  });
}
