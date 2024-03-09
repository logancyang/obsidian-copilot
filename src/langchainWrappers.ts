import { ChatOpenAI } from 'langchain/chat_models/openai';
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import OpenAI from "openai";

// Migrated to OpenAI v4 client from v3: https://github.com/openai/openai-node/discussions/217
export class ProxyChatOpenAI extends ChatOpenAI {
  constructor(
    fields?: any,
  ) {
    super(fields ?? {});

    // Reinitialize the client with the updated clientConfig
    this["client"] = new OpenAI({
      ...this["clientConfig"],
      baseURL: fields.openAIProxyBaseUrl,
    });
  }
}

export class ProxyOpenAIEmbeddings extends OpenAIEmbeddings {
  constructor(
    fields?: any,
  ) {
    super(fields ?? {});

    // Reinitialize the client with the updated clientConfig
    this["client"] = new OpenAI({
      ...this["clientConfig"],
      baseURL: fields.openAIEmbeddingProxyBaseUrl,
    });
  }
}
