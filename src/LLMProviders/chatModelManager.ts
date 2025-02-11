import { CustomModel, getModelKey, ModelConfig, setModelKey } from "@/aiParams";
import { BREVILABS_API_BASE_URL, BUILTIN_CHAT_MODELS, ChatModelProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { getModelKeyFromModel, getSettings, subscribeToSettingsChange } from "@/settings/model";
import { err2String, isOSeriesModel, safeFetch } from "@/utils";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatCohere } from "@langchain/cohere";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { Notice } from "obsidian";

type ChatConstructorType = new (config: any) => BaseChatModel;

const CHAT_PROVIDER_CONSTRUCTORS = {
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
  [ChatModelProviders.COPILOT_PLUS]: ChatOpenAI,
} as const;

type ChatProviderConstructMap = typeof CHAT_PROVIDER_CONSTRUCTORS;

export default class ChatModelManager {
  private static instance: ChatModelManager;
  private static chatModel: BaseChatModel | null;
  private static modelMap: Record<
    string,
    {
      hasApiKey: boolean;
      AIConstructor: ChatConstructorType;
      vendor: string;
    }
  >;

  private readonly providerApiKeyMap: Record<ChatModelProviders, () => string> = {
    [ChatModelProviders.OPENAI]: () => getSettings().openAIApiKey,
    [ChatModelProviders.GOOGLE]: () => getSettings().googleApiKey,
    [ChatModelProviders.AZURE_OPENAI]: () => getSettings().azureOpenAIApiKey,
    [ChatModelProviders.ANTHROPIC]: () => getSettings().anthropicApiKey,
    [ChatModelProviders.COHEREAI]: () => getSettings().cohereApiKey,
    [ChatModelProviders.OPENROUTERAI]: () => getSettings().openRouterAiApiKey,
    [ChatModelProviders.GROQ]: () => getSettings().groqApiKey,
    [ChatModelProviders.OLLAMA]: () => "default-key",
    [ChatModelProviders.LM_STUDIO]: () => "default-key",
    [ChatModelProviders.OPENAI_FORMAT]: () => "default-key",
    [ChatModelProviders.COPILOT_PLUS]: () => getSettings().plusLicenseKey,
  } as const;

  private constructor() {
    this.buildModelMap();
    subscribeToSettingsChange(() => {
      this.buildModelMap();
      this.validateCurrentModel();
    });
  }

  static getInstance(): ChatModelManager {
    if (!ChatModelManager.instance) {
      ChatModelManager.instance = new ChatModelManager();
    }
    return ChatModelManager.instance;
  }

