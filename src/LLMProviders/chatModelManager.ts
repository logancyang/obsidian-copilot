import { CustomModel, isO1PreviewModel, getModelKey, ModelConfig, setModelKey } from "@/aiParams";
import { BUILTIN_CHAT_MODELS, ChatModelProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { getModelKeyFromModel, getSettings, subscribeToSettingsChange } from "@/settings/model";
import { err2String, safeFetch } from "@/utils";
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
} as const;

export default class ChatModelManager {
  private static instance: ChatModelManager;
  private chatModel: BaseChatModel | null = null;
  private modelMap: Record<
    string,
    {
      hasApiKey: boolean;
      AIConstructor: ChatConstructorType;
      vendor: string;
    }
  > = {};

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
    const isO1Model = isO1PreviewModel(customModel.modelName);

    if (isO1Model) {
      await this.validateO1PreviewModel(customModel);
    }

    const baseConfig: ModelConfig = {
      modelName: customModel.modelName,
      temperature: isO1Model
        ? settings.temperature // Use settings.temperature for o1-preview models
        : (customModel.temperature ?? settings.temperature),
      streaming: isO1Model ? false : (customModel.stream ?? true),
      maxRetries: 3,
      maxConcurrency: 3,
      isO1Preview: isO1Model,
      ...(isO1Model
        ? {
            maxCompletionTokens: settings.maxTokens,
            azureOpenAIApiVersion:
              customModel.azureOpenAIApiVersion || settings.azureOpenAIApiVersion,
          }
        : {
            maxTokens: settings.maxTokens,
          }),
    };

