import { CustomModel, getModelKey, ModelConfig } from "@/aiParams";
import {
  BREVILABS_API_BASE_URL,
  BUILTIN_CHAT_MODELS,
  ChatModelProviders,
  ProviderInfo,
} from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logError, logInfo } from "@/logger";
import { getModelKeyFromModel, getSettings, subscribeToSettingsChange } from "@/settings/model";
import { err2String, isOSeriesModel, safeFetch, withSuppressedTokenWarnings } from "@/utils";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatCohere } from "@langchain/cohere";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { ChatXAI } from "@langchain/xai";
import { Notice } from "obsidian";

type ChatConstructorType = {
  new (config: any): any;
};

const CHAT_PROVIDER_CONSTRUCTORS = {
  [ChatModelProviders.OPENAI]: ChatOpenAI,
  [ChatModelProviders.AZURE_OPENAI]: ChatOpenAI,
  [ChatModelProviders.ANTHROPIC]: ChatAnthropic,
  [ChatModelProviders.COHEREAI]: ChatCohere,
  [ChatModelProviders.GOOGLE]: ChatGoogleGenerativeAI,
  [ChatModelProviders.XAI]: ChatXAI,
  [ChatModelProviders.OPENROUTERAI]: ChatOpenAI,
  [ChatModelProviders.OLLAMA]: ChatOllama,
  [ChatModelProviders.LM_STUDIO]: ChatOpenAI,
  [ChatModelProviders.GROQ]: ChatGroq,
  [ChatModelProviders.OPENAI_FORMAT]: ChatOpenAI,
  [ChatModelProviders.COPILOT_PLUS]: ChatOpenAI,
  [ChatModelProviders.MISTRAL]: ChatMistralAI,
  [ChatModelProviders.DEEPSEEK]: ChatDeepSeek,
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
    [ChatModelProviders.XAI]: () => getSettings().xaiApiKey,
    [ChatModelProviders.OLLAMA]: () => "default-key",
    [ChatModelProviders.LM_STUDIO]: () => "default-key",
    [ChatModelProviders.OPENAI_FORMAT]: () => "default-key",
    [ChatModelProviders.COPILOT_PLUS]: () => getSettings().plusLicenseKey,
    [ChatModelProviders.MISTRAL]: () => getSettings().mistralApiKey,
    [ChatModelProviders.DEEPSEEK]: () => getSettings().deepseekApiKey,
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
    const isThinkingEnabled =
      modelName.startsWith("claude-3-7-sonnet") || modelName.startsWith("claude-sonnet-4");

    // Base config without temperature when thinking is enabled
    const baseConfig: Omit<ModelConfig, "maxTokens" | "maxCompletionTokens" | "temperature"> = {
      modelName: modelName,
      streaming: customModel.stream ?? true,
      maxRetries: 3,
      maxConcurrency: 3,
      enableCors: customModel.enableCors,
    };

    // Add temperature only if thinking is not enabled
    if (!isThinkingEnabled) {
      (baseConfig as any).temperature = customModel.temperature ?? settings.temperature;
    }

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
        ...this.handleOpenAIExtraArgs(
          isOSeries,
          customModel.maxTokens ?? settings.maxTokens,
          customModel.temperature ?? settings.temperature
        ),
      },
      [ChatModelProviders.ANTHROPIC]: {
        anthropicApiKey: await getDecryptedKey(customModel.apiKey || settings.anthropicApiKey),
        model: modelName,
        anthropicApiUrl: customModel.baseUrl,
        clientOptions: {
          // Required to bypass CORS restrictions
          defaultHeaders: {
            "anthropic-dangerous-direct-browser-access": "true",
          },
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        ...(isThinkingEnabled && {
          thinking: { type: "enabled", budget_tokens: 1024 },
        }),
      },
      [ChatModelProviders.AZURE_OPENAI]: {
        modelName:
          customModel.azureOpenAIApiDeploymentName || settings.azureOpenAIApiDeploymentName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.azureOpenAIApiKey),
        configuration: {
          baseURL:
            customModel.baseUrl ||
            `https://${customModel.azureOpenAIApiInstanceName || settings.azureOpenAIApiInstanceName}.openai.azure.com/openai/deployments/${customModel.azureOpenAIApiDeploymentName || settings.azureOpenAIApiDeploymentName}`,
          defaultQuery: {
            "api-version": customModel.azureOpenAIApiVersion || settings.azureOpenAIApiVersion,
          },
          defaultHeaders: {
            "Content-Type": "application/json",
            "api-key": await getDecryptedKey(customModel.apiKey || settings.azureOpenAIApiKey),
          },
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        ...this.handleOpenAIExtraArgs(
          isOSeries,
          customModel.maxTokens ?? settings.maxTokens,
          customModel.temperature ?? settings.temperature
        ),
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
      [ChatModelProviders.XAI]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.xaiApiKey),
        model: modelName,
        // This langchainjs XAI client does not support baseURL override
      },
      [ChatModelProviders.OPENROUTERAI]: {
        modelName: modelName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.openRouterAiApiKey),
        configuration: {
          baseURL: customModel.baseUrl || "https://openrouter.ai/api/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
          defaultHeaders: {
            "HTTP-Referer": "https://obsidiancopilot.com",
            "X-Title": "Obsidian Copilot",
          },
        },
      },
      [ChatModelProviders.GROQ]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.groqApiKey),
        modelName: modelName,
      },
      [ChatModelProviders.OLLAMA]: {
        // ChatOllama has `model` instead of `modelName`!!
        model: modelName,
        // MUST NOT use /v1 in the baseUrl for ollama
        baseUrl: customModel.baseUrl || "http://localhost:11434",
        headers: new Headers({
          Authorization: `Bearer ${await getDecryptedKey(customModel.apiKey || "default-key")}`,
        }),
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
        ...this.handleOpenAIExtraArgs(
          isOSeries,
          customModel.maxTokens ?? settings.maxTokens,
          customModel.temperature ?? settings.temperature
        ),
      },
      [ChatModelProviders.COPILOT_PLUS]: {
        modelName: modelName,
        openAIApiKey: await getDecryptedKey(settings.plusLicenseKey),
        configuration: {
          baseURL: BREVILABS_API_BASE_URL,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.MISTRAL]: {
        model: modelName,
        apiKey: await getDecryptedKey(customModel.apiKey || settings.mistralApiKey),
        serverURL: customModel.baseUrl,
      },
      [ChatModelProviders.DEEPSEEK]: {
        modelName: modelName,
        apiKey: await getDecryptedKey(customModel.apiKey || settings.deepseekApiKey),
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.DEEPSEEK].host,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
    };

    const selectedProviderConfig =
      providerConfig[customModel.provider as keyof typeof providerConfig] || {};

    // Get provider-specific parameters (like topP, frequencyPenalty) that the provider supports
    const providerSpecificParams = this.getProviderSpecificParams(
      customModel.provider as ChatModelProviders,
      customModel
    );

    const tokenConfig = isThinkingEnabled
      ? {
          maxTokens: customModel.maxTokens ?? settings.maxTokens,
        }
      : this.handleOpenAIExtraArgs(
          isOSeries,
          customModel.maxTokens ?? settings.maxTokens,
          customModel.temperature ?? settings.temperature
        );

    const finalConfig = {
      ...baseConfig,
      ...selectedProviderConfig,
      ...providerSpecificParams,
      ...tokenConfig,
    };

    // Final safety check to ensure no temperature when thinking is enabled
    if (isThinkingEnabled) {
      delete finalConfig.temperature;
    }

    return finalConfig as ModelConfig;
  }

  private handleOpenAIExtraArgs(
    isOSeriesModel: boolean,
    maxTokens: number,
    temperature: number | undefined
  ) {
    const config = isOSeriesModel
      ? {
          maxCompletionTokens: maxTokens,
          temperature: temperature === undefined ? undefined : 1,
        }
      : {
          maxTokens: maxTokens,
          temperature: temperature,
        };
    return config;
  }

  /**
   * Returns provider-specific parameters (like topP, frequencyPenalty) based on what the provider supports
   * This prevents passing undefined values to providers that don't support them
   */
  private getProviderSpecificParams(provider: ChatModelProviders, customModel: CustomModel) {
    const params: Record<string, any> = {};

    // Add topP only if defined
    if (customModel.topP !== undefined) {
      // These providers support topP
      if (
        [
          ChatModelProviders.OPENAI,
          ChatModelProviders.AZURE_OPENAI,
          ChatModelProviders.ANTHROPIC,
          ChatModelProviders.GOOGLE,
          ChatModelProviders.OPENROUTERAI,
          ChatModelProviders.OLLAMA,
          ChatModelProviders.LM_STUDIO,
          ChatModelProviders.OPENAI_FORMAT,
          ChatModelProviders.MISTRAL,
          ChatModelProviders.DEEPSEEK,
        ].includes(provider)
      ) {
        params.topP = customModel.topP;
      }
    }

    // Add frequencyPenalty only if defined
    if (customModel.frequencyPenalty !== undefined) {
      // These providers support frequencyPenalty
      if (
        [
          ChatModelProviders.OPENAI,
          ChatModelProviders.AZURE_OPENAI,
          ChatModelProviders.OPENROUTERAI,
          ChatModelProviders.OLLAMA,
          ChatModelProviders.LM_STUDIO,
          ChatModelProviders.OPENAI_FORMAT,
          ChatModelProviders.MISTRAL,
          ChatModelProviders.DEEPSEEK,
        ].includes(provider)
      ) {
        params.frequencyPenalty = customModel.frequencyPenalty;
      }
    }

    return params;
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
    try {
      const modelInstance = await this.createModelInstance(model);
      ChatModelManager.chatModel = modelInstance;
    } catch (error) {
      logError(error);
      new Notice(`Error creating model: ${modelKey}`);
    }
  }

  async createModelInstance(model: CustomModel): Promise<BaseChatModel> {
    // Create and return the appropriate model
    const modelKey = getModelKeyFromModel(model);
    const selectedModel = ChatModelManager.modelMap[modelKey];
    if (!selectedModel) {
      throw new Error(`No model found for: ${modelKey}`);
    }
    if (!selectedModel.hasApiKey) {
      const errorMessage = `API key is not provided for the model: ${modelKey}.`;
      new Notice(errorMessage);
      throw new Error(errorMessage);
    }

    const modelConfig = await this.getModelConfig(model);

    const newModelInstance = new selectedModel.AIConstructor({
      ...modelConfig,
    });
    return newModelInstance;
  }

  validateChatModel(chatModel: BaseChatModel): boolean {
    if (chatModel === undefined || chatModel === null) {
      return false;
    }
    return true;
  }

  // Custom token estimation function for fallback when model is unknown
  private estimateTokens(text: string): number {
    if (!text) return 0;
    // This is a simple approximation: ~4 chars per token for English text
    // More accurate than using word count, but still a decent estimation
    return Math.ceil(text.length / 4);
  }

  async countTokens(inputStr: string): Promise<number> {
    try {
      return await withSuppressedTokenWarnings(async () => {
        return ChatModelManager.chatModel?.getNumTokens(inputStr) ?? 0;
      });
    } catch (error) {
      // If there's an error calculating tokens, use a simple approximation instead
      // This prevents "Unknown model" errors from appearing in the console
      if (error instanceof Error && error.message.includes("Unknown model")) {
        // Simple approximation: 1 token ~= 4 characters for English text
        logInfo("Using estimated token count due to tokenizer error");
        // Fall back to our estimation if LangChain's method fails
        return this.estimateTokens(inputStr);
      }
      // For other errors, rethrow
      throw error;
    }
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
      const tokenConfig = this.handleOpenAIExtraArgs(isOSeries, 30, modelConfig.temperature);
      const testModel = new (this.getProviderConstructor(modelToTest))({
        ...pingConfig,
        ...tokenConfig,
      });
      await testModel.invoke([{ role: "user", content: "hello" }], {
        timeout: 8000,
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

  findModelByName(modelName: string): CustomModel | undefined {
    const settings = getSettings();
    return settings.activeModels.find((model) => model.name === modelName);
  }
}
