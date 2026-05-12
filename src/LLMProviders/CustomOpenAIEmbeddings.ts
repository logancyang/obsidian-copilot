import { OpenAIEmbeddings } from "@langchain/openai";
import { requestUrl } from "obsidian";

export class CustomOpenAIEmbeddings extends OpenAIEmbeddings {
  private customConfig: any;

  constructor(config: any) {
    super(config);
    // Store the config for our custom methods
    this.customConfig = config;
  }

  async embedQuery(text: string): Promise<number[]> {
    // Make direct API call to avoid OpenAI client's response processing
    const embedding = await this.callEmbeddingAPI([text]);
    return embedding[0];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Make direct API call to avoid OpenAI client's response processing
    const embeddings = await this.callEmbeddingAPI(texts);
    return embeddings;
  }

  private async callEmbeddingAPI(texts: string[]): Promise<number[][]> {
    const requestBody = {
      model: this.customConfig.modelName,
      input: texts,
      encoding_format: "float",
    };

    // Get the correct baseURL and apiKey from the configuration
    const baseURL = this.customConfig.configuration?.baseURL || "https://api.openai.com/v1";
    const url = `${baseURL}/embeddings`;
    const apiKey = this.customConfig.apiKey;

    // If the caller passed a custom fetch (e.g., safeFetch for CORS bypass), keep using it.
    // Otherwise prefer Obsidian's requestUrl which bypasses CORS.
    const customFetch = this.customConfig.configuration?.fetch;
    let responseData: any;

    if (customFetch) {
      const response = await customFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(this.customConfig.headers || {}),
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Embedding API request failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }
      responseData = await response.json();
    } else {
      const response = await requestUrl({
        url,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(this.customConfig.headers || {}),
        },
        body: JSON.stringify(requestBody),
        throw: false,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Embedding API request failed: ${response.status} - ${response.text}`);
      }
      responseData = response.json;
    }

    if (!responseData.data || !Array.isArray(responseData.data)) {
      throw new Error("Invalid API response format: missing or invalid data array");
    }

    return responseData.data.map((item: any) => {
      if (!item.embedding || !Array.isArray(item.embedding)) {
        throw new Error("Invalid API response format: missing or invalid embedding array");
      }
      return item.embedding;
    });
  }
}
