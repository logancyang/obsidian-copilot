/* eslint-disable @typescript-eslint/no-explicit-any */
import { CustomModel, getModelKey } from "@/aiParams";
import { EmbeddingModelProviders, ChatModelProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { CustomError } from "@/error";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { safeFetch } from "@/utils";
import { CohereEmbeddings } from "@langchain/cohere";
import { Embeddings } from "@langchain/core/embeddings";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Notice } from "obsidian";

type EmbeddingConstructorType = new (config: any) => Embeddings;

const EMBEDDING_PROVIDER_CONSTRUCTORS = {
  [EmbeddingModelProviders.OPENAI]: OpenAIEmbeddings,
  [EmbeddingModelProviders.COHEREAI]: CohereEmbeddings,
  [EmbeddingModelProviders.GOOGLE]: GoogleGenerativeAIEmbeddings,
  [EmbeddingModelProviders.AZURE_OPENAI]: OpenAIEmbeddings,
  [EmbeddingModelProviders.OLLAMA]: OllamaEmbeddings,
  [EmbeddingModelProviders.LM_STUDIO]: OpenAIEmbeddings,
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

  private readonly providerApiKeyMap: Record<
    EmbeddingModelProviders,
    () => string
  > = {
    [EmbeddingModelProviders.OPENAI]: () => getSettings().openAIApiKey,
    [EmbeddingModelProviders.COHEREAI]: () => getSettings().cohereApiKey,
    [EmbeddingModelProviders.GOOGLE]: () => getSettings().googleApiKey,
    [EmbeddingModelProviders.AZURE_OPENAI]: () =>
      getSettings().azureOpenAIApiKey,
    [EmbeddingModelProviders.OLLAMA]: () => "default-key",
    [EmbeddingModelProviders.LM_STUDIO]: () => "default-key",
    [EmbeddingModelProviders.OPENAI_FORMAT]: () => "",
  } as const;

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
    const constructor =
      EMBEDDING_PROVIDER_CONSTRUCTORS[
        model.provider as EmbeddingModelProviders
      ];
    if (!constructor) {
      console.warn(
        `Unknown provider: ${model.provider} for model: ${model.name}`
      );
      throw new Error(
        `Unknown provider: ${model.provider} for model: ${model.name}`
      );
    }
    return constructor;
  }

  // Build a map of modelKey to model config
  private buildModelMap(activeEmbeddingModels: CustomModel[]) {
    EmbeddingManager.modelMap = {};
    const modelMap = EmbeddingManager.modelMap;

    activeEmbeddingModels.forEach((model) => {
      if (!Object.values(EmbeddingModelProviders).includes(
        model.provider as EmbeddingModelProviders
      )) {
        console.warn(
          `Invalid provider: ${model.provider} for embedding model: ${model.name}`
        );
        return; // Skip this model and continue with the next one
      }

      if (model.enabled) {
        const constructor = this.getProviderConstructor(model);
        const apiKey =
          model.apiKey ||
          this.providerApiKeyMap[model.provider as EmbeddingModelProviders]();

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
    const modelKey = getModelKey();

    if (!EmbeddingManager.modelMap.hasOwnProperty(modelKey)) {
      throw new CustomError(`No embedding model found for: ${modelKey}`);
    }

    const selectedModel = EmbeddingManager.modelMap[modelKey];
    if (!selectedModel.hasApiKey) {
      throw new CustomError(
        `API key is not provided for the embedding model: ${modelKey}`
      );
    }

    const customModel = this.getCustomModel(modelKey);
    const config = this.getModelConfig(modelKey, customModel);

    try {
      EmbeddingManager.embeddingModel = new selectedModel.EmbeddingConstructor(
        config
      );
      return EmbeddingManager.embeddingModel;
    } catch (error) {
      throw new CustomError(
        `Error creating embedding model: ${modelKey}. ${error.message}`
      );
    }
  }

  private getModelConfig(
    modelKey: string,
    customModel: CustomModel
  ): any {
    const settings = getSettings();
    const modelName = customModel.name;

    const baseConfig = {
      maxRetries: 3,
      maxConcurrency: 3,
    };

    const providerConfig: {
      [K in keyof EmbeddingProviderConstructorMap]: ConstructorParameters<
        EmbeddingProviderConstructorMap[K]
      >[0];
    } = {
      [EmbeddingModelProviders.OPENAI]: {
        modelName,
        openAIApiKey: getDecryptedKey(
          customModel.apiKey || settings.openAIApiKey
        ),
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
        modelName: modelName,
        azureOpenAIApiKey: getDecryptedKey(
          customModel.apiKey || settings.azureOpenAIApiKey
        ),
        azureOpenAIApiInstanceName: settings.azureOpenAIApiInstanceName,
        azureOpenAIApiDeploymentName:
          settings.azureOpenAIApiEmbeddingDeploymentName,
        azureOpenAIApiVersion: settings.azureOpenAIApiVersion,
        configuration: {
          baseURL: customModel.baseUrl,
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
      },
      [EmbeddingModelProviders.OLLAMA]: {
        baseUrl: customModel.baseUrl || "http://localhost:11434",
        model: modelName,
      },
      [EmbeddingModelProviders.LM_STUDIO]: {
        modelName,
        configuration: {
          baseURL: customModel.baseUrl || "http://localhost:1234/v1",
          fetch: customModel.enableCors ? safeFetch : undefined,
        },
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

    // If the model is an Azure OpenAI model, use the specific deployment settings
    if (customModel.provider === EmbeddingModelProviders.AZURE_OPENAI) {
      const azureDeploymentName = modelKey.split("|")[1] || "";
      const azureDeployment = settings.azureOpenAIApiDeployments?.find(
        (d) => d.deploymentName === azureDeploymentName
      );

      if (azureDeployment) {
        providerConfig[
          EmbeddingModelProviders.AZURE_OPENAI
        ].azureOpenAIApiKey = getDecryptedKey(azureDeployment.apiKey);
        providerConfig[
          EmbeddingModelProviders.AZURE_OPENAI
        ].azureOpenAIApiInstanceName = azureDeployment.instanceName;
        providerConfig[
          EmbeddingModelProviders.AZURE_OPENAI
        ].azureOpenAIApiDeploymentName = azureDeployment.deploymentName;
        providerConfig[
          EmbeddingModelProviders.AZURE_OPENAI
        ].azureOpenAIApiVersion = azureDeployment.apiVersion;
      } else {
        console.error("Azure deployment is undefined. Please check your settings.");
        } else {
          console.error("Azure deployment is undefined. Please check your settings.");
        }
      } else {
        console.error(
          `No Azure OpenAI deployment found for model key: ${modelKey}`
        );
      }
    }

    const selectedProviderConfig =
      providerConfig[customModel.provider as EmbeddingModelProviders] || {};

    return { ...baseConfig, ...selectedProviderConfig };
  }

  async ping(model: CustomModel): Promise<boolean> {
    const tryPing = async (enableCors: boolean) => {
      const modelToTest = { ...model, enableCors };
      const modelKey = `${model.name}|${model.provider}`;
      const config = this.getModelConfig(modelKey, modelToTest);
      const testModel = new (this.getProviderConstructor(modelToTest))(config);
      await testModel.embedQuery("test");
    };

    try {
      // First try without CORS
      await tryPing(false);
      return true;
    } catch (error) {
      console.log("First ping attempt failed, trying with CORS...");
      try {
        // Second try with CORS
        await tryPing(true);
        new Notice(
          "Connection successful, but requires CORS to be enabled. Please enable CORS for this model once you add it above."
        );
        return true;
      } catch (error) {
        console.error("Embedding model ping failed:", error);
        throw error;
      }
    }
  }
}
