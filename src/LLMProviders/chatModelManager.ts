import { LangChainParams, ModelConfig } from "@/aiParams";
import {
  ANTHROPIC_MODELS,
  AZURE_MODELS,
  GOOGLE_MODELS,
  GROQ_MODELS,
  LM_STUDIO_MODELS,
  ModelProviders,
  OLLAMA_MODELS,
  OPENAI_MODELS,
  OPENROUTERAI_MODELS,
  PROXY_SERVER_PORT,
} from "@/constants";
import EncryptionService from "@/encryptionService";
import { ProxyChatOpenAI } from "@/langchainWrappers";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/community/chat_models/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { BaseChatModel } from "langchain/chat_models/base";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { Notice } from "obsidian";

export default class ChatModelManager {
  private encryptionService: EncryptionService;
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
    private langChainParams: LangChainParams,
    encryptionService: EncryptionService,
  ) {
    this.encryptionService = encryptionService;
    this.buildModelMap();
  }

  static getInstance(
    langChainParams: LangChainParams,
    encryptionService: EncryptionService,
  ): ChatModelManager {
    if (!ChatModelManager.instance) {
      ChatModelManager.instance = new ChatModelManager(
        langChainParams,
        encryptionService,
      );
    }
    return ChatModelManager.instance;
  }

  private getModelConfig(chatModelProvider: string): ModelConfig {
    const decrypt = (key: string) =>
      this.encryptionService.getDecryptedKey(key);
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
        modelName:
          params.openAIProxyModelName ||
          params.openAICustomModel ||
          params.model,
        openAIApiKey: decrypt(params.openAIApiKey),
        openAIOrgId: decrypt(params.openAIOrgId),
        maxTokens: params.maxTokens,
        openAIProxyBaseUrl: params.openAIProxyBaseUrl,
      },
      [ModelProviders.ANTHROPIC]: {
        anthropicApiUrl: `http://localhost:${PROXY_SERVER_PORT}`,
        anthropicApiKey: decrypt(params.anthropicApiKey),
        modelName: params.anthropicModel,
      },
      [ModelProviders.AZURE_OPENAI]: {
        maxTokens: params.maxTokens,
        azureOpenAIApiKey: decrypt(params.azureOpenAIApiKey),
        azureOpenAIApiInstanceName: params.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName: params.azureOpenAIApiDeploymentName,
        azureOpenAIApiVersion: params.azureOpenAIApiVersion,
      },
      [ModelProviders.GOOGLE]: {
        apiKey: decrypt(params.googleApiKey),
        modelName: params.googleCustomModel || params.model,
      },
      [ModelProviders.OPENROUTERAI]: {
        modelName: params.openRouterModel,
        openAIApiKey: decrypt(params.openRouterAiApiKey),
        openAIProxyBaseUrl: "https://openrouter.ai/api/v1",
      },
      [ModelProviders.LM_STUDIO]: {
        openAIApiKey: "placeholder",
        openAIProxyBaseUrl: `${params.lmStudioBaseUrl}`,
      },
      [ModelProviders.OLLAMA]: {
        ...(params.ollamaBaseUrl ? { baseUrl: params.ollamaBaseUrl } : {}),
        modelName: params.ollamaModel,
      },
      [ModelProviders.GROQ]: {
        apiKey: decrypt(params.groqApiKey),
        modelName: params.groqModel,
      },
    };

    const selectedProviderConfig =
      providerConfig[chatModelProvider as keyof typeof providerConfig] || {};

    // When useOpenAILocalProxy is enabled, use local proxy server
    // Local proxy server will proxy requests to openAIProxyBaseUrl
    if (
      chatModelProvider === ModelProviders.OPENAI &&
      params.useOpenAILocalProxy &&
      params.openAIProxyBaseUrl
    ) {
      (
        selectedProviderConfig as (typeof providerConfig)[ModelProviders.OPENAI]
      ).openAIProxyBaseUrl = `http://localhost:${PROXY_SERVER_PORT}`;
    }

    return { ...baseConfig, ...selectedProviderConfig };
  }

  private buildModelMap() {
    ChatModelManager.modelMap = {};
    const modelMap = ChatModelManager.modelMap;

    const OpenAIChatModel = this.langChainParams.openAIProxyBaseUrl
      ? ProxyChatOpenAI
      : ChatOpenAI;

    const modelConfigurations = [
      {
        models: OPENAI_MODELS,
        apiKey: this.langChainParams.openAIApiKey,
        organization: this.langChainParams.openAIOrgId,
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
        models: ANTHROPIC_MODELS,
        apiKey: this.langChainParams.anthropicApiKey,
        constructor: ChatAnthropic,
        vendor: ModelProviders.ANTHROPIC,
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
      {
        models: GROQ_MODELS,
        apiKey: this.langChainParams.groqApiKey,
        constructor: ChatGroq,
        vendor: ModelProviders.GROQ,
      },
    ];

    modelConfigurations.forEach(({ models, apiKey, constructor, vendor }) => {
      models.forEach((modelDisplayNameKey) => {
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

    // Update the langChainParams.model with the prioritized model name
    // MUST update it since chatModelManager is a singleton.
    this.langChainParams.model = modelConfig.modelName;
    new Notice(`Setting model: ${modelConfig.modelName}`);
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
    return true;
  }

  async countTokens(inputStr: string): Promise<number> {
    return ChatModelManager.chatModel.getNumTokens(inputStr);
  }
}
