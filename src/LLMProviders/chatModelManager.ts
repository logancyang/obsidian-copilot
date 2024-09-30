import { CustomModel, LangChainParams, ModelConfig } from "@/aiParams";
import { BUILTIN_CHAT_MODELS, ChatModelProviders } from "@/constants";
import EncryptionService from "@/encryptionService";
import { ChatAnthropicWrapped, ProxyChatOpenAI } from "@/langchainWrappers";
import { ChatCohere } from "@langchain/cohere";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      AIConstructor: new (config: any) => BaseChatModel;
      vendor: string;
    }
  >;

  private constructor(
    private getLangChainParams: () => LangChainParams,
    encryptionService: EncryptionService,
    activeModels: CustomModel[]
  ) {
    this.encryptionService = encryptionService;
    this.buildModelMap(activeModels);
  }

  static getInstance(
    getLangChainParams: () => LangChainParams,
    encryptionService: EncryptionService,
    activeModels: CustomModel[]
  ): ChatModelManager {
    if (!ChatModelManager.instance) {
      ChatModelManager.instance = new ChatModelManager(
        getLangChainParams,
        encryptionService,
        activeModels
      );
    }
    return ChatModelManager.instance;
  }

  private getModelConfig(customModel: CustomModel): ModelConfig {
    const decrypt = (key: string) => this.encryptionService.getDecryptedKey(key);
    const params = this.getLangChainParams();
    const baseConfig: ModelConfig = {
      modelName: customModel.name,
      temperature: params.temperature,
      streaming: true,
      maxRetries: 3,
      maxConcurrency: 3,
      enableCors: customModel.enableCors,
    };

    const providerConfig = {
      [ChatModelProviders.OPENAI]: {
        modelName: customModel.name,
        openAIApiKey: decrypt(customModel.apiKey || params.openAIApiKey),
        openAIOrgId: decrypt(params.openAIOrgId),
        maxTokens: params.maxTokens,
      },
      [ChatModelProviders.ANTHROPIC]: {
        anthropicApiKey: decrypt(customModel.apiKey || params.anthropicApiKey),
        modelName: customModel.name,
      },
      [ChatModelProviders.AZURE_OPENAI]: {
        maxTokens: params.maxTokens,
        azureOpenAIApiKey: decrypt(customModel.apiKey || params.azureOpenAIApiKey),
        azureOpenAIApiInstanceName: params.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName: params.azureOpenAIApiDeploymentName,
        azureOpenAIApiVersion: params.azureOpenAIApiVersion,
      },
      [ChatModelProviders.COHEREAI]: {
        apiKey: decrypt(customModel.apiKey || params.cohereApiKey),
        model: customModel.name,
      },
      [ChatModelProviders.GOOGLE]: {
        apiKey: decrypt(customModel.apiKey || params.googleApiKey),
        modelName: customModel.name,
      },
      [ChatModelProviders.OPENROUTERAI]: {
        modelName: customModel.name,
        openAIApiKey: decrypt(customModel.apiKey || params.openRouterAiApiKey),
        openAIProxyBaseUrl: "https://openrouter.ai/api/v1",
      },
      [ChatModelProviders.GROQ]: {
        apiKey: decrypt(customModel.apiKey || params.groqApiKey),
        modelName: customModel.name,
      },
      [ChatModelProviders.OLLAMA]: {
        // ChatOllama has `model` instead of `modelName`!!
        model: customModel.name,
        apiKey: customModel.apiKey || "default-key",
        // MUST NOT use /v1 in the baseUrl for ollama
        baseUrl: customModel.baseUrl || "http://localhost:11434",
      },
      [ChatModelProviders.LM_STUDIO]: {
        modelName: customModel.name,
        openAIApiKey: customModel.apiKey || "default-key",
        openAIProxyBaseUrl: customModel.baseUrl || "http://localhost:1234/v1",
      },
      [ChatModelProviders.OPENAI_FORMAT]: {
        modelName: customModel.name,
        openAIApiKey: decrypt(customModel.apiKey || "default-key"),
        maxTokens: params.maxTokens,
        openAIProxyBaseUrl: customModel.baseUrl || "",
      },
    };

    const selectedProviderConfig =
      providerConfig[customModel.provider as keyof typeof providerConfig] || {};

    return { ...baseConfig, ...selectedProviderConfig };
  }

  // Build a map of modelKey to model config
  public buildModelMap(activeModels: CustomModel[]) {
    ChatModelManager.modelMap = {};
    const modelMap = ChatModelManager.modelMap;

    const allModels = activeModels ?? BUILTIN_CHAT_MODELS;

    allModels.forEach((model) => {
      if (model.enabled) {
        let constructor;
        let apiKey;

        switch (model.provider) {
          case ChatModelProviders.OPENAI:
            constructor = ChatOpenAI;
            apiKey = model.apiKey || this.getLangChainParams().openAIApiKey;
            break;
          case ChatModelProviders.GOOGLE:
            constructor = ChatGoogleGenerativeAI;
            apiKey = model.apiKey || this.getLangChainParams().googleApiKey;
            break;
          case ChatModelProviders.AZURE_OPENAI:
            constructor = ChatOpenAI;
            apiKey = model.apiKey || this.getLangChainParams().azureOpenAIApiKey;
            break;
          case ChatModelProviders.ANTHROPIC:
            constructor = ChatAnthropicWrapped;
            apiKey = model.apiKey || this.getLangChainParams().anthropicApiKey;
            break;
          case ChatModelProviders.COHEREAI:
            constructor = ChatCohere;
            apiKey = model.apiKey || this.getLangChainParams().cohereApiKey;
            break;
          case ChatModelProviders.OPENROUTERAI:
            constructor = ProxyChatOpenAI;
            apiKey = model.apiKey || this.getLangChainParams().openRouterAiApiKey;
            break;
          case ChatModelProviders.OLLAMA:
            constructor = ChatOllama;
            apiKey = model.apiKey || "default-key";
            break;
          case ChatModelProviders.LM_STUDIO:
            constructor = ProxyChatOpenAI;
            apiKey = model.apiKey || "default-key";
            break;
          case ChatModelProviders.GROQ:
            constructor = ChatGroq;
            apiKey = model.apiKey || this.getLangChainParams().groqApiKey;
            break;
          case ChatModelProviders.OPENAI_FORMAT:
            constructor = ProxyChatOpenAI;
            apiKey = model.apiKey || "default-key";
            break;
          default:
            console.warn(`Unknown provider: ${model.provider} for model: ${model.name}`);
            return;
        }

        const modelKey = `${model.name}|${model.provider}`;
        modelMap[modelKey] = {
          hasApiKey: Boolean(model.apiKey || apiKey),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          AIConstructor: constructor as any,
          vendor: model.provider,
        };
      }
    });
  }

  getChatModel(): BaseChatModel {
    return ChatModelManager.chatModel;
  }

  setChatModel(model: CustomModel): void {
    const modelKey = `${model.name}|${model.provider}`;
    if (!ChatModelManager.modelMap.hasOwnProperty(modelKey)) {
      throw new Error(`No model found for: ${modelKey}`);
    }

    // Create and return the appropriate model
    const selectedModel = ChatModelManager.modelMap[modelKey];
    if (!selectedModel.hasApiKey) {
      const errorMessage = `API key is not provided for the model: ${modelKey}. Model switch failed.`;
      new Notice(errorMessage);
      // Stop execution and deliberate fail the model switch
      throw new Error(errorMessage);
    }

    const modelConfig = this.getModelConfig(model);

    // MUST update it since chatModelManager is a singleton.
    this.getLangChainParams().modelKey = `${model.name}|${model.provider}`;
    new Notice(`Setting model: ${modelConfig.modelName}`);
    try {
      const newModelInstance = new selectedModel.AIConstructor({
        ...modelConfig,
      });
      // Set the new model
      ChatModelManager.chatModel = newModelInstance;
    } catch (error) {
      console.error(error);
      new Notice(`Error creating model: ${modelKey}`);
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
