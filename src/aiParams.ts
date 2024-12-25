import { ChainType } from "@/chainFactory";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { atom, useAtom } from "jotai";
import { settingsAtom, settingsStore, getSettings, setSettings } from "@/settings/model";
import { ChatModelProviders } from "./constants";
import { merge } from "lodash";

const userModelKeyAtom = atom<string | null>(null);
const modelKeyAtom = atom(
  (get) => {
    const userValue = get(userModelKeyAtom);
    if (userValue !== null) {
      return userValue;
    }
    const modelKey = get(settingsAtom).defaultModelKey;
    const isAzure = modelKey.startsWith(ChatModelProviders.AZURE_OPENAI);
    const isO1Preview = modelKey.startsWith("o1-preview");
    if (isAzure && !isO1Preview) {
      return modelKey;
    }
    const deploymentName = isO1Preview ? modelKey.split("|")[1] : "";
    const settings = getSettings();
    const defaultDeployment = settings.azureOpenAIApiDeployments?.[0];
    if (isO1Preview && !deploymentName && defaultDeployment) {
      return `${modelKey}|${defaultDeployment.deploymentName}`;
    }
    return modelKey;
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
  maxCompletionTokens?: number;
  reasoningEffort?: number;
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

export function updateModelConfig(
  modelKey: string,
  newConfig: Partial<ModelConfig>
) {
  const settings = getSettings();
  const modelConfigs = { ...settings.modelConfigs };

  // Handle Azure models config update
  if (modelKey.startsWith("o1-preview")) {
    const deploymentName = modelKey.split("|")[1] || "";

    const deploymentIndex = settings.azureOpenAIApiDeployments?.findIndex(
      (d) => d.deploymentName === deploymentName
    );

    if (deploymentIndex !== undefined && deploymentIndex !== -1) {
      const deployment = settings.azureOpenAIApiDeployments?.[deploymentIndex];
      if (deployment) {
        newConfig = merge({}, newConfig, {
          apiKey: deployment.apiKey,
          azureOpenAIApiInstanceName: deployment.instanceName,
          azureOpenAIApiVersion: deployment.apiVersion,
        });
      }
    }
  }

  modelConfigs[modelKey] = merge({}, modelConfigs[modelKey], newConfig);

  setSettings({ ...settings, modelConfigs });
}
export type { AzureOpenAIDeployment };
