import { LangChainParams } from '@/aiParams';
import { ModelProviders } from '@/constants';
import { ProxyOpenAIEmbeddings } from '@/langchainWrappers';
import { CohereEmbeddings } from "@langchain/cohere";
import { Embeddings } from "langchain/embeddings/base";
import { HuggingFaceInferenceEmbeddings } from "langchain/embeddings/hf";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";

export default class EmbeddingManager {
  private static instance: EmbeddingManager;
  private constructor(
    private langChainParams: LangChainParams
  ) {}

  static getInstance(
    langChainParams: LangChainParams
  ): EmbeddingManager {
    if (!EmbeddingManager.instance) {
      EmbeddingManager.instance = new EmbeddingManager(langChainParams);
    }
    return EmbeddingManager.instance;
  }

  getEmbeddingsAPI(): Embeddings | undefined {
    const {
      openAIApiKey,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      openAIProxyBaseUrl,
    } = this.langChainParams;

    // Note that openAIProxyBaseUrl has the highest priority.
    // If openAIProxyBaseUrl is set, it overrides both chat and embedding models.
    const OpenAIEmbeddingsAPI = openAIApiKey ? (
      openAIProxyBaseUrl ?
        new ProxyOpenAIEmbeddings({
          modelName: this.langChainParams.embeddingModel,
          openAIApiKey,
          maxRetries: 3,
          maxConcurrency: 3,
          timeout: 10000,
          openAIProxyBaseUrl,
        }) :
        new OpenAIEmbeddings({
          modelName: this.langChainParams.embeddingModel,
          openAIApiKey,
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
          apiKey: this.langChainParams.huggingfaceApiKey,
          maxRetries: 3,
          maxConcurrency: 3,
        });
      case ModelProviders.COHEREAI:
        return new CohereEmbeddings({
          apiKey: this.langChainParams.cohereApiKey,
          maxRetries: 3,
          maxConcurrency: 3,
        });
      case ModelProviders.AZURE_OPENAI:
        if (azureOpenAIApiKey) {
          return new OpenAIEmbeddings({
            azureOpenAIApiKey,
            azureOpenAIApiInstanceName,
            azureOpenAIApiDeploymentName: azureOpenAIApiEmbeddingDeploymentName,
            azureOpenAIApiVersion,
            maxRetries: 3,
            maxConcurrency: 3,
          });
        }
        console.error('Azure OpenAI API key is not provided for the embedding model.');
        break;
      default:
        console.error('No embedding provider set or no valid API key provided. Defaulting to OpenAI.');
        return OpenAIEmbeddingsAPI || new OpenAIEmbeddings({
          modelName: this.langChainParams.embeddingModel,
          openAIApiKey: 'default-key',
          maxRetries: 3,
          maxConcurrency: 3,
          timeout: 10000,
        });
    }
  }
}