/* eslint-disable @typescript-eslint/no-explicit-any */
import { CustomModel, LangChainParams } from "@/aiParams";
import { EmbeddingModelProviders } from "@/constants";
import EncryptionService from "@/encryptionService";
import { ProxyOpenAIEmbeddings } from "@/langchainWrappers";
import { CohereEmbeddings } from "@langchain/cohere";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Embeddings } from "langchain/embeddings/base";
import { OllamaEmbeddings } from "langchain/embeddings/ollama";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
export default class EmbeddingManager {
  private encryptionService: EncryptionService;
  private activeEmbeddingModels: CustomModel[];
  private static instance: EmbeddingManager;
  private static embeddingModel: Embeddings;
  private static modelMap: Record<
    string,
    {
      hasApiKey: boolean;
      EmbeddingConstructor: new (config: any) => Embeddings;
      vendor: string;
    }
  >;

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

  // Build a map of modelKey to model config
  private buildModelMap(activeEmbeddingModels: CustomModel[]) {
    EmbeddingManager.modelMap = {};
    const modelMap = EmbeddingManager.modelMap;
    const params = this.getLangChainParams();

    activeEmbeddingModels.forEach((model) => {
      if (model.enabled) {
        let constructor;
        let apiKey;

        switch (model.provider) {
          case EmbeddingModelProviders.OPENAI:
            constructor = OpenAIEmbeddings;
            apiKey = params.openAIApiKey;
            break;
          case EmbeddingModelProviders.COHEREAI:
            constructor = CohereEmbeddings;
            apiKey = params.cohereApiKey;
            break;
          case EmbeddingModelProviders.GOOGLE:
            constructor = GoogleGenerativeAIEmbeddings;
            apiKey = params.googleApiKey;
            break;
          case EmbeddingModelProviders.AZURE_OPENAI:
            constructor = OpenAIEmbeddings;
            apiKey = params.azureOpenAIApiKey;
            break;
          case EmbeddingModelProviders.OLLAMA:
            constructor = OllamaEmbeddings;
            apiKey = "default-key";
            break;
          case EmbeddingModelProviders.OPENAI_FORMAT:
            constructor = ProxyOpenAIEmbeddings;
            apiKey = model.apiKey;
            break;
          default:
            console.warn(`Unknown provider: ${model.provider} for embedding model: ${model.name}`);
            return;
        }
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
      console.error(`No embedding model found for: ${embeddingModelKey}`);
      return;
    }

    const selectedModel = EmbeddingManager.modelMap[embeddingModelKey];
    if (!selectedModel.hasApiKey) {
      console.error(`API key is not provided for the embedding model: ${embeddingModelKey}`);
      return;
    }

    const customModel = this.getCustomModel(embeddingModelKey);
    const config = this.getEmbeddingConfig(customModel);

    try {
      EmbeddingManager.embeddingModel = new selectedModel.EmbeddingConstructor(config);
      return EmbeddingManager.embeddingModel;
    } catch (error) {
      console.error(`Error creating embedding model: ${embeddingModelKey}`, error);
    }
  }

  private getEmbeddingConfig(customModel: CustomModel): any {
    const decrypt = (key: string) => this.encryptionService.getDecryptedKey(key);
    const params = this.getLangChainParams();
    const modelName = customModel.name;

    const baseConfig = {
      maxRetries: 3,
      maxConcurrency: 3,
    };

    const providerConfigs = {
      [EmbeddingModelProviders.OPENAI]: {
        modelName,
        openAIApiKey: decrypt(params.openAIApiKey),
        timeout: 10000,
      },
      [EmbeddingModelProviders.COHEREAI]: {
        model: modelName,
        apiKey: decrypt(params.cohereApiKey),
      },
      [EmbeddingModelProviders.GOOGLE]: {
        modelName: modelName,
        apiKey: decrypt(params.googleApiKey),
      },
      [EmbeddingModelProviders.AZURE_OPENAI]: {
        azureOpenAIApiKey: decrypt(params.azureOpenAIApiKey),
        azureOpenAIApiInstanceName: params.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName: params.azureOpenAIApiEmbeddingDeploymentName,
        azureOpenAIApiVersion: params.azureOpenAIApiVersion,
      },
      [EmbeddingModelProviders.OLLAMA]: {
        baseUrl: customModel.baseUrl || "http://localhost:11434",
        model: modelName,
      },
      [EmbeddingModelProviders.OPENAI_FORMAT]: {
        modelName,
        openAIApiKey: decrypt(customModel.apiKey || ""),
        openAIEmbeddingProxyBaseUrl: customModel.baseUrl,
      },
    };

    const modelKey = `${modelName}|${customModel.provider}`;
    const selectedModel = EmbeddingManager.modelMap[modelKey];
    if (!selectedModel) {
      console.error(`No embedding model found for key: ${modelKey}`);
    }
    const providerConfig =
      providerConfigs[selectedModel.vendor as keyof typeof providerConfigs] || {};

    return { ...baseConfig, ...providerConfig };
  }
}
