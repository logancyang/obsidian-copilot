/* eslint-disable @typescript-eslint/no-explicit-any */
import { CustomModel } from "@/aiParams";
import { EmbeddingModelProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { CustomError } from "@/error";
import { safeFetch } from "@/utils";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { CohereEmbeddings } from "@langchain/cohere";
import { Embeddings } from "@langchain/core/embeddings";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";

type EmbeddingConstructorType = new (config: any) => Embeddings;

const EMBEDDING_PROVIDER_CONSTRUCTORS = {
  [EmbeddingModelProviders.OPENAI]: OpenAIEmbeddings,
  [EmbeddingModelProviders.COHEREAI]: CohereEmbeddings,
  [EmbeddingModelProviders.GOOGLE]: GoogleGenerativeAIEmbeddings,
  [EmbeddingModelProviders.AZURE_OPENAI]: OpenAIEmbeddings,
  [EmbeddingModelProviders.OLLAMA]: OllamaEmbeddings,
  [EmbeddingModelProviders.OPENAI_FORMAT]: OpenAIEmbeddings,
} as const;

type EmbeddingProviderConstructorMap = typeof EMBEDDING_PROVIDER_CONSTRUCTORS;

export default class EmbeddingManager {
  private activeEmbeddingModels: CustomModel[];
  private static instance: EmbeddingManager;
  private static embeddingModel: Embeddings;
  private static modelMap: Record<
    string,
    {
      hasApiKey: boolean;
      EmbeddingConstructor: EmbeddingConstructorType;
      vendor: string;
    }
  >;

  private readonly providerApiKeyMap: Record<EmbeddingModelProviders, () => string> = {
    [EmbeddingModelProviders.OPENAI]: () => getSettings().openAIApiKey,
    [EmbeddingModelProviders.COHEREAI]: () => getSettings().cohereApiKey,
    [EmbeddingModelProviders.GOOGLE]: () => getSettings().googleApiKey,
    [EmbeddingModelProviders.AZURE_OPENAI]: () => getSettings().azureOpenAIApiKey,
    [EmbeddingModelProviders.OLLAMA]: () => "default-key",
    [EmbeddingModelProviders.OPENAI_FORMAT]: () => "",
  };

  private constructor() {
    this.initialize();
    subscribeToSettingsChange(() => this.initialize());
  }

  private initialize() {
    const activeEmbeddingModels = getSettings().activeEmbeddingModels;
    this.activeEmbeddingModels = activeEmbeddingModels;
    this.buildModelMap(activeEmbeddingModels);
  }

  static getInstance(): EmbeddingManager {
    if (!EmbeddingManager.instance) {
      EmbeddingManager.instance = new EmbeddingManager();
    }
    return EmbeddingManager.instance;
  }

  getProviderConstructor(model: CustomModel): EmbeddingConstructorType {
    const constructor = EMBEDDING_PROVIDER_CONSTRUCTORS[model.provider as EmbeddingModelProviders];
    if (!constructor) {
      console.warn(`Unknown provider: ${model.provider} for model: ${model.name}`);
      throw new Error(`Unknown provider: ${model.provider} for model: ${model.name}`);
    }
    return constructor;
  }

  // Build a map of modelKey to model config
  private buildModelMap(activeEmbeddingModels: CustomModel[]) {
    EmbeddingManager.modelMap = {};
    const modelMap = EmbeddingManager.modelMap;

    activeEmbeddingModels.forEach((model) => {
      if (model.enabled) {
        if (
          !Object.values(EmbeddingModelProviders).contains(
            model.provider as EmbeddingModelProviders
          )
        ) {
          console.warn(`Unknown provider: ${model.provider} for embedding model: ${model.name}`);
          return;
        }
        const constructor = this.getProviderConstructor(model);
        const apiKey =
          model.apiKey || this.providerApiKeyMap[model.provider as EmbeddingModelProviders]();

        const modelKey = `${model.name}|${model.provider}`;
        modelMap[modelKey] = {
          hasApiKey: Boolean(apiKey),
          EmbeddingConstructor: constructor,
          vendor: model.provider,
        };
      }
    });
  }

  static getModelName(embeddingsInstance: Embeddings): string {
    const emb = embeddingsInstance as any;
    if ("model" in emb && emb.model) {
      return emb.model as string;
    } else if ("modelName" in emb && emb.modelName) {
      return emb.modelName as string;
    } else {
      throw new Error(
        `Embeddings instance missing model or modelName properties: ${embeddingsInstance}`
      );
    }
  }

  // Get the custom model that matches the name and provider from the model key
  private getCustomModel(modelKey: string): CustomModel {
    return this.activeEmbeddingModels.filter((model) => {
      const key = `${model.name}|${model.provider}`;
      return modelKey === key;
    })[0];
  }

  getEmbeddingsAPI(): Embeddings | undefined {
    const { embeddingModelKey } = getSettings();

    if (!EmbeddingManager.modelMap.hasOwnProperty(embeddingModelKey)) {
      throw new CustomError(`No embedding model found for: ${embeddingModelKey}`);
    }

    const selectedModel = EmbeddingManager.modelMap[embeddingModelKey];
    if (!selectedModel.hasApiKey) {
      throw new CustomError(
        `API key is not provided for the embedding model: ${embeddingModelKey}`
      );
    }

    const customModel = this.getCustomModel(embeddingModelKey);
    const config = this.getEmbeddingConfig(customModel);

    try {
      EmbeddingManager.embeddingModel = new selectedModel.EmbeddingConstructor(config);
      return EmbeddingManager.embeddingModel;
    } catch (error) {
      throw new CustomError(
        `Error creating embedding model: ${embeddingModelKey}. ${error.message}`
      );
    }
  }

  private getEmbeddingConfig(customModel: CustomModel): any {
    const settings = getSettings();
    const modelName = customModel.name;

    const baseConfig = {
      maxRetries: 3,
      maxConcurrency: 3,
    };

    const providerConfig: {
      [K in keyof EmbeddingProviderConstructorMap]: ConstructorParameters<
        EmbeddingProviderConstructorMap[K]
      >[0] /*& Record<string, unknown>;*/;
    } = {
      [EmbeddingModelProviders.OPENAI]: {
        modelName,
        openAIApiKey: getDecryptedKey(customModel.apiKey || settings.openAIApiKey),
        timeout: 10000,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [EmbeddingModelProviders.COHEREAI]: {
        model: modelName,
        apiKey: getDecryptedKey(customModel.apiKey || settings.cohereApiKey),
      },
      [EmbeddingModelProviders.GOOGLE]: {
        modelName: modelName,
        apiKey: getDecryptedKey(settings.googleApiKey),
      },
      [EmbeddingModelProviders.AZURE_OPENAI]: {
        azureOpenAIApiKey: getDecryptedKey(customModel.apiKey || settings.azureOpenAIApiKey),
        azureOpenAIApiInstanceName: settings.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName: settings.azureOpenAIApiEmbeddingDeploymentName,
        azureOpenAIApiVersion: settings.azureOpenAIApiVersion,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [EmbeddingModelProviders.OLLAMA]: {
        baseUrl: customModel.baseUrl || "http://localhost:11434",
        model: modelName,
        truncate: true,
      },
      [EmbeddingModelProviders.OPENAI_FORMAT]: {
        modelName,
        openAIApiKey: getDecryptedKey(customModel.apiKey || ""),
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
          dangerouslyAllowBrowser: true,
        },
      },
    };

    const selectedProviderConfig =
      providerConfig[customModel.provider as EmbeddingModelProviders] || {};

    return { ...baseConfig, ...selectedProviderConfig };
  }
}
