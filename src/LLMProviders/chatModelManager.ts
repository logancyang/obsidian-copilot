import { CustomModel, ModelConfig } from "@/aiParams";
import {
  BREVILABS_MODELS_BASE_URL,
  ChatModelProviders,
  DEFAULT_OLLAMA_NUM_CTX,
  ModelCapability,
  ProviderInfo,
} from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { safeFetchNoThrow } from "@/utils";
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

  private constructor() {}

  static getInstance(): ChatModelManager {
    if (!ChatModelManager.instance) {
      ChatModelManager.instance = new ChatModelManager();
    }
    return ChatModelManager.instance;
  }

  private async getModelConfig(customModel: CustomModel): Promise<ModelConfig> {
    const settings = getSettings();

    const modelName = customModel.name;
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
        apiKey: customModel.apiKey || "",
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
          organization: customModel.openAIOrgId || settings.openAIOrgId,
        },
        // Chat Completions rejects tools alongside a reasoning effort, so Copilot Plus failed on GPT-6; the Responses API accepts tools at the model's default effort.
        // https://github.com/logancyang/obsidian-copilot/issues/3835
        useResponsesApi: true,
      },
      [ChatModelProviders.ANTHROPIC]: {
        anthropicApiKey: customModel.apiKey || "",
        model: modelName,
        anthropicApiUrl: customModel.baseUrl,
        clientOptions: {
          defaultHeaders: {
            "anthropic-dangerous-direct-browser-access": "true",
          },
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
      },
      [ChatModelProviders.COHEREAI]: {
        modelName,
        apiKey: customModel.apiKey || "",
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.COHEREAI].host,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
      },
      [ChatModelProviders.GOOGLE]: {
        apiKey: customModel.apiKey || "",
        model: modelName,
        safetySettings: GOOGLE_SAFETY_SETTINGS_BLOCK_NONE,
        baseUrl: googleHostBaseUrl(customModel.baseUrl),
      },
      [ChatModelProviders.XAI]: {
        apiKey: customModel.apiKey || "",
        model: modelName,
      },
      [ChatModelProviders.OPENROUTERAI]: {
        modelName: modelName,
        apiKey: customModel.apiKey || "",
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
        apiKey: customModel.apiKey || "",
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
        apiKey: openAIFormatIsKeyless ? "keyless-endpoint" : customModel.apiKey || "",
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
      },
      [ChatModelProviders.SILICONFLOW]: {
        modelName: modelName,
        apiKey: customModel.apiKey || "",
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.SILICONFLOW].host,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
      },
      [ChatModelProviders.COPILOT_PLUS]: {
        modelName: modelName,
        apiKey: customModel.apiKey || "",
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
        apiKey: customModel.apiKey || "",
        configuration: {
          baseURL: customModel.baseUrl || ProviderInfo[ChatModelProviders.MISTRAL].host,
          fetch: customModel.enableCors ? safeFetchNoThrow : undefined,
        },
      },
      [ChatModelProviders.DEEPSEEK]: {
        modelName: modelName,
        apiKey: customModel.apiKey || "",
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

  private hasProviderCredentials(model: CustomModel): boolean {
    return (
      Boolean(model.apiKey) ||
      (model.requiresApiKey === false &&
        (model.provider as ChatModelProviders) === ChatModelProviders.OPENAI_FORMAT)
    );
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

  async setChatModelFromBridged(model: CustomModel): Promise<void> {
    try {
      ChatModelManager.chatModel = await this.createModelInstanceFromBridged(model);
      ChatModelManager.activeModel = model;
    } catch (error) {
      logError(error);
      throw error;
    }
  }

  async createModelInstanceFromBridged(model: CustomModel): Promise<BaseChatModel> {
    if (!this.hasProviderCredentials(model)) {
      if ((model.provider as ChatModelProviders) === ChatModelProviders.COPILOT_PLUS) {
        throw new MissingPlusLicenseError(
          "Copilot Plus license key is not configured. Please enter your license key in the Copilot Plus section at the top of Basic Settings."
        );
      }
      throw new MissingApiKeyError(`API key is not provided for the model: ${model.name}.`);
    }

    return this.instantiateChatModel(model, this.getProviderConstructor(model));
  }

  private async instantiateChatModel(
    model: CustomModel,
    AIConstructor: ChatConstructorType
  ): Promise<BaseChatModel> {
    const constructorConfig: Record<string, unknown> = { ...(await this.getModelConfig(model)) };

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

  findModelByName(modelName: string): CustomModel | undefined {
    const activeModel = ChatModelManager.activeModel;
    return activeModel?.name === modelName ? activeModel : undefined;
  }
}
