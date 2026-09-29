import { CustomModel, getModelKey, ModelConfig } from "@/aiParams";
import {
  BREVILABS_MODELS_BASE_URL,
  BUILTIN_CHAT_MODELS,
  ChatModelProviders,
  DEFAULT_OLLAMA_NUM_CTX,
  ModelCapability,
  ProviderInfo,
} from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { getModelKeyFromModel, getSettings, subscribeToSettingsChange } from "@/settings/model";
import { getModelInfo, safeFetchNoThrow } from "@/utils";
import { googleHostBaseUrl, groqHostBaseUrl } from "@/utils/providerBaseUrl";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { ChatXAI } from "@langchain/xai";
import { MissingApiKeyError, MissingPlusLicenseError } from "@/error";
import { ChatOpenRouter } from "./ChatOpenRouter";
import { ChatLMStudio } from "./ChatLMStudio";
import { BrevilabsClient } from "./brevilabsClient";
import type { SafetySetting } from "@google/generative-ai";

const GOOGLE_SAFETY_SETTINGS_BLOCK_NONE: SafetySetting[] = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" } as SafetySetting,
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" } as SafetySetting,
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" } as SafetySetting,
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" } as SafetySetting,
];

(
  BaseLanguageModel.prototype as { getNumTokens: (...args: unknown[]) => Promise<number> }
).getNumTokens = async (content: string | Array<{ type: string; text?: string }>) => {
  const text =
    typeof content === "string"
      ? content
      : content.map((item: { type: string; text?: string }): string => item.text ?? "").join("");
  return Math.ceil(text.length / 4);
};

type ChatConstructorType = {
  new (config: Record<string, unknown>): BaseChatModel;
};

const CHAT_PROVIDER_CONSTRUCTORS = {
  [ChatModelProviders.OPENAI]: ChatOpenAI,
  [ChatModelProviders.ANTHROPIC]: ChatAnthropic,
  [ChatModelProviders.COHEREAI]: ChatOpenAI,
  [ChatModelProviders.GOOGLE]: ChatGoogleGenerativeAI,
  [ChatModelProviders.XAI]: ChatXAI,
  [ChatModelProviders.OPENROUTERAI]: ChatOpenRouter,
  [ChatModelProviders.OLLAMA]: ChatOllama,
  [ChatModelProviders.LM_STUDIO]: ChatOpenRouter,
  [ChatModelProviders.GROQ]: ChatGroq,
  [ChatModelProviders.OPENAI_FORMAT]: ChatOpenAI,
  [ChatModelProviders.SILICONFLOW]: ChatOpenAI,
  [ChatModelProviders.COPILOT_PLUS]: ChatOpenRouter,
  [ChatModelProviders.MISTRAL]: ChatOpenAI,
  [ChatModelProviders.DEEPSEEK]: ChatDeepSeek,
} as const;

type ChatProviderConstructMap = typeof CHAT_PROVIDER_CONSTRUCTORS;

export default class ChatModelManager {
  private static instance: ChatModelManager;
  private static chatModel: BaseChatModel | null;
  private static activeModel: CustomModel | null = null;
  private static activeModelSource: "legacy" | "bridged" | null = null;
  private static modelMap: Record<
    string,
    {
      hasApiKey: boolean;
      AIConstructor: ChatConstructorType;
      vendor: string;
    }
  >;

  private static readonly ANTHROPIC_THINKING_BUDGET_TOKENS = 2048;

