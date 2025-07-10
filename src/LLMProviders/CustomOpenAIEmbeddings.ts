import { OpenAIEmbeddings } from "@langchain/openai";

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

    // Get the correct baseURL, apiKey, and fetch function from the configuration
    const baseURL = this.customConfig.configuration?.baseURL || "https://api.openai.com/v1";
    const url = `${baseURL}/embeddings`;
    const apiKey = this.customConfig.apiKey;
    const fetchFn = this.customConfig.configuration?.fetch || fetch;

    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Embedding API request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const responseData = await response.json();

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
