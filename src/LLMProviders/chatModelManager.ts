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

// Patch BaseLanguageModel.prototype.getNumTokens once at module load to prevent
// tiktoken CDN fetches. LangChain's default getNumTokens() downloads a ~3MB BPE
// vocabulary from tiktoken.pages.dev, which blocks all LLM calls when the CDN is
// unreachable. This char/4 estimation is the same fallback LangChain uses internally
// before tiktoken loads. Actual token usage comes from API response metadata.

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
    // Copilot sets no output limit. This stays undefined unless the model
    // carries one of its own, and an undefined limit is left out of the
    // request, so the provider writes whatever the context window allows.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/312
    const maxTokens = customModel.maxTokens;
    const openAIFormatIsKeyless = customModel.requiresApiKey === false;

    // No temperature is sent. Copilot exposes no way to choose one, and providers
    // disagree on which values a model accepts: the Moonshot Kimi line rejects
    // anything but 1, OpenAI's reasoning models reject anything but 1, and
    // Anthropic's thinking models reject the parameter outright. Omitting it lets
    // each provider apply its own default instead of Copilot guessing per family.
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
          // Required to bypass CORS restrictions
          defaultHeaders: {
            "anthropic-dangerous-direct-browser-access": "true",
          },
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
        ...(isThinkingEnabled && {
          // Opus 4.7+ defaults thinking.display to "omitted" so thinking summaries
          // never reach the UI; force "summarized" for the adaptive branch. Pre-4.7
          // models default to "summarized" server-side and don't need this.
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
        // ChatGoogleGenerativeAI appends `/v1beta` itself; a stored versioned
        // base URL would double the segment (`/v1beta/v1beta/…` → 404).
        baseUrl: googleHostBaseUrl(customModel.baseUrl),
      },
      [ChatModelProviders.XAI]: {
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.xaiApiKey,
          allowLegacyCredentialFallback
        ),
        model: modelName,
        // This langchainjs XAI client does not support baseURL override
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
        // Enable reasoning if the model has the reasoning capability
        enableReasoning: customModel.capabilities?.includes(ModelCapability.REASONING) ?? false,
        // Pass reasoning effort if configured and reasoning capability is enabled
        reasoningEffort:
          customModel.capabilities?.includes(ModelCapability.REASONING) &&
          customModel.reasoningEffort
            ? customModel.reasoningEffort
            : undefined,
        // Enable prompt caching by default; can be turned off for ZDR endpoints
        enablePromptCaching: customModel.enablePromptCaching ?? true,
      },
      [ChatModelProviders.GROQ]: {
        apiKey: await this.resolveApiKey(
          customModel.apiKey,
          settings.groqApiKey,
          allowLegacyCredentialFallback
        ),
        model: modelName,
        // groq-sdk appends `/openai/v1` itself; the stored URL is usually the
        // versioned models.dev form, which would double the segment.
        baseUrl: groqHostBaseUrl(customModel.baseUrl),
      },
      [ChatModelProviders.OLLAMA]: {
        // ChatOllama has `model` instead of `modelName`!!
        model: modelName,
        // MUST NOT use /v1 in the baseUrl for ollama
        baseUrl: customModel.baseUrl || "http://localhost:11434",
        headers: {
          Authorization: `Bearer ${customModel.apiKey || "default-key"}`,
        },
        // Route through Obsidian's requestUrl (safeFetchNoThrow) to bypass CORS / mixed-content
        // restrictions — required on mobile (WKWebView) when calling http:// Ollama hosts.
        fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        // Enable thinking for models with REASONING capability (e.g., qwen3, deepseek-r1)
        // Thinking content goes to additional_kwargs.reasoning_content
        think: customModel.capabilities?.includes(ModelCapability.REASONING) ?? false,
        // Reduce repetition in local models (1.1 = slight penalty, helps with hallucination loops)
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
        // Enable reasoning extraction for models with REASONING capability
        enableReasoning: customModel.capabilities?.includes(ModelCapability.REASONING) ?? false,
        // Pass reasoning effort if configured and reasoning capability is enabled
        reasoningEffort:
          customModel.capabilities?.includes(ModelCapability.REASONING) &&
          customModel.reasoningEffort
            ? customModel.reasoningEffort
            : undefined,
      },
      [ChatModelProviders.OPENAI_FORMAT]: {
        modelName: modelName,
        apiKey: openAIFormatIsKeyless
          ? undefined
          : await this.resolveApiKey(
              customModel.apiKey,
              settings.openAIApiKey,
              allowLegacyCredentialFallback
            ),
        streamUsage: customModel.streamUsage ?? false,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
          // The OpenAI SDK accepts an explicit null to omit its default auth
          // header while still constructing a client for a keyless endpoint.
          // https://github.com/logancyang/obsidian-copilot/issues/2895
          defaultHeaders: openAIFormatIsKeyless ? { Authorization: null } : undefined,
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
        // Reasoning is opt-in: forward the user's per-model effort pick only for
        // REASONING-capable models, and gate enableReasoning on an EXPLICIT effort.
        // Without an effort, ChatOpenRouter.invocationParams falls back to
        // `reasoning: { max_tokens: 1024 }`, which would make the default-on
        // copilot-plus-flash spend reasoning budget/latency despite being the fast
        // default. So flash stays fast until the user picks an effort.
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

  /**
   * Adds special configuration for OpenAI models that support reasoning
   * LangChain 0.6.6+ handles most of the token logic internally
   *
   * NOTE: GPT-5 models require Responses API for verbosity parameter to work.
   * The useResponsesApi flag is set automatically in createModelInstance() for GPT-5.
   */
  private getOpenAISpecialConfig(
    modelName: string,
    maxTokens: number | undefined,
    customModel?: CustomModel
  ): Record<string, unknown> {
    const modelInfo = getModelInfo(modelName);

    const config: Record<string, unknown> = {
      ...(maxTokens === undefined ? {} : { maxTokens }),
    };

    // Add reasoning parameters for O-series and GPT-5 models
    // LangChain 0.6.6 will handle the endpoint routing and parameter conversion
    if ((modelInfo.isOSeries || modelInfo.isGPT5) && customModel?.reasoningEffort) {
      config.reasoning = {
        effort: customModel.reasoningEffort,
      };

      // Add verbosity for GPT-5 models (Responses API only).
      // useResponsesApi is only enabled for OPENAI / OPENAI_FORMAT in createModelInstance().
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

  // Build a map of modelKey to model config
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

  /**
   * Checks if a model has the necessary credentials configured for its provider.
   * @param model - The custom model definition.
   * @returns True when the provider requirements are satisfied, otherwise false.
   */
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

      // Log if Responses API is enabled for GPT-5
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

  /**
   * Set the active chat model from a chat-backend `CustomModel` produced by the
   * bridge. Counterpart to `setChatModel` that goes through
   * `createModelInstanceFromBridged` (no `activeModels` modelMap gate).
   */
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
    // Create and return the appropriate model
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

  /**
   * Build a chat model from a `CustomModel` produced by the model-management
   * "chat" backend bridge (`configuredModelToCustomModel`). Unlike
   * `createModelInstance`, this does NOT consult `modelMap` — that map is built
   * from the legacy `settings.activeModels`, whereas chat-backend models live
   * in the `Provider` / `ConfiguredModel` registries, so the `activeModels`
   * gate would reject every bridged model. The bridge already resolved the
   * provider + key, so credentials are validated directly off the model here.
   */
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

  /**
   * Shared construction path for both `createModelInstance` (legacy
   * activeModels) and `createModelInstanceFromBridged` (chat backend). Builds
   * the provider config, applies the GPT-5 / GitHub-Copilot Responses-API and
   * LM Studio special cases, and constructs the LangChain client.
   */
  private async instantiateChatModel(
    model: CustomModel,
    vendor: ChatModelProviders,
    AIConstructor: ChatConstructorType,
    allowLegacyCredentialFallback: boolean = true
  ): Promise<BaseChatModel> {
    const modelConfig = await this.getModelConfig(model, allowLegacyCredentialFallback);
    const modelInfo = getModelInfo(model.name);

    // For GPT-5 models, automatically use Responses API for proper verbosity support
    const constructorConfig: Record<string, unknown> = { ...modelConfig };
    if (
      modelInfo.isGPT5 &&
      (vendor === ChatModelProviders.OPENAI || vendor === ChatModelProviders.OPENAI_FORMAT)
    ) {
      constructorConfig.useResponsesApi = true;
      logInfo(`Enabling Responses API for GPT-5 model: ${model.name} (${vendor})`);
    }

    // For LM Studio, use ChatLMStudio by default for Responses API compatibility.
    // Opt out by setting useResponsesApi to false.
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

  // Custom token estimation function for fallback when model is unknown
  private estimateTokens(text: string): number {
    if (!text) return 0;
    // This is a simple approximation: ~4 chars per token for English text
    // More accurate than using word count, but still a decent estimation
    return Math.ceil(text.length / 4);
  }

  async countTokens(inputStr: string): Promise<number> {
    return ChatModelManager.chatModel?.getNumTokens(inputStr) ?? this.estimateTokens(inputStr);
  }

  private validateCurrentModel(): void {
    if (!ChatModelManager.chatModel) return;

    const currentModelKey = getModelKey();
    if (!currentModelKey) return;

    // Get the model configuration
    const selectedModel = ChatModelManager.modelMap[currentModelKey];

    // Only invalidate keys the legacy modelMap actually knows about. A chat-
    // backend selection is a `configuredModelId` that never appears in the
    // activeModels-derived map; its validity is owned by chainManager's
    // resolver, so an absent entry here must NOT clear the bridged model.
    if (selectedModel && !selectedModel.hasApiKey) {
      // Clear the current chat model
      ChatModelManager.chatModel = null;
      ChatModelManager.activeModel = null;
      ChatModelManager.activeModelSource = null;
      logInfo("Failed to reinitialize model due to missing API key");
    }
  }

  findModelByName(modelName: string): CustomModel | undefined {
    // Prefer the active bridged model on an exact name match, BEFORE the legacy
    // lookup. Chat-backend (bridged) models live in the Provider/ConfiguredModel
    // registries and carry the full capability set derived from their
    // modalities/reasoning (`configuredModelToCustomModel`). A model whose wire id
    // ALSO exists in legacy `settings.activeModels` — notably `copilot-plus-flash`,
    // whose built-in entry advertises only VISION — would otherwise mask the
    // bridged REASONING/VISION capabilities, so a capability check
    // (CopilotPlusChainRunner.hasCapability / isMultimodalModel) reads `false` and
    // reasoning/image content is dropped. The bridged model is the one actually
    // running, so it wins.
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
