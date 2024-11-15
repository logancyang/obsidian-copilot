/* eslint-disable @typescript-eslint/no-explicit-any */
import { AnthropicInput, ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import OpenAI from "openai";
import { safeFetch } from "@/utils";

// Migrated to OpenAI v4 client from v3: https://github.com/openai/openai-node/discussions/217
export class ProxyChatOpenAI extends ChatOpenAI {
  constructor(fields?: any) {
    super(fields ?? {});

    // Reinitialize the client with the updated clientConfig
    this["client"] = new OpenAI({
      ...this["clientConfig"],
      baseURL: fields.openAIProxyBaseUrl,
      dangerouslyAllowBrowser: true,
      fetch: fields.enableCors ? safeFetch : undefined,
    });
  }
}

export class ProxyOpenAIEmbeddings extends OpenAIEmbeddings {
  constructor(fields?: any) {
    super(fields ?? {});

    // Reinitialize the client with the updated clientConfig
    this["client"] = new OpenAI({
      ...this["clientConfig"],
      baseURL: fields.openAIEmbeddingProxyBaseUrl,
      dangerouslyAllowBrowser: true,
      fetch: safeFetch,
    });
  }
}

export class ChatAnthropicWrapped extends ChatAnthropic {
  constructor(fields?: Partial<AnthropicInput>) {
    super({
      ...fields,
      // Required to bypass CORS restrictions
      clientOptions: { defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" } },
    });
  }
}
