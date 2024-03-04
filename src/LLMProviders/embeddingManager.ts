import { LangChainParams } from '@/aiParams';
import { ModelProviders } from '@/constants';
import EncryptionService from '@/encryptionService';
import { ProxyOpenAIEmbeddings } from '@/langchainWrappers';
import { CohereEmbeddings } from "@langchain/cohere";
import { Embeddings } from "langchain/embeddings/base";
import { HuggingFaceInferenceEmbeddings } from "langchain/embeddings/hf";
import { OllamaEmbeddings } from "langchain/embeddings/ollama";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";

export default class EmbeddingManager {
  private static instance: EmbeddingManager;
  private constructor(
    private langChainParams: LangChainParams,
    private encryptionService: EncryptionService,
  ) {}

  static getInstance(
    langChainParams: LangChainParams,
    encryptionService: EncryptionService,
  ): EmbeddingManager {
    if (!EmbeddingManager.instance) {
      EmbeddingManager.instance = new EmbeddingManager(langChainParams, encryptionService);
    }
    return EmbeddingManager.instance;
  }

  getEmbeddingsAPI(): Embeddings | undefined {
    const decrypt = (key: string) => this.encryptionService.getDecryptedKey(key);
    const {
      openAIApiKey,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      openAIEmbeddingProxyBaseUrl,
      openAIEmbeddingProxyModelName,
    } = this.langChainParams;

    const OpenAIEmbeddingsAPI = openAIApiKey ? (
      openAIEmbeddingProxyBaseUrl ?
        new ProxyOpenAIEmbeddings({
          modelName: openAIEmbeddingProxyModelName || this.langChainParams.embeddingModel,
          openAIApiKey: decrypt(openAIApiKey),
          maxRetries: 3,
          maxConcurrency: 3,
          timeout: 10000,
          openAIEmbeddingProxyBaseUrl,
        }) :
        new OpenAIEmbeddings({
          modelName: openAIEmbeddingProxyModelName || this.langChainParams.embeddingModel,
          openAIApiKey: decrypt(openAIApiKey),
          maxRetries: 3,
          maxConcurrency: 3,
          timeout: 10000,
        })
    ) : null;

    switch(this.langChainParams.embeddingProvider) {
      case ModelProviders.OPENAI:
        if (OpenAIEmbeddingsAPI) {
          return OpenAIEmbeddingsAPI;
        }
        console.error('OpenAI API key is not provided for the embedding model.');
        break;
      case ModelProviders.HUGGINGFACE:
        return new HuggingFaceInferenceEmbeddings({
          apiKey: decrypt(this.langChainParams.huggingfaceApiKey),
          maxRetries: 3,
          maxConcurrency: 3,
        });
      case ModelProviders.COHEREAI:
        return new CohereEmbeddings({
          apiKey: decrypt(this.langChainParams.cohereApiKey),
          maxRetries: 3,
          maxConcurrency: 3,
        });
      case ModelProviders.AZURE_OPENAI:
        if (azureOpenAIApiKey) {
          return new OpenAIEmbeddings({
            azureOpenAIApiKey: decrypt(azureOpenAIApiKey),
            azureOpenAIApiInstanceName,
            azureOpenAIApiDeploymentName: azureOpenAIApiEmbeddingDeploymentName,
            azureOpenAIApiVersion,
            maxRetries: 3,
            maxConcurrency: 3,
          });
        }
        console.error('Azure OpenAI API key is not provided for the embedding model.');
        break;
      case ModelProviders.OLLAMA:
        return new OllamaEmbeddings({
          ...(this.langChainParams.ollamaBaseUrl ? { baseUrl: this.langChainParams.ollamaBaseUrl } : {}),
          // TODO: Add custom ollama embedding model setting once they have other models
          model: 'nomic-embed-text',
        })
      default:
        console.error('No embedding provider set or no valid API key provided. Defaulting to OpenAI.');
        return OpenAIEmbeddingsAPI || new OpenAIEmbeddings({
          modelName: openAIEmbeddingProxyModelName || this.langChainParams.embeddingModel,
          openAIApiKey: 'default-key',
          maxRetries: 3,
          maxConcurrency: 3,
          timeout: 10000,
        });
    }
  }
}