import { ChainType } from "@/chainFactory";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { ModelCapability } from "@/constants";
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
    if (userValue !== null) {
      return userValue;
    }
    return get(settingsAtom).defaultChainType;
  },
  (get, set, newValue) => {
    set(userChainTypeAtom, newValue);
  }
);

const currentProjectAtom = atom<ProjectConfig | null>(null);
const projectLoadingAtom = atom<boolean>(false);

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
    inclusions: string;
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
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;

  context?: number;
  projectEnabled?: boolean;
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

export function setCurrentProject(project: ProjectConfig | null) {
  settingsStore.set(currentProjectAtom, project);
}

export function getCurrentProject(): ProjectConfig | null {
  return settingsStore.get(currentProjectAtom);
}

export function subscribeToProjectChange(
  callback: (project: ProjectConfig | null) => void
): () => void {
  return settingsStore.sub(currentProjectAtom, () => {
    callback(settingsStore.get(currentProjectAtom));
  });
}

export function useCurrentProject() {
  return useAtom(currentProjectAtom, {
    store: settingsStore,
  });
}

export function setProjectLoading(loading: boolean) {
  settingsStore.set(projectLoadingAtom, loading);
}

export function isProjectLoading(): boolean {
  return settingsStore.get(projectLoadingAtom);
}

export function subscribeToProjectLoadingChange(callback: (loading: boolean) => void): () => void {
  return settingsStore.sub(projectLoadingAtom, () => {
    callback(settingsStore.get(projectLoadingAtom));
  });
}

export function useProjectLoading() {
  return useAtom(projectLoadingAtom, {
    store: settingsStore,
  });
}

export function isProjectMode() {
  return getChainType() === ChainType.PROJECT_CHAIN;
}
