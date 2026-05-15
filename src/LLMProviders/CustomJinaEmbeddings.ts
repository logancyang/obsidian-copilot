import { Embeddings, EmbeddingsParams } from "@langchain/core/embeddings";
import { requestUrl } from "obsidian";

const DEFAULT_JINA_API_URL = "https://api.jina.ai/v1/embeddings";

interface JinaEmbeddingsConfig extends EmbeddingsParams {
  model?: string;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
}

interface JinaEmbeddingItem {
  index: number;
  embedding: number[];
}

interface JinaEmbeddingResponse {
  data?: JinaEmbeddingItem[];
  detail?: unknown;
}

export class CustomJinaEmbeddings extends Embeddings {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly dimensions?: number;

  constructor(config: JinaEmbeddingsConfig = {}) {
    super(config);
    this.model = config.model ?? config.modelName ?? "jina-embeddings-v2-base-en";
    this.apiKey = config.apiKey ?? "";
    this.url = config.baseUrl ?? DEFAULT_JINA_API_URL;
    this.dimensions = config.dimensions;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this._embed([text]);
    return embeddings[0];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this._embed(texts);
  }

  private async _embed(input: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = { input, model: this.model };
    if (this.dimensions !== undefined) {
      body.dimensions = this.dimensions;
    }

    const response = await requestUrl({
      url: this.url,
      method: "POST",
      contentType: "application/json",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Accept-Encoding": "identity",
      },
      body: JSON.stringify(body),
      throw: false,
    });

    if (response.status >= 400) {
      throw new Error(`Jina embedding request failed: ${response.status} - ${response.text ?? ""}`);
    }

    const resp = response.json as JinaEmbeddingResponse;
    if (!resp?.data) {
      throw new Error(
        typeof resp?.detail === "string" ? resp.detail : JSON.stringify(resp?.detail ?? resp)
      );
    }

    return [...resp.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
