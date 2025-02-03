import { BREVILABS_API_BASE_URL } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { getSettings } from "@/settings/model";
import { safeFetch } from "@/utils";
import { Notice } from "obsidian";

export interface BrocaResponse {
  response: {
    tool_calls: Array<{
      tool: string;
      args: {
        [key: string]: any;
      };
    }>;
    salience_terms: string[];
  };
  elapsed_time_ms: number;
  detail?: string;
}

export interface RerankResponse {
  response: {
    object: string;
    data: Array<{
      relevance_score: number;
      index: number;
    }>;
    model: string;
    usage: {
      total_tokens: number;
    };
  };
  elapsed_time_ms: number;
}

export interface ToolCall {
  tool: any;
  args: any;
}

export interface Url4llmResponse {
  response: any;
  elapsed_time_ms: number;
}

export interface Pdf4llmResponse {
  response: any;
  elapsed_time_ms: number;
}

export interface WebSearchResponse {
  response: {
    choices: [
      {
        message: {
          content: string;
        };
      },
    ];
    citations: string[];
  };
  elapsed_time_ms: number;
}

export interface Youtube4llmResponse {
  response: {
    transcript: string;
  };
  elapsed_time_ms: number;
}

export class BrevilabsClient {
  private static instance: BrevilabsClient;
  private pluginVersion: string = "Unknown";

  static getInstance(): BrevilabsClient {
    if (!BrevilabsClient.instance) {
      BrevilabsClient.instance = new BrevilabsClient();
    }
    return BrevilabsClient.instance;
  }

  private checkLicenseKey() {
    if (!getSettings().plusLicenseKey) {
      new Notice(
        "Copilot Plus license key not found. Please enter your license key in the settings."
      );
      throw new Error("License key not initialized");
    }
  }

  setPluginVersion(pluginVersion: string) {
    this.pluginVersion = pluginVersion;
  }

  private async makeRequest<T>(endpoint: string, body: any, method = "POST"): Promise<T> {
    this.checkLicenseKey();

    const url = new URL(`${BREVILABS_API_BASE_URL}${endpoint}`);
    if (method === "GET") {
      // Add query parameters for GET requests
      Object.entries(body).forEach(([key, value]) => {
        url.searchParams.append(key, value as string);
      });
    }

    const response = await safeFetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getDecryptedKey(getSettings().plusLicenseKey)}`,
        "X-Client-Version": this.pluginVersion,
      },
      ...(method === "POST" && { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (getSettings().debug) {
      console.log(`==== ${endpoint} request ====:`, data);
    }

    return data;
  }

  private async makeRequestWithCustomBaseUrl<T>(
    baseUrl: string,
    endpoint: string,
    body: any,
    method = "POST"
  ): Promise<T> {
    this.checkLicenseKey();

    const url = new URL(`${baseUrl}${endpoint}`);
    if (method === "GET") {
      // Add query parameters for GET requests
      Object.entries(body).forEach(([key, value]) => {
        url.searchParams.append(key, value as string);
      });
    }

    const response = await safeFetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getDecryptedKey(getSettings().plusLicenseKey)}`,
        "X-Client-Version": this.pluginVersion,
      },
      ...(method === "POST" && { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (getSettings().debug) {
      console.log(`==== ${endpoint} request ====:`, data);
    }

    return data;
  }

  async broca(userMessage: string): Promise<BrocaResponse> {
    const brocaResponse = await this.makeRequest<BrocaResponse>("/broca", {
      message: userMessage,
    });

    return brocaResponse;
  }

  async rerank(query: string, documents: string[]): Promise<RerankResponse> {
    return this.makeRequest<RerankResponse>("/rerank", {
      query,
      documents,
      model: "rerank-2",
    });
  }

  async url4llm(url: string): Promise<Url4llmResponse> {
    return this.makeRequest<Url4llmResponse>("/url4llm", { url });
  }

  async pdf4llm(binaryContent: ArrayBuffer): Promise<Pdf4llmResponse> {
    // Convert ArrayBuffer to base64 string
    const base64Content = Buffer.from(binaryContent).toString("base64");

    return this.makeRequest<Pdf4llmResponse>("/pdf4llm", {
      pdf: base64Content,
    });
  }

  async webSearch(query: string): Promise<WebSearchResponse> {
    return this.makeRequest<WebSearchResponse>("/websearch", { query });
  }

  async youtube4llm(url: string): Promise<Youtube4llmResponse> {
    try {
      // First try with production URL
      return await this.makeRequest<Youtube4llmResponse>("/youtube4llm", { url });
    } catch (error) {
      // Only retry if the error indicates missing transcript or service failure
      const response = error instanceof Response ? await error.json() : null;
      if (!response?.response?.transcript) {
        // If production fails, try with staging URL
        const stagingUrl = "https://brevilabs-api-staging.up.railway.app/v1";
        return await this.makeRequestWithCustomBaseUrl<Youtube4llmResponse>(
          stagingUrl,
          "/youtube4llm",
          { url }
        );
      }
      // If we get here, rethrow the original error
      throw error;
    }
  }
}
