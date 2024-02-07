import { LangChainParams, ModelConfig } from '@/aiParams';
import {
  AZURE_MODELS,
  GOOGLE_MODELS,
  LM_STUDIO_MODELS,
  ModelProviders,
  OLLAMA_MODELS,
  OPENAI_MODELS,
  OPENROUTERAI_MODELS
} from '@/constants';
import { ProxyChatOpenAI } from '@/langchainWrappers';
import { ChatOllama } from "@langchain/community/chat_models/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from 'langchain/chat_models/base';
import { ChatOpenAI } from 'langchain/chat_models/openai';
import { Notice } from 'obsidian';

export default class ChatModelManager {
  private static instance: ChatModelManager;
  private static chatModel: BaseChatModel;
  private static chatOpenAI: ChatOpenAI;
  private static modelMap: Record<
    string,
    {
      hasApiKey: boolean;
      AIConstructor: new (config: ModelConfig) => BaseChatModel;
      vendor: string;
    }
  >;


  private constructor(
    private langChainParams: LangChainParams
  ) {
    this.buildModelMap();
  }

  static getInstance(
    langChainParams: LangChainParams
  ): ChatModelManager {
    if (!ChatModelManager.instance) {
      ChatModelManager.instance = new ChatModelManager(langChainParams);
    }
    return ChatModelManager.instance;
  }

  private getModelConfig(chatModelProvider: string): ModelConfig {
    const params = this.langChainParams;
    const baseConfig: ModelConfig = {
      modelName: params.model,
      temperature: params.temperature,
      streaming: true,
      maxRetries: 3,
      maxConcurrency: 3,
    };

    const providerConfig = {
      [ModelProviders.OPENAI]: {
        openAIApiKey: params.openAIApiKey,
        maxTokens: params.maxTokens,
        openAIProxyBaseUrl: params.openAIProxyBaseUrl,
      },
      [ModelProviders.ANTHROPIC]: {
        anthropicApiKey: params.anthropicApiKey,
      },
      [ModelProviders.AZURE_OPENAI]: {
        maxTokens: params.maxTokens,
        azureOpenAIApiKey: params.azureOpenAIApiKey,
        azureOpenAIApiInstanceName: params.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName: params.azureOpenAIApiDeploymentName,
        azureOpenAIApiVersion: params.azureOpenAIApiVersion,
      },
      [ModelProviders.GOOGLE]: {
        apiKey: params.googleApiKey,
      },
      [ModelProviders.OPENROUTERAI]: {
        modelName: params.openRouterModel,
        openAIApiKey: params.openRouterAiApiKey,
        openAIProxyBaseUrl: 'https://openrouter.ai/api/v1',
      },
      [ModelProviders.LM_STUDIO]: {
        openAIApiKey: 'placeholder',
        openAIProxyBaseUrl: `${params.lmStudioBaseUrl}`,
      },
      [ModelProviders.OLLAMA]: {
        ...(params.ollamaBaseUrl ? { baseUrl: params.ollamaBaseUrl } : {}),
        modelName: params.ollamaModel,
      },
    };

    return { ...baseConfig, ...(providerConfig[chatModelProvider as keyof typeof providerConfig] || {}) };
  }

  private buildModelMap() {
    ChatModelManager.modelMap = {};
    const modelMap = ChatModelManager.modelMap;

    const OpenAIChatModel = this.langChainParams.openAIProxyBaseUrl
      ? ProxyChatOpenAI : ChatOpenAI;

    const modelConfigurations = [
      {
        models: OPENAI_MODELS,
        apiKey: this.langChainParams.openAIApiKey,
        constructor: OpenAIChatModel,
        vendor: ModelProviders.OPENAI,
      },
      {
        models: AZURE_MODELS,
        apiKey: this.langChainParams.azureOpenAIApiKey,
        constructor: ChatOpenAI,
        vendor: ModelProviders.AZURE_OPENAI,
      },
      {
        models: GOOGLE_MODELS,
        apiKey: this.langChainParams.googleApiKey,
        constructor: ChatGoogleGenerativeAI,
        vendor: ModelProviders.GOOGLE,
      },
      {
        models: OPENROUTERAI_MODELS,
        apiKey: this.langChainParams.openRouterAiApiKey,
        constructor: ProxyChatOpenAI,
        vendor: ModelProviders.OPENROUTERAI,
      },
      {
        models: OLLAMA_MODELS,
        apiKey: true,
        constructor: ChatOllama,
        vendor: ModelProviders.OLLAMA,
      },
      {
        models: LM_STUDIO_MODELS,
        apiKey: true,
        constructor: ProxyChatOpenAI,
        vendor: ModelProviders.LM_STUDIO,
      },
    ];

    modelConfigurations.forEach(({ models, apiKey, constructor, vendor }) => {
      models.forEach(modelDisplayNameKey => {
        modelMap[modelDisplayNameKey] = {
          hasApiKey: Boolean(apiKey),
          AIConstructor: constructor,
          vendor: vendor,
        };
      });
    });
  }

  getChatModel(): BaseChatModel {
    return ChatModelManager.chatModel;
  }

  setChatModel(modelDisplayName: string): void {
    if (!ChatModelManager.modelMap.hasOwnProperty(modelDisplayName)) {
      throw new Error(`No model found for: ${modelDisplayName}`);
    }

    // Create and return the appropriate model
    const selectedModel = ChatModelManager.modelMap[modelDisplayName];
    if (!selectedModel.hasApiKey) {
      const errorMessage = `API key is not provided for the model: ${modelDisplayName}. Model switch failed.`;
      new Notice(errorMessage);
      // Stop execution and deliberate fail the model switch
      throw new Error(errorMessage);
    }

    const modelConfig = this.getModelConfig(selectedModel.vendor);

    try {
      const newModelInstance = new selectedModel.AIConstructor({
        ...modelConfig,
      });

      // Set the new model
      ChatModelManager.chatModel = newModelInstance;
    } catch (error) {
      console.error(error);
      new Notice(`Error creating model: ${modelDisplayName}`);
    }
  }

  validateChatModel(chatModel: BaseChatModel): boolean {
    if (chatModel === undefined || chatModel === null) {
      return false;
    }
    return true
  }

  async countTokens(inputStr: string): Promise<number> {
    return ChatModelManager.chatOpenAI.getNumTokens(inputStr);
  }
}