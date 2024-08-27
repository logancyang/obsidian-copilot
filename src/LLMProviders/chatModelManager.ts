import { CustomModel, LangChainParams, ModelConfig } from "@/aiParams";
import { BUILTIN_CHAT_MODELS, ChatModelProviders } from "@/constants";
import EncryptionService from "@/encryptionService";
import { ChatAnthropicWrapped, ProxyChatOpenAI } from "@/langchainWrappers";
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
      modelName: params.model,
      temperature: params.temperature,
      streaming: true,
      maxRetries: 3,
      maxConcurrency: 3,
    };

    const providerConfig = {
      [ChatModelProviders.OPENAI]: {
        modelName: params.openAIProxyModelName || params.openAICustomModel || params.model,
        openAIApiKey: decrypt(params.openAIApiKey),
        openAIOrgId: decrypt(params.openAIOrgId),
        maxTokens: params.maxTokens,
        openAIProxyBaseUrl: params.openAIProxyBaseUrl,
      },
      [ChatModelProviders.ANTHROPIC]: {
        anthropicApiKey: decrypt(params.anthropicApiKey),
        modelName: customModel.name,
        clientOptions: {
          defaultHeaders: {
            // Required for Anthropic models to work without CORS error
            "anthropic-dangerous-direct-browser-access": "true",
          },
        },
      },
      [ChatModelProviders.AZURE_OPENAI]: {
        maxTokens: params.maxTokens,
        azureOpenAIApiKey: decrypt(params.azureOpenAIApiKey),
        azureOpenAIApiInstanceName: params.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName: params.azureOpenAIApiDeploymentName,
        azureOpenAIApiVersion: params.azureOpenAIApiVersion,
      },
      [ChatModelProviders.GOOGLE]: {
        apiKey: decrypt(params.googleApiKey),
        modelName: customModel.name,
      },
      [ChatModelProviders.OPENROUTERAI]: {
        modelName: customModel.name,
        openAIApiKey: decrypt(params.openRouterAiApiKey) || decrypt(customModel.apiKey || ""),
        openAIProxyBaseUrl: "https://openrouter.ai/api/v1",
      },
      [ChatModelProviders.GROQ]: {
        apiKey: decrypt(params.groqApiKey),
        modelName: customModel.name,
      },
      [ChatModelProviders.OLLAMA]: {
        modelName: customModel.name,
        openAIApiKey: customModel.apiKey || "default-key",
        openAIProxyBaseUrl: params.ollamaBaseUrl || "http://localhost:11434/v1",
      },
      [ChatModelProviders.LM_STUDIO]: {
        modelName: customModel.name,
        openAIApiKey: customModel.apiKey || "default-key",
        openAIProxyBaseUrl: params.lmStudioBaseUrl || "http://localhost:1234/v1",
      },
      [ChatModelProviders.OPENAI_FORMAT]: {
        modelName: customModel.name,
        openAIApiKey: decrypt(customModel.apiKey || ""),
        maxTokens: params.maxTokens,
        openAIProxyBaseUrl: customModel.baseUrl || "",
      },
    };

    const selectedProviderConfig =
      providerConfig[customModel.provider as keyof typeof providerConfig] || {};

    return { ...baseConfig, ...selectedProviderConfig };
  }

  public buildModelMap(activeModels: CustomModel[]) {
    ChatModelManager.modelMap = {};
    const modelMap = ChatModelManager.modelMap;

    const allModels = activeModels ?? BUILTIN_CHAT_MODELS;

    allModels.forEach((model) => {
      if (model.enabled) {
        let constructor;
        let apiKey;

        if (model.baseUrl) {
          constructor = ProxyChatOpenAI;
        } else {
          switch (model.provider) {
            case ChatModelProviders.OPENAI:
              constructor = ChatOpenAI;
              apiKey = this.getLangChainParams().openAIApiKey;
              break;
            case ChatModelProviders.GOOGLE:
              constructor = ChatGoogleGenerativeAI;
              apiKey = this.getLangChainParams().googleApiKey;
              break;
            case ChatModelProviders.AZURE_OPENAI:
              constructor = ChatOpenAI;
              apiKey = this.getLangChainParams().azureOpenAIApiKey;
              break;
            case ChatModelProviders.ANTHROPIC:
              constructor = ChatAnthropicWrapped;
              apiKey = this.getLangChainParams().anthropicApiKey;
              break;
            case ChatModelProviders.OPENROUTERAI:
              constructor = ProxyChatOpenAI;
              apiKey = this.getLangChainParams().openRouterAiApiKey;
              break;
            case ChatModelProviders.OLLAMA:
              constructor = ProxyChatOpenAI;
              apiKey = model.apiKey || "default-key";
              break;
            case ChatModelProviders.LM_STUDIO:
              constructor = ProxyChatOpenAI;
              apiKey = model.apiKey || "default-key";
              break;
            case ChatModelProviders.GROQ:
              constructor = ChatGroq;
              apiKey = this.getLangChainParams().groqApiKey;
              break;
            case ChatModelProviders.OPENAI_FORMAT:
              constructor = ProxyChatOpenAI;
              apiKey = model.apiKey;
              break;
            default:
              console.warn(`Unknown provider: ${model.provider} for model: ${model.name}`);
              return;
          }
        }

        modelMap[model.name] = {
          hasApiKey: Boolean(model.apiKey || apiKey),
          AIConstructor: constructor,
          vendor: model.provider,
        };
      }
    });
  }

  getChatModel(): BaseChatModel {
    return ChatModelManager.chatModel;
  }

  setChatModel(model: CustomModel): void {
    if (!ChatModelManager.modelMap.hasOwnProperty(model.name)) {
      throw new Error(`No model found for: ${model.name}`);
    }

    // Create and return the appropriate model
    const selectedModel = ChatModelManager.modelMap[model.name];
    if (!selectedModel.hasApiKey) {
      const errorMessage = `API key is not provided for the model: ${model.name}. Model switch failed.`;
      new Notice(errorMessage);
      // Stop execution and deliberate fail the model switch
      throw new Error(errorMessage);
    }

    const modelConfig = this.getModelConfig(model);

    // Update the langChainParams.model with the prioritized model name
    // MUST update it since chatModelManager is a singleton.
    this.getLangChainParams().model = modelConfig.modelName;
    new Notice(`Setting model: ${modelConfig.modelName}`);
    try {
      const newModelInstance = new selectedModel.AIConstructor({
        ...modelConfig,
      });
      // Set the new model
      ChatModelManager.chatModel = newModelInstance;
    } catch (error) {
      console.error(error);
      new Notice(`Error creating model: ${model.name}`);
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
