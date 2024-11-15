/* eslint-disable @typescript-eslint/no-explicit-any */
import { CustomModel, LangChainParams } from "@/aiParams";
import { EmbeddingModelProviders } from "@/constants";
import EncryptionService from "@/encryptionService";
import { CustomError } from "@/error";
import { CohereEmbeddings } from "@langchain/cohere";
import { Embeddings } from "@langchain/core/embeddings";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";
import { safeFetch } from "@/utils";

type EmbeddingConstructorType = new (config: any) => Embeddings;

type EmbeddingProviderConstructorMap = {
  [K in EmbeddingModelProviders]: K extends EmbeddingModelProviders.OPENAI
    ? typeof OpenAIEmbeddings
    : K extends EmbeddingModelProviders.COHEREAI
      ? typeof CohereEmbeddings
      : K extends EmbeddingModelProviders.GOOGLE
        ? typeof GoogleGenerativeAIEmbeddings
        : K extends EmbeddingModelProviders.AZURE_OPENAI
          ? typeof OpenAIEmbeddings
          : K extends EmbeddingModelProviders.OLLAMA
            ? typeof OllamaEmbeddings
            : K extends EmbeddingModelProviders.OPENAI_FORMAT
              ? typeof OpenAIEmbeddings
              : never;
};

export default class EmbeddingManager {
  private encryptionService: EncryptionService;
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

  private readonly embeddingModelProvider2Construct: EmbeddingProviderConstructorMap = {
    [EmbeddingModelProviders.OPENAI]: OpenAIEmbeddings,
    [EmbeddingModelProviders.COHEREAI]: CohereEmbeddings,
    [EmbeddingModelProviders.GOOGLE]: GoogleGenerativeAIEmbeddings,
    [EmbeddingModelProviders.AZURE_OPENAI]: OpenAIEmbeddings,
    [EmbeddingModelProviders.OLLAMA]: OllamaEmbeddings,
    [EmbeddingModelProviders.OPENAI_FORMAT]: OpenAIEmbeddings,
  };

  private readonly providerAipKeyMap: Record<EmbeddingModelProviders, () => string> = {
    [EmbeddingModelProviders.OPENAI]: () => this.getLangChainParams().openAIApiKey,
    [EmbeddingModelProviders.COHEREAI]: () => this.getLangChainParams().cohereApiKey,
    [EmbeddingModelProviders.GOOGLE]: () => this.getLangChainParams().googleApiKey,
    [EmbeddingModelProviders.AZURE_OPENAI]: () => this.getLangChainParams().azureOpenAIApiKey,
    [EmbeddingModelProviders.OLLAMA]: () => "default-key",
    [EmbeddingModelProviders.OPENAI_FORMAT]: () => "",
  };

  private constructor(
    private getLangChainParams: () => LangChainParams,
    encryptionService: EncryptionService,
    activeEmbeddingModels: CustomModel[]
  ) {
    this.encryptionService = encryptionService;
    this.activeEmbeddingModels = activeEmbeddingModels;
    this.buildModelMap(activeEmbeddingModels);
  }

  static getInstance(
    getLangChainParams: () => LangChainParams,
    encryptionService: EncryptionService,
    activeEmbeddingModels: CustomModel[]
  ): EmbeddingManager {
    if (!EmbeddingManager.instance) {
      EmbeddingManager.instance = new EmbeddingManager(
        getLangChainParams,
        encryptionService,
        activeEmbeddingModels
      );
    }
    return EmbeddingManager.instance;
  }

  getProviderConstructor(model: CustomModel): EmbeddingConstructorType {
    const constructor =
      this.embeddingModelProvider2Construct[model.provider as EmbeddingModelProviders];
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
          model.apiKey || this.providerAipKeyMap[model.provider as EmbeddingModelProviders]();

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
    const { embeddingModelKey } = this.getLangChainParams();

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

  private getEmbeddingConfig(customModel: CustomModel) {
    const decrypt = (key: string) => this.encryptionService.getDecryptedKey(key);
    const params = this.getLangChainParams();
    const modelName = customModel.name;

    const baseConfig = {
      maxRetries: 3,
      maxConcurrency: 3,
    };

    type ProviderConstructMap = typeof EmbeddingManager.prototype.embeddingModelProvider2Construct;

    const providerConfig: {
      [K in keyof ProviderConstructMap]: ConstructorParameters<
        ProviderConstructMap[K]
      >[0] /*& Record<string, unknown>;*/;
    } = {
      [EmbeddingModelProviders.OPENAI]: {
        modelName,
        openAIApiKey: decrypt(customModel.apiKey || params.openAIApiKey),
        timeout: 10000,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [EmbeddingModelProviders.COHEREAI]: {
        model: modelName,
        apiKey: decrypt(customModel.apiKey || params.cohereApiKey),
      },
      [EmbeddingModelProviders.GOOGLE]: {
        modelName: modelName,
        apiKey: decrypt(params.googleApiKey),
      },
      [EmbeddingModelProviders.AZURE_OPENAI]: {
        azureOpenAIApiKey: decrypt(customModel.apiKey || params.azureOpenAIApiKey),
        azureOpenAIApiInstanceName: params.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName: params.azureOpenAIApiEmbeddingDeploymentName,
        azureOpenAIApiVersion: params.azureOpenAIApiVersion,
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
        openAIApiKey: decrypt(customModel.apiKey || ""),
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

  async ping(model: CustomModel): Promise<"PONG"> {
    model.enableCors = true; // enable CORS for verification
    const config = this.getEmbeddingConfig(model);
    const aIConstructor = this.getProviderConstructor(model);

    const modelInstance = new aIConstructor({ ...config });

    return modelInstance.embedQuery("PING").then((res) => {
      return "PONG";
    });
  }
}
