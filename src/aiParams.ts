import { ChainType } from "@/chainFactory";
import { ChatPromptTemplate } from "langchain/prompts";
import { NoteFile } from "./vectorDBManager";

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
}

export interface LangChainParams {
  modelKey: string; // name | provider, e.g. "gpt-4o|openai"
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
  embeddingModelKey: string; // name | provider, e.g. "text-embedding-3-large|openai"
  temperature: number;
  maxTokens: number;
  systemMessage: string;
  chatContextTurns: number;
  chainType: ChainType; // Default ChainType is set in main.ts getChainManagerParams
  options: SetChainOptions;
  openAIProxyBaseUrl?: string;
  enableCors?: boolean;
  openAIProxyModelName?: string;
  openAIEmbeddingProxyBaseUrl?: string;
  openAIEmbeddingProxyModelName?: string;
  groqApiKey: string;
}

export interface SetChainOptions {
  prompt?: ChatPromptTemplate;
  noteFile?: NoteFile;
  forceNewCreation?: boolean;
  abortController?: AbortController;
  debug?: boolean;
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
}