  private async getModelConfig(customModel: CustomModel): Promise<ModelConfig> {
    const settings = getSettings();

    const modelName = customModel.name;
    const isOSeries = isOSeriesModel(modelName);
    const baseConfig: Omit<ModelConfig, "maxTokens" | "maxCompletionTokens"> = {
      modelName: modelName,
      temperature: customModel.temperature ?? settings.temperature,
      streaming: customModel.stream ?? true,
      maxRetries: 3,
      maxConcurrency: 3,
      enableCors: customModel.enableCors,
    };

    const providerConfig: {
      [K in keyof ChatProviderConstructMap]: ConstructorParameters<ChatProviderConstructMap[K]>[0];
    } = {
      [ChatModelProviders.OPENAI]: {
        modelName: modelName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.openAIApiKey),
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
          organization: await getDecryptedKey(customModel.openAIOrgId || settings.openAIOrgId),
        },
        ...this.handleOpenAIExtraArgs(isOSeries, settings.maxTokens, settings.temperature),
      },
      [ChatModelProviders.ANTHROPIC]: {
        anthropicApiKey: await getDecryptedKey(customModel.apiKey || settings.anthropicApiKey),
        modelName: modelName,
        anthropicApiUrl: customModel.baseUrl,
        clientOptions: {
          // Required to bypass CORS restrictions
          defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.AZURE_OPENAI]: {
        modelName: modelName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.azureOpenAIApiKey),
        configuration: {
          baseURL:
            customModel.baseUrl ||
            `https://${customModel.azureOpenAIApiInstanceName || settings.azureOpenAIApiInstanceName}.openai.azure.com/openai/deployments/${customModel.azureOpenAIApiDeploymentName || settings.azureOpenAIApiDeploymentName}`,
          defaultQuery: {
            "api-version": customModel.azureOpenAIApiVersion || settings.azureOpenAIApiVersion,
          },
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        ...this.handleOpenAIExtraArgs(isOSeries, settings.maxTokens, settings.temperature),
      },
      [ChatModelProviders.COHEREAI]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.cohereApiKey),
        model: modelName,
      },
      [ChatModelProviders.GOOGLE]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.googleApiKey),
        modelName: modelName,
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
        modelName: modelName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.openRouterAiApiKey),
        configuration: {
          baseURL: customModel.baseUrl || "https://openrouter.ai/api/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.GROQ]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.groqApiKey),
        modelName: modelName,
      },
      [ChatModelProviders.OLLAMA]: {
        // ChatOllama has `model` instead of `modelName`!!
        model: modelName,
        // @ts-ignore
        apiKey: customModel.apiKey || "default-key",
        // MUST NOT use /v1 in the baseUrl for ollama
        baseUrl: customModel.baseUrl || "http://localhost:11434",
      },
      [ChatModelProviders.LM_STUDIO]: {
        modelName: modelName,
        openAIApiKey: customModel.apiKey || "default-key",
        configuration: {
          baseURL: customModel.baseUrl || "http://localhost:1234/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.OPENAI_FORMAT]: {
        modelName: modelName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.openAIApiKey),
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
          defaultHeaders: { "dangerously-allow-browser": "true" },
        },
        ...this.handleOpenAIExtraArgs(isOSeries, settings.maxTokens, settings.temperature),
      },
      [ChatModelProviders.COPILOT_PLUS]: {
        modelName: modelName,
        openAIApiKey: await getDecryptedKey(settings.plusLicenseKey),
        configuration: {
          baseURL: BREVILABS_API_BASE_URL,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
    };

    const selectedProviderConfig =
      providerConfig[customModel.provider as keyof typeof providerConfig] || {};

    // Add token configuration separately to ensure they don't conflict
    const tokenConfig = this.handleOpenAIExtraArgs(
      isOSeries,
      customModel.maxTokens ?? settings.maxTokens,
      customModel.temperature ?? settings.temperature
    );

    return {
      ...baseConfig,
      ...selectedProviderConfig,
      ...tokenConfig,
    };
  }

  private handleOpenAIExtraArgs(isOSeriesModel: boolean, maxTokens: number, temperature: number) {
    const config = isOSeriesModel
      ? {
          maxCompletionTokens: maxTokens,
          temperature: 1,
        }
      : {
          maxTokens: maxTokens,
          temperature: temperature,
        };
    return config;
  }

  // Build a map of modelKey to model config
  public buildModelMap() {
    const activeModels = getSettings().activeModels;
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
        const modelKey = getModelKeyFromModel(model);
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
      CHAT_PROVIDER_CONSTRUCTORS[model.provider as ChatModelProviders];
    if (!constructor) {
      console.warn(`Unknown provider: ${model.provider} for model: ${model.name}`);
      throw new Error(`Unknown provider: ${model.provider} for model: ${model.name}`);
    }
    return constructor;
  }

  getChatModel(): BaseChatModel {
    if (!ChatModelManager.chatModel) {
      throw new Error("No valid chat model available. Please check your API key settings.");
    }
    return ChatModelManager.chatModel;
  }

  async setChatModel(model: CustomModel): Promise<void> {
    const modelKey = getModelKeyFromModel(model);
    setModelKey(modelKey);
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

    const modelConfig = await this.getModelConfig(model);

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
    return ChatModelManager.chatModel?.getNumTokens(inputStr) ?? 0;
  }

  private validateCurrentModel(): void {
    if (!ChatModelManager.chatModel) return;

    const currentModelKey = getModelKey();
    if (!currentModelKey) return;

    // Get the model configuration
    const selectedModel = ChatModelManager.modelMap[currentModelKey];

    // If API key is missing or model doesn't exist in map
    if (!selectedModel?.hasApiKey) {
      // Clear the current chat model
      ChatModelManager.chatModel = null;
      console.log("Failed to reinitialize model due to missing API key");
    }
  }

  async ping(model: CustomModel): Promise<boolean> {
    const tryPing = async (enableCors: boolean) => {
      const modelToTest = { ...model, enableCors };
      const modelConfig = await this.getModelConfig(modelToTest);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { streaming, maxTokens, maxCompletionTokens, ...pingConfig } = modelConfig;
      const isOSeries = isOSeriesModel(modelToTest.name);
      const tokenConfig = this.handleOpenAIExtraArgs(isOSeries, 10, modelConfig.temperature);

      const testModel = new (this.getProviderConstructor(modelToTest))({
        ...pingConfig,
        ...tokenConfig,
      });
      await testModel.invoke([{ role: "user", content: "hello" }], {
        timeout: 3000,
      });
    };

    try {
      // First try without CORS
      await tryPing(false);
      return true;
    } catch (firstError) {
      console.log("First ping attempt failed, trying with CORS...");
      try {
        // Second try with CORS
        await tryPing(true);
        new Notice(
          "Connection successful, but requires CORS to be enabled. Please enable CORS for this model once you add it above."
        );
        return true;
      } catch (error) {
        const msg =
          "\nwithout CORS Error: " +
          err2String(firstError) +
          "\nwith CORS Error: " +
          err2String(error);
        throw new Error(msg);
      }
    }
  }
}
