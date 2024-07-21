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
  anthropicModel?: string;
  azureOpenAIApiKey?: string;
  azureOpenAIApiInstanceName?: string;
  azureOpenAIApiDeploymentName?: string;
  azureOpenAIApiVersion?: string;
  // Google and TogetherAI API key share this property
  apiKey?: string;
  openAIProxyBaseUrl?: string;
  ollamaModel?: string;
  // OllamaBaseUrl
  baseUrl?: string;
  openRouterModel?: string;
  lmStudioBaseUrl?: string;
  groqApiKey?: string;
  groqModel?: string;
}

export interface LangChainParams {
  openAIApiKey: string;
  openAIOrgId: string;
  huggingfaceApiKey: string;
  cohereApiKey: string;
  anthropicApiKey: string;
  anthropicModel: string;
  azureOpenAIApiKey: string;
  azureOpenAIApiInstanceName: string;
  azureOpenAIApiDeploymentName: string;
  azureOpenAIApiVersion: string;
  azureOpenAIApiEmbeddingDeploymentName: string;
  googleApiKey: string;
  openRouterAiApiKey: string;
  model: string;
  modelDisplayName: string;
  embeddingModel: string;
  temperature: number;
  maxTokens: number;
  systemMessage: string;
  chatContextTurns: number;
  chainType: ChainType; // Default ChainType is set in main.ts getChainManagerParams
  options: SetChainOptions;
  ollamaModel: string;
  ollamaBaseUrl: string;
  openRouterModel: string;
  lmStudioBaseUrl: string;
  openAIProxyBaseUrl?: string;
  openAIProxyModelName?: string;
  openAIEmbeddingProxyBaseUrl?: string;
  openAIEmbeddingProxyModelName?: string;
  groqApiKey: string;
  groqModel: string;
}

export interface SetChainOptions {
  prompt?: ChatPromptTemplate;
  noteFile?: NoteFile;
  forceNewCreation?: boolean;
  abortController?: AbortController;
  debug?: boolean;
}