    const providerConfig: {
      [K in ChatModelProviders]?: any;
    } = {
      [ChatModelProviders.OPENAI]: {
        modelName: customModel.modelName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.openAIApiKey),
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        openAIOrgId: await getDecryptedKey(customModel.openAIOrgId || settings.openAIOrgId),
        streaming: customModel.stream ?? true,
      },
      [ChatModelProviders.AZURE_OPENAI]: {
        azureOpenAIApiKey: await getDecryptedKey(customModel.apiKey || settings.azureOpenAIApiKey),
        azureOpenAIApiInstanceName:
          customModel.azureOpenAIApiInstanceName || settings.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName:
          customModel.azureOpenAIApiDeploymentName || settings.azureOpenAIApiDeploymentName,
        azureOpenAIApiVersion: customModel.azureOpenAIApiVersion || settings.azureOpenAIApiVersion,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        streaming: isO1Model ? false : (customModel.stream ?? true),
      },
      [ChatModelProviders.ANTHROPIC]: {
        anthropicApiKey: await getDecryptedKey(customModel.apiKey || settings.anthropicApiKey),
        modelName: customModel.modelName,
        anthropicApiUrl: customModel.baseUrl,
        clientOptions: {
          defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        streaming: customModel.stream ?? true,
      },
      [ChatModelProviders.COHEREAI]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.cohereApiKey),
        model: customModel.modelName,
        streaming: customModel.stream ?? true,
      },
      [ChatModelProviders.GOOGLE]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.googleApiKey),
        modelName: customModel.modelName,
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
        streaming: customModel.stream ?? true,
      },
      [ChatModelProviders.OPENROUTERAI]: {
        modelName: customModel.modelName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.openRouterAiApiKey),
        configuration: {
          baseURL: customModel.baseUrl || "https://openrouter.ai/api/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        streaming: customModel.stream ?? true,
      },
      [ChatModelProviders.GROQ]: {
        apiKey: await getDecryptedKey(customModel.apiKey || settings.groqApiKey),
        modelName: customModel.modelName,
        streaming: customModel.stream ?? true,
      },
      [ChatModelProviders.OLLAMA]: {
        model: customModel.modelName,
        apiKey: customModel.apiKey || "default-key",
        baseUrl: customModel.baseUrl || "http://localhost:11434",
        streaming: customModel.stream ?? true,
      },
      [ChatModelProviders.LM_STUDIO]: {
        modelName: customModel.modelName,
        openAIApiKey: customModel.apiKey || "default-key",
        configuration: {
          baseURL: customModel.baseUrl || "http://localhost:1234/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
        streaming: customModel.stream ?? true,
      },
      [ChatModelProviders.OPENAI_FORMAT]: {
        modelName: customModel.modelName,
        openAIApiKey: await getDecryptedKey(customModel.apiKey || settings.openAIApiKey),
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
          dangerouslyAllowBrowser: true,
        },
        streaming: customModel.stream ?? true,
      },
    };

    const selectedProviderConfig = providerConfig[customModel.provider as ChatModelProviders] || {};
    return { ...baseConfig, ...selectedProviderConfig };
  }

  private buildModelMap() {
    const activeModels = getSettings().activeModels;
    this.modelMap = {};
    const modelMap = this.modelMap;

    const allModels = activeModels ?? BUILTIN_CHAT_MODELS;

    allModels.forEach((model) => {
      if (model.enabled) {
        if (!Object.values(ChatModelProviders).includes(model.provider as ChatModelProviders)) {
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
    if (!this.chatModel) {
      throw new Error("No valid chat model available. Please check your API key settings.");
    }
    return this.chatModel;
  }

  async setChatModel(model: CustomModel): Promise<void> {
    const modelKey = getModelKeyFromModel(model);
    if (!this.modelMap.hasOwnProperty(modelKey)) {
      throw new Error(`No model found for: ${modelKey}`);
    }

    // Create and return the appropriate model
    const selectedModel = this.modelMap[modelKey];
    if (!selectedModel.hasApiKey) {
      const errorMessage = `API key is not provided for the model: ${modelKey}. Model switch failed.`;
      new Notice(errorMessage);
      // Stop execution and deliberately fail the model switch
      throw new Error(errorMessage);
    }

    const modelConfig = await this.getModelConfig(model);

    setModelKey(modelKey);
    try {
      const newModelInstance = new selectedModel.AIConstructor({
        ...modelConfig,
      });
      // Set the new model
      this.chatModel = newModelInstance;
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
    return this.chatModel?.getNumTokens(inputStr) ?? 0;
  }

  private validateCurrentModel(): void {
    if (!this.chatModel) return;

    const currentModelKey = getModelKey();
    if (!currentModelKey) return;

    // Get the model configuration
    const selectedModel = this.modelMap[currentModelKey];

    // If API key is missing or model doesn't exist in map
    if (!selectedModel?.hasApiKey) {
      // Clear the current chat model
      this.chatModel = null;
      console.log("Failed to reinitialize model due to missing API key");
    }
  }

  async validateO1PreviewModel(customModel: CustomModel): Promise<void> {
    if (!isO1PreviewModel(customModel.modelName)) return;

    const settings = getSettings();
    const apiKey = customModel.apiKey || settings.azureOpenAIApiKey;
    const instanceName =
      customModel.azureOpenAIApiInstanceName || settings.azureOpenAIApiInstanceName;
    const deploymentName =
      customModel.azureOpenAIApiDeploymentName || settings.azureOpenAIApiDeploymentName;

    if (!apiKey || !instanceName || !deploymentName) {
      throw new Error(
        "O1 preview model requires Azure OpenAI API key, instance name, and deployment name. Please check your settings."
      );
    }

    // Validate model ID format
    if (
      customModel.modelName !== "azureml://registries/azure-openai/models/o1-preview/versions/1"
    ) {
      throw new Error("Invalid O1 Preview model ID format");
    }
  }

  async ping(model: CustomModel): Promise<boolean> {
    const tryPing = async (enableCors: boolean) => {
      const modelToTest = { ...model, enableCors };
      const isO1Preview = isO1PreviewModel(modelToTest.modelName);

      // Force O1 preview settings if needed
      if (isO1Preview) {
        await this.validateO1PreviewModel(modelToTest);
        modelToTest.temperature = getSettings().temperature;
        modelToTest.stream = false;
        modelToTest.azureOpenAIApiVersion = getSettings().azureOpenAIApiVersion;
      }

      const modelConfig = await this.getModelConfig(modelToTest);

      // Remove unnecessary config for ping test
      const pingConfig = { ...modelConfig };

      // Set appropriate token limit based on model type
      if (isO1Preview) {
        pingConfig.maxCompletionTokens = 10;
        delete pingConfig.maxTokens;
      } else {
        pingConfig.maxTokens = 10;
        delete pingConfig.maxCompletionTokens;
      }

      const testModel = new (this.getProviderConstructor(modelToTest))(pingConfig);
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