  private readonly providerApiKeyMap: Record<ChatModelProviders, () => string> = {
    [ChatModelProviders.OPENAI]: () => getSettings().openAIApiKey,
    [ChatModelProviders.GOOGLE]: () => getSettings().googleApiKey,
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

  private async getModelConfig(
    customModel: CustomModel,
    allowLegacyCredentialFallback: boolean = true
  ): Promise<ModelConfig> {
    const settings = getSettings();

    const modelName = customModel.name;
    const modelInfo = getModelInfo(modelName);
    const { isThinkingEnabled, usesAdaptiveThinking } = modelInfo;
    const maxTokens = customModel.maxTokens;
    const openAIFormatIsKeyless = customModel.requiresApiKey === false && !customModel.apiKey;

    // No temperature is sent: providers disagree on accepted values (Kimi and OpenAI reasoning models require 1, Anthropic thinking models reject it).
    // https://github.com/logancyang/obsidian-copilot/issues/2959
    const baseConfig: Omit<ModelConfig, "maxTokens" | "maxCompletionTokens"> = {
      modelName: modelName,
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
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.openAIApiKey,
          allowLegacyCredentialFallback
        ),
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
          organization: customModel.openAIOrgId || settings.openAIOrgId,
        },
        ...this.getOpenAISpecialConfig(modelName, maxTokens, customModel),
      },
      [ChatModelProviders.ANTHROPIC]: {
        anthropicApiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.anthropicApiKey,
          allowLegacyCredentialFallback
        ),
        model: modelName,
        anthropicApiUrl: customModel.baseUrl,
        clientOptions: {
          defaultHeaders: {
            "anthropic-dangerous-direct-browser-access": "true",
          },
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
        ...(isThinkingEnabled && {
          thinking: usesAdaptiveThinking
            ? { type: "adaptive" as const, display: "summarized" as const }
            : {
                type: "enabled" as const,
                budget_tokens: ChatModelManager.ANTHROPIC_THINKING_BUDGET_TOKENS,
              },
        }),
      },
      [ChatModelProviders.COHEREAI]: {
        modelName,
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.cohereApiKey,
          allowLegacyCredentialFallback
        ),
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.COHEREAI].host,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
      },
      [ChatModelProviders.GOOGLE]: {
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.googleApiKey,
          allowLegacyCredentialFallback
        ),
        model: modelName,
        safetySettings: GOOGLE_SAFETY_SETTINGS_BLOCK_NONE,
        baseUrl: googleHostBaseUrl(customModel.baseUrl),
      },
      [ChatModelProviders.XAI]: {
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.xaiApiKey,
          allowLegacyCredentialFallback
        ),
        model: modelName,
      },
      [ChatModelProviders.OPENROUTERAI]: {
        modelName: modelName,
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.openRouterAiApiKey,
          allowLegacyCredentialFallback
        ),
        configuration: {
          baseURL: customModel.baseUrl || "https://openrouter.ai/api/v1",
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
          defaultHeaders: {
            "HTTP-Referer": "https://obsidiancopilot.com",
            "X-Title": "Obsidian Copilot",
          },
        },
        enableReasoning: customModel.capabilities?.includes(ModelCapability.REASONING) ?? false,
        reasoningEffort:
          customModel.capabilities?.includes(ModelCapability.REASONING) &&
          customModel.reasoningEffort
            ? customModel.reasoningEffort
            : undefined,
        enablePromptCaching: customModel.enablePromptCaching ?? true,
      },
      [ChatModelProviders.GROQ]: {
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.groqApiKey,
          allowLegacyCredentialFallback
        ),
        model: modelName,
        baseUrl: groqHostBaseUrl(customModel.baseUrl),
      },
      [ChatModelProviders.OLLAMA]: {
        model: modelName,
        baseUrl: customModel.baseUrl || "http://localhost:11434",
        headers: {
          Authorization: `Bearer ${customModel.apiKey || "default-key"}`,
        },
        fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        think: customModel.capabilities?.includes(ModelCapability.REASONING) ?? false,
        repeatPenalty: 1.1,
        numCtx: customModel.numCtx ?? DEFAULT_OLLAMA_NUM_CTX,
      },
      [ChatModelProviders.LM_STUDIO]: {
        modelName: modelName,
        apiKey: customModel.apiKey || "default-key",
        streamUsage: customModel.streamUsage ?? false,
        configuration: {
          baseURL: customModel.baseUrl || "http://localhost:1234/v1",
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
        enableReasoning: customModel.capabilities?.includes(ModelCapability.REASONING) ?? false,
        reasoningEffort:
          customModel.capabilities?.includes(ModelCapability.REASONING) &&
          customModel.reasoningEffort
            ? customModel.reasoningEffort
            : undefined,
      },
      [ChatModelProviders.OPENAI_FORMAT]: {
        modelName: modelName,
        apiKey: openAIFormatIsKeyless
          ? "keyless-endpoint"
          : await this.resolveApiKey(
              customModel.apiKey,
              settings.openAIApiKey,
              allowLegacyCredentialFallback
            ),
        streamUsage: customModel.streamUsage ?? false,
        configuration: {
          baseURL: customModel.baseUrl,
          // LangChain drops null default headers, so strip the keyless placeholder after SDK auth and before either transport sends it.
          // https://github.com/logancyang/obsidian-copilot/issues/2946
          fetch: openAIFormatIsKeyless
            ? (url: string, options?: RequestInit) => {
                const headers = new Headers(options?.headers);
                headers.delete("authorization");
                return customModel.enableCors
                  ? safeFetchNoThrow(url, { ...options, headers })
                  : window.fetch(url, { ...options, headers });
              }
            : customModel.enableCors
              ? safeFetchNoThrow
              : undefined,
        },
        ...this.getOpenAISpecialConfig(modelName, maxTokens, customModel),
      },
      [ChatModelProviders.SILICONFLOW]: {
        modelName: modelName,
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.siliconflowApiKey,
          allowLegacyCredentialFallback
        ),
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.SILICONFLOW].host,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
        ...this.getOpenAISpecialConfig(modelName, maxTokens, customModel),
      },
      [ChatModelProviders.COPILOT_PLUS]: {
        modelName: modelName,
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.plusLicenseKey,
          allowLegacyCredentialFallback
        ),
        configuration: {
          baseURL: BREVILABS_MODELS_BASE_URL,
          fetch: safeFetchNoThrow,
          defaultHeaders: BrevilabsClient.getInstance().getPluginVersionHeaders(),
        },
        enableReasoning:
          (customModel.capabilities?.includes(ModelCapability.REASONING) ?? false) &&
          !!customModel.reasoningEffort,
        reasoningEffort:
          customModel.capabilities?.includes(ModelCapability.REASONING) &&
          customModel.reasoningEffort
            ? customModel.reasoningEffort
            : undefined,
      },
      [ChatModelProviders.MISTRAL]: {
        modelName,
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.mistralApiKey,
          allowLegacyCredentialFallback
        ),
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.MISTRAL].host,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
      },
      [ChatModelProviders.DEEPSEEK]: {
        modelName: modelName,
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.deepseekApiKey,
          allowLegacyCredentialFallback
        ),
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.DEEPSEEK].host,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
      },
    };

    const selectedProviderConfig =
      providerConfig[customModel.provider as keyof typeof providerConfig] || {};

    const finalConfig = {
      ...baseConfig,
      ...selectedProviderConfig,
      ...(maxTokens === undefined ? {} : { maxTokens }),
    };

    return finalConfig as ModelConfig;
  }

  private async resolveApiKey(
    modelApiKey: string | undefined,
    legacyApiKey: string,
    allowLegacyCredentialFallback: boolean
  ): Promise<string> {
    return modelApiKey || (allowLegacyCredentialFallback ? legacyApiKey : "");
  }

  private getOpenAISpecialConfig(
    modelName: string,
    maxTokens: number | undefined,
    customModel?: CustomModel
  ): Record<string, unknown> {
    const modelInfo = getModelInfo(modelName);

    const config: Record<string, unknown> = {
      ...(maxTokens === undefined ? {} : { maxTokens }),
    };

    if ((modelInfo.isOSeries || modelInfo.isGPT5) && customModel?.reasoningEffort) {
      config.reasoning = {
        effort: customModel.reasoningEffort,
      };

      if (modelInfo.isGPT5 && customModel?.verbosity) {
        const verbosityValue = customModel.verbosity;
        config.text = {
          verbosity: verbosityValue,
        };
      }
    }

    return config;
  }

  public buildModelMap() {
    const activeModels = getSettings().activeModels;
    ChatModelManager.modelMap = {};
    const modelMap = ChatModelManager.modelMap;

    const allModels = activeModels ?? BUILTIN_CHAT_MODELS;

    allModels.forEach((model) => {
      if (model.enabled) {
        if (!Object.values(ChatModelProviders).includes(model.provider as ChatModelProviders)) {
          logWarn(`Unknown provider: ${model.provider} for model: ${model.name}`);
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

  private hasProviderCredentials(
    model: CustomModel,
    allowLegacyCredentialFallback: boolean = true
  ): boolean {
    if (
      model.requiresApiKey === false &&
      (model.provider as ChatModelProviders) === ChatModelProviders.OPENAI_FORMAT
    ) {
      return true;
    }

    const getDefaultApiKey = this.providerApiKeyMap[model.provider as ChatModelProviders];
    if (!getDefaultApiKey) {
      return Boolean(model.apiKey);
    }

    return Boolean(model.apiKey || (allowLegacyCredentialFallback ? getDefaultApiKey() : ""));
  }

  getProviderConstructor(model: CustomModel): ChatConstructorType {
    const constructor: ChatConstructorType = CHAT_PROVIDER_CONSTRUCTORS[
      model.provider as ChatModelProviders
    ] as unknown as ChatConstructorType;
    if (!constructor) {
      logWarn(`Unknown provider: ${model.provider} for model: ${model.name}`);
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

  getActiveModel(): CustomModel | null {
    return ChatModelManager.activeModel;
  }

  async setChatModel(model: CustomModel): Promise<void> {
    try {
      const modelInstance = await this.createModelInstance(model);
      ChatModelManager.chatModel = modelInstance;
      ChatModelManager.activeModel = model;
      ChatModelManager.activeModelSource = "legacy";

      const modelInfo = getModelInfo(model.name);
      if (
        modelInfo.isGPT5 &&
        ((model.provider as ChatModelProviders) === ChatModelProviders.OPENAI ||
          (model.provider as ChatModelProviders) === ChatModelProviders.OPENAI_FORMAT)
      ) {
        logInfo(`Chat model set with Responses API for GPT-5: ${model.name}`);
      }
    } catch (error) {
      logError(error);
      throw error;
    }
  }

  async setChatModelFromBridged(model: CustomModel): Promise<void> {
    try {
      ChatModelManager.chatModel = await this.createModelInstanceFromBridged(model);
      ChatModelManager.activeModel = model;
      ChatModelManager.activeModelSource = "bridged";
    } catch (error) {
      logError(error);
      throw error;
    }
  }

  async createModelInstance(model: CustomModel): Promise<BaseChatModel> {
    const modelKey = getModelKeyFromModel(model);
    const selectedModel = ChatModelManager.modelMap[modelKey];
    if (!selectedModel) {
      throw new Error(`No model found for: ${modelKey}`);
    }
    if (!selectedModel.hasApiKey) {
      const errorMessage = `API key is not provided for the model: ${modelKey}.`;
      if ((model.provider as ChatModelProviders) === ChatModelProviders.COPILOT_PLUS) {
        throw new MissingPlusLicenseError(
          "Copilot Plus license key is not configured. Please enter your license key in the Copilot Plus section at the top of Basic Settings."
        );
      }
      throw new MissingApiKeyError(errorMessage);
    }

    return this.instantiateChatModel(
      model,
      selectedModel.vendor as ChatModelProviders,
      selectedModel.AIConstructor
    );
  }

  async createModelInstanceFromBridged(model: CustomModel): Promise<BaseChatModel> {
    if (!this.hasProviderCredentials(model, false)) {
      if ((model.provider as ChatModelProviders) === ChatModelProviders.COPILOT_PLUS) {
        throw new MissingPlusLicenseError(
          "Copilot Plus license key is not configured. Please enter your license key in the Copilot Plus section at the top of Basic Settings."
        );
      }
      throw new MissingApiKeyError(`API key is not provided for the model: ${model.name}.`);
    }

    return this.instantiateChatModel(
      model,
      model.provider as ChatModelProviders,
      this.getProviderConstructor(model),
      false
    );
  }

  private async instantiateChatModel(
    model: CustomModel,
    vendor: ChatModelProviders,
    AIConstructor: ChatConstructorType,
    allowLegacyCredentialFallback: boolean = true
  ): Promise<BaseChatModel> {
    const modelConfig = await this.getModelConfig(model, allowLegacyCredentialFallback);
    const modelInfo = getModelInfo(model.name);

    const constructorConfig: Record<string, unknown> = { ...modelConfig };
    if (
      modelInfo.isGPT5 &&
      (vendor === ChatModelProviders.OPENAI || vendor === ChatModelProviders.OPENAI_FORMAT)
    ) {
      constructorConfig.useResponsesApi = true;
      logInfo(`Enabling Responses API for GPT-5 model: ${model.name} (${vendor})`);
    }

    if (
      (model.provider as ChatModelProviders) === ChatModelProviders.LM_STUDIO &&
      model.useResponsesApi !== false
    ) {
      const lmStudioInstance = new ChatLMStudio(constructorConfig);
      logInfo(`[ChatModelManager] Using Responses API for LM Studio model: ${model.name}`);
      return lmStudioInstance;
    }

    return new AIConstructor(constructorConfig);
  }

  validateChatModel(chatModel: BaseChatModel): boolean {
    if (chatModel === undefined || chatModel === null) {
      return false;
    }
    return true;
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  async countTokens(inputStr: string): Promise<number> {
    return ChatModelManager.chatModel?.getNumTokens(inputStr) ?? this.estimateTokens(inputStr);
  }

  private validateCurrentModel(): void {
    if (!ChatModelManager.chatModel) return;

    const currentModelKey = getModelKey();
    if (!currentModelKey) return;

    const selectedModel = ChatModelManager.modelMap[currentModelKey];

    if (selectedModel && !selectedModel.hasApiKey) {
      ChatModelManager.chatModel = null;
      ChatModelManager.activeModel = null;
      ChatModelManager.activeModelSource = null;
      logInfo("Failed to reinitialize model due to missing API key");
    }
  }

  findModelByName(modelName: string): CustomModel | undefined {
    if (
      ChatModelManager.activeModelSource === "bridged" &&
      ChatModelManager.activeModel?.name === modelName
    ) {
      return ChatModelManager.activeModel;
    }
    const settings = getSettings();
    return settings.activeModels.find((model) => model.name === modelName);
  }
}
