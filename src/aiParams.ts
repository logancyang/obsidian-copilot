import { ChainType } from "@/chainType";

import { ModelCapability, ReasoningEffort, Verbosity } from "@/constants";
import type { MaterializedSourceType } from "@/context/contextCacheStore";
import { settingsAtom, settingsStore } from "@/settings/model";
import { SelectedTextContext } from "@/types/message";
import { atom, useAtom } from "jotai";

const userModelKeyAtom = atom<string | null>(null);
const modelKeyAtom = atom(
  (get) => {
    const userValue = get(userModelKeyAtom);
    if (userValue !== null) {
      return userValue;
    }
    // `""` resolves to the first enabled model through `findChatBackendEntry`: https://github.com/Brevilabs/obsidian-copilot-private/issues/540
    return get(settingsAtom).backends?.chat?.default?.configuredModelId ?? "";
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
  usedStaleSnapshot?: boolean;
}

export interface ContextLoadStepCount {
  done: number;
  total: number;
}

export interface AgentProjectContextLoadState {
  phase: "idle" | "resolve" | "prefetch" | "parse" | "done";
  blocking: boolean;
  resolved?: number;
  prefetch?: ContextLoadStepCount;
  parsed?: ContextLoadStepCount;
  failedSources?: FailedItem[];
  processingSources?: AgentInFlightSource[];
  retryingSources?: AgentRetryingSource[];
}

export interface AgentRetryingSource {
  kind: MaterializedSourceType;
  source: string;
}

export interface AgentInFlightSource {
  kind: MaterializedSourceType;
  source: string;
}

export const EMPTY_RETRYING_SOURCES: readonly AgentRetryingSource[] = Object.freeze([]);
export const EMPTY_PROCESSING_SOURCES: readonly AgentInFlightSource[] = Object.freeze([]);
export const agentProjectContextLoadAtom = atom<Record<string, AgentProjectContextLoadState>>({});

const selectedTextContextsAtom = atom<SelectedTextContext[]>([]);

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  projectModelKey: string;
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
  streaming: boolean;
  maxRetries: number;
  maxConcurrency: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  openAIApiKey?: string;
  openAIOrgId?: string;
  anthropicApiKey?: string;
  cohereApiKey?: string;
  apiKey?: string;
  openAIProxyBaseUrl?: string;
  groqApiKey?: string;
  mistralApiKey?: string;
  enableCors?: boolean;
}

export interface CustomModel {
  configuredModelId?: string;
  name: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  requiresApiKey?: boolean;
  enabled: boolean;
  isEmbeddingModel?: boolean;
  isBuiltIn?: boolean;
  enableCors?: boolean;
  core?: boolean;
  stream?: boolean;
  streamUsage?: boolean;
  maxTokens?: number;

  numCtx?: number;

  useResponsesApi?: boolean;

  enablePromptCaching?: boolean;

  plusExclusive?: boolean;
  believerExclusive?: boolean;
  capabilities?: ModelCapability[];
  displayName?: string;

  dimensions?: number;
  openAIOrgId?: string;

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
