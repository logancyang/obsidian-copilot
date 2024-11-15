import { CustomModel, LangChainParams, ModelConfig } from "@/aiParams";
import { BUILTIN_CHAT_MODELS, ChatModelProviders } from "@/constants";
import EncryptionService from "@/encryptionService";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { ChatCohere } from "@langchain/cohere";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { Notice } from "obsidian";
import { omit, safeFetch } from "@/utils";
import { ChatAnthropic } from "@langchain/anthropic";

type ChatConstructorType = new (config: any) => BaseChatModel;

// Keep the original ProviderConstructMap type
type ChatProviderConstructMap = {
  [K in ChatModelProviders]: K extends ChatModelProviders.OPENAI
    ? typeof ChatOpenAI
    : K extends ChatModelProviders.AZURE_OPENAI
      ? typeof ChatOpenAI
      : K extends ChatModelProviders.ANTHROPIC
        ? typeof ChatAnthropic
        : K extends ChatModelProviders.COHEREAI
          ? typeof ChatCohere
          : K extends ChatModelProviders.GOOGLE
            ? typeof ChatGoogleGenerativeAI
            : K extends ChatModelProviders.OPENROUTERAI
              ? typeof ChatOpenAI
              : K extends ChatModelProviders.OLLAMA
                ? typeof ChatOllama
                : K extends ChatModelProviders.LM_STUDIO
                  ? typeof ChatOpenAI
                  : K extends ChatModelProviders.GROQ
                    ? typeof ChatGroq
                    : K extends ChatModelProviders.OPENAI_FORMAT
                      ? typeof ChatOpenAI
                      : never;
};

export default class ChatModelManager {
  private encryptionService: EncryptionService;
  private static instance: ChatModelManager;
  private static chatModel: BaseChatModel;
  private static chatOpenAI: ChatOpenAI;
  private static modelMap: Record<
    string,
    {
      hasApiKey: boolean;
      AIConstructor: ChatConstructorType;
      vendor: string;
    }
  >;

  // Use both ProviderConstructMap and restrict keys to ChatModelProviders
  private readonly chatModelProvider2Construct: ChatProviderConstructMap = {
    [ChatModelProviders.OPENAI]: ChatOpenAI,
    [ChatModelProviders.AZURE_OPENAI]: ChatOpenAI,
    [ChatModelProviders.ANTHROPIC]: ChatAnthropic,
    [ChatModelProviders.COHEREAI]: ChatCohere,
    [ChatModelProviders.GOOGLE]: ChatGoogleGenerativeAI,
    [ChatModelProviders.OPENROUTERAI]: ChatOpenAI,
    [ChatModelProviders.OLLAMA]: ChatOllama,
    [ChatModelProviders.LM_STUDIO]: ChatOpenAI,
    [ChatModelProviders.GROQ]: ChatGroq,
    [ChatModelProviders.OPENAI_FORMAT]: ChatOpenAI,
  };

  private readonly providerApiKeyMap: Record<ChatModelProviders, () => string> = {
    [ChatModelProviders.OPENAI]: () => this.getLangChainParams().openAIApiKey,
    [ChatModelProviders.GOOGLE]: () => this.getLangChainParams().googleApiKey,
    [ChatModelProviders.AZURE_OPENAI]: () => this.getLangChainParams().azureOpenAIApiKey,
    [ChatModelProviders.ANTHROPIC]: () => this.getLangChainParams().anthropicApiKey,
    [ChatModelProviders.COHEREAI]: () => this.getLangChainParams().cohereApiKey,
    [ChatModelProviders.OPENROUTERAI]: () => this.getLangChainParams().openRouterAiApiKey,
    [ChatModelProviders.GROQ]: () => this.getLangChainParams().groqApiKey,
    [ChatModelProviders.OLLAMA]: () => "default-key",
    [ChatModelProviders.LM_STUDIO]: () => "default-key",
    [ChatModelProviders.OPENAI_FORMAT]: () => "default-key",
  } as const;

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

