import { ChainType } from "./chainFactory";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { atom, getDefaultStore, useAtom } from "jotai";
import { settingsAtom } from "./settings/model";

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
    if (userValue !== null) {
      return userValue;
    }
    return get(settingsAtom).defaultChainType;
  },
  (get, set, newValue) => {
    set(userChainTypeAtom, newValue);
  }
);

export interface ModelConfig {
  modelName: string;
  temperature: number;
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
  enableCors?: boolean;
}

export interface SetChainOptions {
  prompt?: ChatPromptTemplate;
  chatModel?: BaseChatModel;
  noteFile?: any;
  abortController?: AbortController;
  refreshIndex?: boolean;
}

export interface CustomModel {
  name: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
  isEmbeddingModel?: boolean;
  isBuiltIn?: boolean;
  enableCors?: boolean;
  core?: boolean;
  azureOpenAIApiDeploymentName?: string;
  azureOpenAIApiInstanceName?: string; // Added
  azureOpenAIApiVersion?: string; // Added
}

export function setModelKey(modelKey: string) {
  getDefaultStore().set(modelKeyAtom, modelKey);
}

export function getModelKey(): string {
  return getDefaultStore().get(modelKeyAtom);
}

export function subscribeToModelKeyChange(callback: () => void): () => void {
  return getDefaultStore().sub(modelKeyAtom, callback);
}

export function useModelKey() {
  return useAtom(modelKeyAtom);
}

export function getChainType(): ChainType {
  return getDefaultStore().get(chainTypeAtom);
}

export function setChainType(chainType: ChainType) {
  getDefaultStore().set(chainTypeAtom, chainType);
}

export function subscribeToChainTypeChange(callback: () => void): () => void {
  return getDefaultStore().sub(chainTypeAtom, callback);
}

export function useChainType() {
  return useAtom(chainTypeAtom);
}
