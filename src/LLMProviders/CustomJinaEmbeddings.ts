/*
 * Adapted from @langchain/community JinaEmbeddings.
 * Copyright (c) LangChain, Inc. Licensed under the MIT License.
 * Source: https://github.com/langchain-ai/langchainjs-community/blob/886df5749a926f59e6fdf38a3465c62ec9e7ce32/libs/community/src/embeddings/jina.ts
 */

import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { chunkArray } from "@langchain/core/utils/chunk_array";
import { getEnvironmentVariable } from "@langchain/core/utils/env";

export interface JinaEmbeddingsParams extends EmbeddingsParams {
  /** Model name to use. */
  model: string;
  /** Compatibility alias used by this plugin's embedding manager. */
  modelName?: string;
  /** Jina-compatible embeddings endpoint. */
  baseUrl?: string;
  /** Timeout to use when making requests to Jina. */
  timeout?: number;
  /** The maximum number of documents to embed in a single request. */
  batchSize?: number;
  /** Whether to strip new lines from the input text. */
  stripNewLines?: boolean;
  /** The dimensions of the embedding. */
  dimensions?: number;
  /** Whether to L2-normalize the embedding vectors. */
  normalized?: boolean;
}

type JinaMultiModelInput =
  | {
      text: string;
      image?: never;
    }
  | {
      image: string;
      text?: never;
    };

export type JinaEmbeddingsInput = string | JinaMultiModelInput;

interface EmbeddingCreateParams {
  model: JinaEmbeddingsParams["model"];
  input: JinaEmbeddingsInput[];
  dimensions: number;
  task: "retrieval.query" | "retrieval.passage";
  normalized?: boolean;
}

interface EmbeddingResponse {
  model: string;
  object: string;
  usage: {
    total_tokens: number;
    prompt_tokens: number;
  };
  data: {
    object: string;
    index: number;
    embedding: number[];
  }[];
}

interface EmbeddingErrorResponse {
  detail: string;
}

export class CustomJinaEmbeddings extends Embeddings implements JinaEmbeddingsParams {
  model: JinaEmbeddingsParams["model"] = "jina-clip-v2";
  batchSize = 24;
  baseUrl = "https://api.jina.ai/v1/embeddings";
  stripNewLines = true;
  dimensions = 1024;
  apiKey: string;
  normalized = true;

  /**
   * Creates a Jina embeddings client using local configuration or Jina environment variables.
   */
  constructor(
    fields?: Partial<JinaEmbeddingsParams> & {
      apiKey?: string;
    }
  ) {
    const fieldsWithDefaults = { maxConcurrency: 2, ...fields };
    super(fieldsWithDefaults);

    const apiKey =
      fieldsWithDefaults?.apiKey ||
      getEnvironmentVariable("JINA_API_KEY") ||
      getEnvironmentVariable("JINA_AUTH_TOKEN");

    if (!apiKey) throw new Error("Jina API key not found");

    this.apiKey = apiKey;
    this.model = fieldsWithDefaults?.model ?? fieldsWithDefaults?.modelName ?? this.model;
    this.baseUrl = fieldsWithDefaults?.baseUrl ?? this.baseUrl;
    this.dimensions = fieldsWithDefaults?.dimensions ?? this.dimensions;
    this.batchSize = fieldsWithDefaults?.batchSize ?? this.batchSize;
    this.stripNewLines = fieldsWithDefaults?.stripNewLines ?? this.stripNewLines;
    this.normalized = fieldsWithDefaults?.normalized ?? this.normalized;
  }

  /**
   * Embeds passage documents with Jina retrieval-passage task parameters.
   */
  async embedDocuments(input: JinaEmbeddingsInput[]): Promise<number[][]> {
    const batches = chunkArray(this.doStripNewLines(input), this.batchSize);
    const batchRequests = batches.map((batch) => {
      const params = this.getParams(batch);
      return this.embeddingWithRetry(params);
    });

    const batchResponses = await Promise.all(batchRequests);
    const embeddings: number[][] = [];

    for (let i = 0; i < batchResponses.length; i += 1) {
      const batch = batches[i];
      const batchResponse = batchResponses[i] || [];
      for (let j = 0; j < batch.length; j += 1) {
        embeddings.push(batchResponse[j]);
      }
    }

    return embeddings;
  }

  /**
   * Embeds a query with Jina retrieval-query task parameters.
   */
  async embedQuery(input: JinaEmbeddingsInput): Promise<number[]> {
    const params = this.getParams(this.doStripNewLines([input]), true);
    const embeddings = (await this.embeddingWithRetry(params)) || [[]];
    return embeddings[0];
  }

  /**
   * Removes newlines from string inputs when configured to match upstream Jina behavior.
   */
  private doStripNewLines(input: JinaEmbeddingsInput[]): JinaEmbeddingsInput[] {
    if (this.stripNewLines) {
      return input.map((item) => {
        if (typeof item === "string") {
          return item.replace(/\n/g, " ");
        }
        if (item.text) {
          return { text: item.text.replace(/\n/g, " ") };
        }
        return item;
      });
    }
    return input;
  }

  /**
   * Builds the request body for Jina's retrieval embedding API.
   */
  private getParams(input: JinaEmbeddingsInput[], query?: boolean): EmbeddingCreateParams {
    return {
      model: this.model,
      input,
      dimensions: this.dimensions,
      task: query ? "retrieval.query" : "retrieval.passage",
      normalized: this.normalized,
    };
  }

  /**
   * Sends a single embeddings request and returns vectors in response order.
   */
  private async embeddingWithRetry(body: EmbeddingCreateParams): Promise<number[][]> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const embeddingData: EmbeddingResponse | EmbeddingErrorResponse = await response.json();
    if ("detail" in embeddingData && embeddingData.detail) {
      throw new Error(`${embeddingData.detail}`);
    }
    return (embeddingData as EmbeddingResponse).data.map(({ embedding }) => embedding);
  }
}
