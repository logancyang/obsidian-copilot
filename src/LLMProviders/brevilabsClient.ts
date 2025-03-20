import { BREVILABS_API_BASE_URL } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logInfo } from "@/logger";
import { turnOffPlus, turnOnPlus } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { Notice } from "obsidian";
import { Buffer } from "buffer";

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

  private async makeRequest<T>(
    endpoint: string,
    body: any,
    method = "POST",
    excludeAuthHeader = false
  ): Promise<{ data: T | null; error?: Error }> {
    this.checkLicenseKey();

    const url = new URL(`${BREVILABS_API_BASE_URL}${endpoint}`);
    if (method === "GET") {
      // Add query parameters for GET requests
      Object.entries(body).forEach(([key, value]) => {
        url.searchParams.append(key, value as string);
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(!excludeAuthHeader && {
          Authorization: `Bearer ${await getDecryptedKey(getSettings().plusLicenseKey)}`,
        }),
        "X-Client-Version": this.pluginVersion,
      },
      ...(method === "POST" && { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) {
      try {
        const errorDetail = data.detail;
        const error = new Error(errorDetail.reason);
        error.name = errorDetail.error;
        return { data: null, error };
      } catch {
        return { data: null, error: new Error("Unknown error") };
      }
    }
    logInfo(`==== ${endpoint} request ====:`, data);

    return { data };
  }

  /**
   * Validate the license key and update the isPlusUser setting.
   * @returns true if the license key is valid, false if the license key is invalid, and undefined if
   * unknown error.
   */
  async validateLicenseKey(): Promise<boolean | undefined> {
    const { error } = await this.makeRequest(
      "/license",
      {
        license_key: await getDecryptedKey(getSettings().plusLicenseKey),
      },
      "POST",
      true
    );
    if (error) {
      if (error.message === "Invalid license key") {
        turnOffPlus();
        return false;
      }
      // Do nothing if the error is not about the invalid license key
      return;
    }
    turnOnPlus();
    return true;
  }

  async broca(userMessage: string): Promise<BrocaResponse> {
    const { data, error } = await this.makeRequest<BrocaResponse>("/broca", {
      message: userMessage,
    });
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error("No data returned from broca");
    }

    return data;
  }

  async rerank(query: string, documents: string[]): Promise<RerankResponse> {
    const { data, error } = await this.makeRequest<RerankResponse>("/rerank", {
      query,
      documents,
      model: "rerank-2",
    });
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error("No data returned from rerank");
    }

    return data;
  }

  async url4llm(url: string): Promise<Url4llmResponse> {
    const { data, error } = await this.makeRequest<Url4llmResponse>("/url4llm", { url });
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error("No data returned from url4llm");
    }

    return data;
  }

  async pdf4llm(binaryContent: ArrayBuffer): Promise<Pdf4llmResponse> {
    // Convert ArrayBuffer to base64 string
    const base64Content = Buffer.from(binaryContent).toString("base64");

    const { data, error } = await this.makeRequest<Pdf4llmResponse>("/pdf4llm", {
      pdf: base64Content,
    });
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error("No data returned from pdf4llm");
    }

    return data;
  }

  async webSearch(query: string): Promise<WebSearchResponse> {
    const { data, error } = await this.makeRequest<WebSearchResponse>("/websearch", { query });
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error("No data returned from websearch");
    }

    return data;
  }

  async youtube4llm(url: string): Promise<Youtube4llmResponse> {
    const { data, error } = await this.makeRequest<Youtube4llmResponse>("/youtube4llm", { url });
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error("No data returned from youtube4llm");
    }

    return data;
  }
}