  private getModelConfig(customModel: CustomModel, ignoreDefaultSettings = false): ModelConfig {
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

    type ProviderConstructMap = typeof ChatModelManager.prototype.chatModelProvider2Construct;
    const providerConfig: {
      [K in keyof ProviderConstructMap]: ConstructorParameters<
        ProviderConstructMap[K]
      >[0] /*& Record<string, unknown>;*/;
    } = {
      [ChatModelProviders.OPENAI]: {
        modelName: customModel.name,
        openAIApiKey: decrypt(customModel.apiKey || params.openAIApiKey),
        // @ts-ignore
        openAIOrgId: decrypt(params.openAIOrgId),
        maxTokens: params.maxTokens,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.ANTHROPIC]: {
        anthropicApiKey: decrypt(customModel.apiKey || params.anthropicApiKey),
        modelName: customModel.name,
        anthropicApiUrl: customModel.baseUrl,
        clientOptions: {
          // Required to bypass CORS restrictions
          defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.AZURE_OPENAI]: {
        maxTokens: params.maxTokens,
        azureOpenAIApiKey: decrypt(customModel.apiKey || params.azureOpenAIApiKey),
        azureOpenAIApiInstanceName: params.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName: params.azureOpenAIApiDeploymentName,
        azureOpenAIApiVersion: params.azureOpenAIApiVersion,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.COHEREAI]: {
        apiKey: decrypt(customModel.apiKey || params.cohereApiKey),
        model: customModel.name,
      },
      [ChatModelProviders.GOOGLE]: {
        apiKey: decrypt(customModel.apiKey || params.googleApiKey),
        model: customModel.name,
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
        ],
        baseUrl: customModel.baseUrl,
      },
      [ChatModelProviders.OPENROUTERAI]: {
        modelName: customModel.name,
        openAIApiKey: decrypt(customModel.apiKey || params.openRouterAiApiKey),
        configuration: {
          baseURL: customModel.baseUrl || "https://openrouter.ai/api/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.GROQ]: {
        apiKey: decrypt(customModel.apiKey || params.groqApiKey),
        modelName: customModel.name,
      },
      [ChatModelProviders.OLLAMA]: {
        // ChatOllama has `model` instead of `modelName`!!
        model: customModel.name,
        // @ts-ignore
        apiKey: customModel.apiKey || "default-key",
        // MUST NOT use /v1 in the baseUrl for ollama
        baseUrl: customModel.baseUrl || "http://localhost:11434",
      },
      [ChatModelProviders.LM_STUDIO]: {
        modelName: customModel.name,
        openAIApiKey: customModel.apiKey || "default-key",
        configuration: {
          baseURL: customModel.baseUrl || "http://localhost:1234/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.OPENAI_FORMAT]: {
        modelName: customModel.name,
        openAIApiKey: decrypt(customModel.apiKey || "default-key"),
        maxTokens: params.maxTokens,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
          dangerouslyAllowBrowser: true,
        },
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
        if (!Object.values(ChatModelProviders).contains(model.provider as ChatModelProviders)) {
          console.warn(`Unknown provider: ${model.provider} for model: ${model.name}`);
          return;
        }

        const constructor = this.getProviderConstructor(model);
        const getDefaultApiKey = this.providerApiKeyMap[model.provider as ChatModelProviders];

        const apiKey = model.apiKey || getDefaultApiKey();
        const modelKey = `${model.name}|${model.provider}`;
        modelMap[modelKey] = {
          hasApiKey: Boolean(model.apiKey || apiKey),
          AIConstructor: constructor,
          vendor: model.provider,
        };
      }
    });
  }

  getProviderConstructor(model: CustomModel): ChatConstructorType {
    const constructor: ChatConstructorType =
      this.chatModelProvider2Construct[model.provider as ChatModelProviders];
    if (!constructor) {
      console.warn(`Unknown provider: ${model.provider} for model: ${model.name}`);
      throw new Error(`Unknown provider: ${model.provider} for model: ${model.name}`);
    }
    return constructor;
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
    this.getLangChainParams().modelKey = modelKey;
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

  async ping(model: CustomModel): Promise<"PONG"> {
    model.enableCors = true; // enable CORS for verification
    // remove streaming、temperature ...... property
    const modelConfig = omit(this.getModelConfig(model), ["streaming", "temperature", "maxTokens"]);

    const aIConstructor = this.getProviderConstructor(model);
    const newModelInstance = new aIConstructor({
      ...modelConfig,
    });

    return newModelInstance.invoke("Testing. Just say PONG and nothing else.").then((chunk) => {
      return "PONG";
    });
  }
}
