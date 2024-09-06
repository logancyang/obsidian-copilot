/* eslint-disable @typescript-eslint/no-explicit-any */
import { AnthropicInput, ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { requestUrl } from "obsidian";
import OpenAI from "openai";

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

/** Proxy function to use in place of fetch() to bypass CORS restrictions.
 * It currently doesn't support streaming until this is implemented
 * https://forum.obsidian.md/t/support-streaming-the-request-and-requesturl-response-body/87381 */
async function safeFetch(url: string, options: RequestInit): Promise<Response> {
  // Necessary to remove 'content-length' in order to make headers compatible with requestUrl()
  delete (options.headers as Record<string, string>)["content-length"];
  const response = await requestUrl({
    url,
    contentType: "application/json",
    headers: options.headers as Record<string, string>,
    method: "POST",
    body: options.body?.toString(),
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.status.toString(),
    headers: new Headers(response.headers),
    url: url,
    type: "basic",
    redirected: false,
    body: createReadableStreamFromString(response.text),
    bodyUsed: true,
    json: () => response.json,
    text: async () => response.text,
    clone: () => {
      throw new Error("not implemented");
    },
    arrayBuffer: () => {
      throw new Error("not implemented");
    },
    blob: () => {
      throw new Error("not implemented");
    },
    formData: () => {
      throw new Error("not implemented");
    },
  };
}

function createReadableStreamFromString(input: string) {
  return new ReadableStream({
    start(controller) {
      // Convert the input string to a Uint8Array
      const encoder = new TextEncoder();
      const uint8Array = encoder.encode(input);

      // Push the data to the stream
      controller.enqueue(uint8Array);

      // Close the stream
      controller.close();
    },
  });
}
