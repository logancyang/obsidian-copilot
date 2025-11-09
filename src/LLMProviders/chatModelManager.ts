import { CustomModel, getModelKey, ModelConfig } from "@/aiParams";
import {
  BREVILABS_MODELS_BASE_URL,
  BUILTIN_CHAT_MODELS,
  ChatModelProviders,
  ModelCapability,
  ProviderInfo,
} from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logError, logInfo } from "@/logger";
import {
  CopilotSettings,
  getModelKeyFromModel,
  getSettings,
  subscribeToSettingsChange,
} from "@/settings/model";
import {
  err2String,
  findCustomModel,
  getModelInfo,
  ModelInfo,
  safeFetch,
  withSuppressedTokenWarnings,
} from "@/utils";
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
import { ChatOpenRouter } from "./ChatOpenRouter";
import { BedrockChatModel, type BedrockChatModelFields } from "./BedrockChatModel";

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
  [ChatModelProviders.OPENROUTERAI]: ChatOpenRouter,
  [ChatModelProviders.OLLAMA]: ChatOllama,
  [ChatModelProviders.LM_STUDIO]: ChatOpenAI,
  [ChatModelProviders.GROQ]: ChatGroq,
  [ChatModelProviders.OPENAI_FORMAT]: ChatOpenAI,
  [ChatModelProviders.SILICONFLOW]: ChatOpenAI,
  [ChatModelProviders.COPILOT_PLUS]: ChatOpenAI,
  [ChatModelProviders.MISTRAL]: ChatMistralAI,
  [ChatModelProviders.DEEPSEEK]: ChatDeepSeek,
  [ChatModelProviders.AMAZON_BEDROCK]: BedrockChatModel,
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
    [ChatModelProviders.AMAZON_BEDROCK]: () => getSettings().amazonBedrockApiKey,
    [ChatModelProviders.SILICONFLOW]: () => getSettings().siliconflowApiKey,
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

  private static readonly REASONING_MODEL_TEMPERATURE = 1;

  /**
   * Determines the appropriate temperature for a model
   * @returns temperature value or undefined if temperature should not be set
   */
  private getTemperatureForModel(
    modelInfo: ModelInfo,
    customModel: CustomModel,
    settings: CopilotSettings
  ): number | undefined {
    // Thinking-enabled models don't accept temperature
    if (modelInfo.isThinkingEnabled) {
      return undefined;
    }

    // O-series and GPT-5 models require temperature = 1
    if (modelInfo.isOSeries || modelInfo.isGPT5) {
      return ChatModelManager.REASONING_MODEL_TEMPERATURE;
    }

    // All other models use configured temperature
    return customModel.temperature ?? settings.temperature;
  }

  private async getModelConfig(customModel: CustomModel): Promise<ModelConfig> {
    const settings = getSettings();

    const modelName = customModel.name;
    const modelInfo = getModelInfo(modelName);
    const { isThinkingEnabled } = modelInfo;
    const resolvedTemperature = this.getTemperatureForModel(modelInfo, customModel, settings);
    const maxTokens = customModel.maxTokens ?? settings.maxTokens;

    // Base config - temperature will be handled by provider-specific methods
    const baseConfig: Omit<ModelConfig, "maxTokens" | "maxCompletionTokens"> = {
      modelName: modelName,
      streaming: customModel.stream ?? true,
      maxRetries: 3,
      maxConcurrency: 3,
      enableCors: customModel.enableCors,
      // Add temperature for normal models (will be overridden by special configs if needed)
      ...(!isThinkingEnabled && resolvedTemperature !== undefined
        ? { temperature: resolvedTemperature }
        : {}),
    };

    const providerConfig: {
      [K in keyof ChatProviderConstructMap]: ConstructorParameters<ChatProviderConstructMap[K]>[0];
    } = {
      [ChatModelProviders.OPENAI]: {
        modelName: modelName,
        apiKey: await getDecryptedKey(customModel.apiKey || settings.openAIApiKey),
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
          organization: await getDecryptedKey(customModel.openAIOrgId || settings.openAIOrgId),
        },
        ...this.getOpenAISpecialConfig(
          modelName,
          customModel.maxTokens ?? settings.maxTokens,
          customModel.temperature ?? settings.temperature,
          customModel
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
          thinking: { type: "enabled", budget_tokens: 2048 },
        }),
      },
      [ChatModelProviders.AZURE_OPENAI]: {
        modelName:
          customModel.azureOpenAIApiDeploymentName || settings.azureOpenAIApiDeploymentName,
        apiKey: await getDecryptedKey(customModel.apiKey || settings.azureOpenAIApiKey),
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
        ...this.getOpenAISpecialConfig(
          modelName,
          customModel.maxTokens ?? settings.maxTokens,
          customModel.temperature ?? settings.temperature,
          customModel
        ),
      },
      [ChatModelProviders.COHEREAI]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.cohereApiKey),
        model: modelName,
      },
      [ChatModelProviders.GOOGLE]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.googleApiKey),
        model: modelName,
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
        apiKey: await getDecryptedKey(customModel.apiKey || settings.openRouterAiApiKey),
        configuration: {
          baseURL: customModel.baseUrl || "https://openrouter.ai/api/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
          defaultHeaders: {
            "HTTP-Referer": "https://obsidiancopilot.com",
            "X-Title": "Obsidian Copilot",
          },
        },
        // Enable reasoning if the model has the reasoning capability
        enableReasoning: customModel.capabilities?.includes(ModelCapability.REASONING) ?? false,
        // Pass reasoning effort if configured and reasoning capability is enabled
        reasoningEffort:
          customModel.capabilities?.includes(ModelCapability.REASONING) &&
          customModel.reasoningEffort
            ? customModel.reasoningEffort
            : undefined,
      },
      [ChatModelProviders.GROQ]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.groqApiKey),
        model: modelName,
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
        apiKey: customModel.apiKey || "default-key",
        configuration: {
          baseURL: customModel.baseUrl || "http://localhost:1234/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [ChatModelProviders.OPENAI_FORMAT]: {
        modelName: modelName,
        apiKey: await getDecryptedKey(customModel.apiKey || settings.openAIApiKey),
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
          defaultHeaders: { "dangerously-allow-browser": "true" },
        },
        ...this.getOpenAISpecialConfig(
          modelName,
          customModel.maxTokens ?? settings.maxTokens,
          customModel.temperature ?? settings.temperature,
          customModel
        ),
      },
      [ChatModelProviders.SILICONFLOW]: {
        modelName: modelName,
        apiKey: await getDecryptedKey(customModel.apiKey || settings.siliconflowApiKey),
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.SILICONFLOW].host,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        ...this.getOpenAISpecialConfig(
          modelName,
          customModel.maxTokens ?? settings.maxTokens,
          customModel.temperature ?? settings.temperature,
          customModel
        ),
      },
      [ChatModelProviders.COPILOT_PLUS]: {
        modelName: modelName,
        apiKey: await getDecryptedKey(settings.plusLicenseKey),
        configuration: {
          baseURL: BREVILABS_MODELS_BASE_URL,
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
      [ChatModelProviders.AMAZON_BEDROCK]: {} as BedrockChatModelFields,
    };

    let selectedProviderConfig =
      providerConfig[customModel.provider as keyof typeof providerConfig] || {};

    if (customModel.provider === ChatModelProviders.AMAZON_BEDROCK) {
      selectedProviderConfig = await this.buildBedrockConfig(
        customModel,
        modelName,
        settings,
        maxTokens,
        resolvedTemperature
      );
    }

    // Get provider-specific parameters (like topP, frequencyPenalty) that the provider supports
    const providerSpecificParams = this.getProviderSpecificParams(
      customModel.provider as ChatModelProviders,
      customModel
    );

    // LangChain 0.6.6 handles token configuration for special models internally
    const tokenConfig = {
      maxTokens,
    };

    const finalConfig = {
      ...baseConfig,
      ...selectedProviderConfig,
      ...providerSpecificParams,
      ...tokenConfig,
    };

    return finalConfig as ModelConfig;
  }

  /**
   * Adds special configuration for OpenAI models that support reasoning
   * LangChain 0.6.6+ handles most of the token/temperature logic internally
   *
   * NOTE: GPT-5 models require Responses API for verbosity parameter to work.
   * The useResponsesApi flag is set automatically in createModelInstance() for GPT-5.
   */
  private getOpenAISpecialConfig(
    modelName: string,
    maxTokens: number,
    _temperature: number | undefined,
    customModel?: CustomModel
  ) {
    const settings = getSettings();
    const modelInfo = getModelInfo(modelName);
    const resolvedTemperature = this.getTemperatureForModel(
      modelInfo,
      customModel || ({} as CustomModel),
      settings
    );

    const config: any = {
      maxTokens,
      temperature: resolvedTemperature,
    };

    // Add reasoning parameters for O-series and GPT-5 models
    // LangChain 0.6.6 will handle the endpoint routing and parameter conversion
    if ((modelInfo.isOSeries || modelInfo.isGPT5) && customModel?.reasoningEffort) {
      config.reasoning = {
        effort: customModel.reasoningEffort,
      };

      // Add verbosity for GPT-5 models (Responses API only)
      // This requires useResponsesApi=true which is set in createModelInstance()
      // In Responses API, verbosity must be passed as text.verbosity
      if (modelInfo.isGPT5 && customModel?.verbosity) {
        const verbosityValue = customModel.verbosity;
        // For Responses API, verbosity is nested under 'text' parameter
        config.text = {
          verbosity: verbosityValue,
        };
      }
    }

    return config;
  }

  /**
   * Builds configuration for Amazon Bedrock models by merging custom overrides with global defaults.
   * @param customModel - The model definition provided by the user.
   * @param modelName - The resolved Bedrock model identifier to invoke.
   * @param settings - Current Copilot settings.
   * @param maxTokens - Maximum completion tokens requested for the invocation.
   * @param temperature - Optional temperature override for the invocation.
   */
  private async buildBedrockConfig(
    customModel: CustomModel,
    modelName: string,
    settings: CopilotSettings,
    maxTokens: number,
    temperature: number | undefined
  ): Promise<BedrockChatModelFields> {
    const apiKeySource = customModel.apiKey || settings.amazonBedrockApiKey;
    if (!apiKeySource) {
      throw new Error(
        "Amazon Bedrock API key is not configured. Provide a key in Settings > API Keys or the model definition."
      );
    }

    const apiKey = await getDecryptedKey(apiKeySource);

    const explicitRegion = customModel.bedrockRegion?.trim();
    const settingsRegion = settings.amazonBedrockRegion?.trim();
    const resolvedRegion = explicitRegion || settingsRegion || "us-east-1";
    const baseUrlInput = customModel.baseUrl?.trim();
    const baseUrl = baseUrlInput ? baseUrlInput.replace(/\/+$/, "") : undefined;
    const endpointBase = baseUrl || `https://bedrock-runtime.${resolvedRegion}.amazonaws.com`;

    const encodedModel = encodeURIComponent(modelName);
    const endpoint = `${endpointBase}/model/${encodedModel}/invoke`;
    const streamEndpoint = `${endpointBase}/model/${encodedModel}/invoke-with-response-stream`;
    const fetchImplementation = customModel.enableCors ? safeFetch : undefined;
    // Inference profiles prefix Anthropic identifiers (e.g. global.anthropic.*), so look for the segment anywhere.
    const requiresAnthropicVersion = /(^|\.)anthropic\./.test(modelName);
    const anthropicVersion = requiresAnthropicVersion ? "bedrock-2023-05-31" : undefined;
    // Only enable thinking mode if user has explicitly enabled REASONING capability
    const enableThinking = customModel.capabilities?.includes(ModelCapability.REASONING) ?? false;

    return {
      modelName,
      modelId: modelName,
      apiKey,
      endpoint,
      streamEndpoint,
      defaultMaxTokens: maxTokens,
      defaultTemperature: temperature,
      defaultTopP: customModel.topP,
      anthropicVersion,
      enableThinking,
      fetchImplementation,
      streaming: customModel.stream ?? true,
    };
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
          ChatModelProviders.SILICONFLOW,
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
          ChatModelProviders.SILICONFLOW,
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
        const hasCredentials = this.hasProviderCredentials(model);
        const modelKey = getModelKeyFromModel(model);
        modelMap[modelKey] = {
          hasApiKey: hasCredentials,
          AIConstructor: constructor,
          vendor: model.provider,
        };
      }
    });
  }

  /**
   * Checks if a model has the necessary credentials configured for its provider.
   * @param model - The custom model definition.
   * @returns True when the provider requirements are satisfied, otherwise false.
   */
  private hasProviderCredentials(model: CustomModel): boolean {
    if (model.provider === ChatModelProviders.AMAZON_BEDROCK) {
      const settings = getSettings();
      const apiKey = model.apiKey || settings.amazonBedrockApiKey;
      // Region defaults to us-east-1 if not specified, so API key is the only requirement
      return Boolean(apiKey);
    }

    const getDefaultApiKey = this.providerApiKeyMap[model.provider as ChatModelProviders];
    if (!getDefaultApiKey) {
      return Boolean(model.apiKey);
    }

    return Boolean(model.apiKey || getDefaultApiKey());
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

  /**
   * Helper to validate a model config has valid credentials and meets entitlement requirements.
   * Does NOT check believerExclusive - that's validated at usage time, not selection time.
   */
  private isModelConfigValid(model: CustomModel, settings: CopilotSettings): boolean {
    const modelKey = getModelKeyFromModel(model);
    const modelInfo = ChatModelManager.modelMap[modelKey];

    // Check if model exists in map and has API key
    if (!modelInfo || !modelInfo.hasApiKey) {
      return false;
    }

    // Check Copilot Plus entitlement requirements
    if (model.plusExclusive && !settings.isPlusUser) {
      return false;
    }

    return true;
  }

  /**
   * Resolves the active chat model for temperature override operations.
   * Uses a single source of truth: getModelKey() -> findCustomModel()
   * Falls back to first valid model in settings.activeModels if current selection is invalid.
   *
   * Note: believerExclusive models are trusted if explicitly selected by the user,
   * but skipped in fallback to avoid selecting them for non-Believer users.
   */
  private resolveModelForTemperatureOverride(): CustomModel {
    const settings = getSettings();

    // Try to get the user's currently selected model
    try {
      const currentModelKey = getModelKey();
      if (currentModelKey) {
        const model = findCustomModel(currentModelKey, settings.activeModels);

        // Validate it (trust believerExclusive if user selected it)
        if (this.isModelConfigValid(model, settings)) {
          return model;
        }
      }
    } catch {
      // Model not found or invalid, fall through to fallback
    }

    // Fallback: Find first valid model in settings.activeModels
    // Skip believerExclusive models in fallback to avoid selecting them for non-Believer users
    for (const model of settings.activeModels) {
      if (model.enabled && !model.believerExclusive && this.isModelConfigValid(model, settings)) {
        return model;
      }
    }

    // No valid model found
    throw new Error(
      "No valid chat model available for temperature override. " +
        "Please check your API key settings and ensure at least one model is properly configured."
    );
  }

  /**
   * langchain 1.0 TypeScript doesn't support temperature override in BaseChatModelCallOptions,
   * so we need to create a new model instance with the specified temperature.
   */
  async getChatModelWithTemperature(temperature: number): Promise<BaseChatModel> {
    const modelConfig = this.resolveModelForTemperatureOverride();

    // Create a temporary model config with overridden temperature
    const modelWithTempOverride: CustomModel = {
      ...modelConfig,
      temperature,
    };

    return await this.createModelInstance(modelWithTempOverride);
  }

  async setChatModel(model: CustomModel): Promise<void> {
    const modelKey = getModelKeyFromModel(model);
    try {
      const modelInstance = await this.createModelInstance(model);
      ChatModelManager.chatModel = modelInstance;

      // Log if Responses API is enabled for GPT-5
      const modelInfo = getModelInfo(model.name);
      if (
        modelInfo.isGPT5 &&
        (model.provider === ChatModelProviders.OPENAI ||
          model.provider === ChatModelProviders.AZURE_OPENAI ||
          model.provider === ChatModelProviders.OPENAI_FORMAT)
      ) {
        logInfo(`Chat model set with Responses API for GPT-5: ${model.name}`);
      }
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
    const modelInfo = getModelInfo(model.name);

    // For GPT-5 models, automatically use Responses API for proper verbosity support
    const constructorConfig: any = { ...modelConfig };
    if (
      modelInfo.isGPT5 &&
      (selectedModel.vendor === ChatModelProviders.OPENAI ||
        selectedModel.vendor === ChatModelProviders.AZURE_OPENAI ||
        selectedModel.vendor === ChatModelProviders.OPENAI_FORMAT)
    ) {
      constructorConfig.useResponsesApi = true;
      logInfo(`Enabling Responses API for GPT-5 model: ${model.name} (${selectedModel.vendor})`);
    }

    const newModelInstance = new selectedModel.AIConstructor(constructorConfig);
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
      logInfo("Failed to reinitialize model due to missing API key");
    }
  }

  async ping(model: CustomModel): Promise<boolean> {
    const tryPing = async (enableCors: boolean) => {
      const modelToTest = { ...model, enableCors };
      const modelConfig = await this.getModelConfig(modelToTest);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { streaming, maxTokens, maxCompletionTokens, ...pingConfig } = modelConfig;
      // For ping, just use minimal config
      const tokenConfig = { maxTokens: 30 };

      // Check if it's a GPT-5 model and enable Responses API for proper support
      const modelInfo = getModelInfo(model.name);
      const constructorConfig: any = {
        ...pingConfig,
        ...tokenConfig,
      };

      if (
        modelInfo.isGPT5 &&
        (model.provider === ChatModelProviders.OPENAI ||
          model.provider === ChatModelProviders.AZURE_OPENAI ||
          model.provider === ChatModelProviders.OPENAI_FORMAT)
      ) {
        constructorConfig.useResponsesApi = true;
      }

      const testModel = new (this.getProviderConstructor(modelToTest))(constructorConfig);
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
