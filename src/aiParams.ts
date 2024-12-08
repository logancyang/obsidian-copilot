import { ChainType } from "@/chainFactory";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { atom, getDefaultStore, useAtom } from "jotai";
import { settingsAtom } from "@/settings/model";

const userModelKeyAtom = atom<string | null>(null);
const modelKeyAtom = atom(
  (get) => {
    const userValue = get(userModelKeyAtom);
    return userValue !== null ? userValue : get(settingsAtom).defaultModelKey;
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

export interface ModelConfig {
  modelName: string;
  temperature: number; // Ensure this is set to 1 for o1-preview models
  streaming: boolean;
  maxRetries: number;
  maxConcurrency: number;
  maxCompletionTokens?: number; // Use this for o1-preview models
  maxTokens?: number; // Make conditional on model type
  openAIApiKey?: string;
  openAIOrgId?: string;
  anthropicApiKey?: string;
  cohereApiKey?: string;
  azureOpenAIApiKey?: string;
  azureOpenAIApiInstanceName?: string;
  azureOpenAIApiDeploymentName?: string;
  azureOpenAIApiVersion?: string;
  apiKey?: string; // Shared by Google and TogetherAI
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
  azureOpenAIApiDeploymentName?: string; // Added for Azure OpenAI models
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
