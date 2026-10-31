import { ChainType } from "@/chainType";

import { ModelCapability, ReasoningEffort } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { atom, useAtom } from "jotai";

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

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
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
  enableCors?: boolean;
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
