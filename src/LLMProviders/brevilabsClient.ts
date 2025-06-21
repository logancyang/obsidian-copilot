import { BREVILABS_API_BASE_URL } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logInfo } from "@/logger";
import { turnOffPlus, turnOnPlus } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { Buffer } from "buffer";
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

export interface Docs4llmResponse {
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

export interface LicenseResponse {
  is_valid: boolean;
  plan: string;
}

export interface AutocompleteResponse {
  response: {
    completion: string;
  };
  elapsed_time_ms: number;
}

export interface WordCompleteResponse {
  response: {
    selected_word: string;
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
    excludeAuthHeader = false,
    skipLicenseCheck = false
  ): Promise<{ data: T | null; error?: Error }> {
    console.warn(`BrevilabsClient.makeRequest called for endpoint ${endpoint} but is disabled in Phase 1. No request sent to api.brevilabs.com.`);
    // if (!skipLicenseCheck) {
    //   this.checkLicenseKey();
    // }

    // body.user_id = getSettings().userId;

    // const url = new URL(`${BREVILABS_API_BASE_URL}${endpoint}`);
    // if (method === "GET") {
    //   // Add query parameters for GET requests
    //   Object.entries(body).forEach(([key, value]) => {
    //     url.searchParams.append(key, value as string);
    //   });
    // }

    // const response = await fetch(url.toString(), {
    //   method,
    //   headers: {
    //     "Content-Type": "application/json",
    //     ...(!excludeAuthHeader && {
    //       Authorization: `Bearer ${await getDecryptedKey(getSettings().plusLicenseKey)}`,
    //     }),
    //     "X-Client-Version": this.pluginVersion,
    //   },
    //   ...(method === "POST" && { body: JSON.stringify(body) }),
    // });
    // const data = await response.json();
    // if (!response.ok) {
    //   try {
    //     const errorDetail = data.detail;
    //     const error = new Error(errorDetail.reason);
    //     error.name = errorDetail.error;
    //     return { data: null, error };
    //   } catch {
    //     return { data: null, error: new Error("Unknown error") };
    //   }
    // }
    // logInfo(`==== ${endpoint} request ====:`, data);

    // return { data };
    return Promise.resolve({ data: null, error: new Error("BrevilabsClient disabled") });
  }

  private async makeFormDataRequest<T>(
    endpoint: string,
    formData: FormData,
    skipLicenseCheck = false
  ): Promise<{ data: T | null; error?: Error }> {
    console.warn(`BrevilabsClient.makeFormDataRequest called for endpoint ${endpoint} but is disabled in Phase 1. No request sent to api.brevilabs.com.`);
    // if (!skipLicenseCheck) {
    //   this.checkLicenseKey();
    // }

    // // Add user_id to FormData
    // formData.append("user_id", getSettings().userId);

    // const url = new URL(`${BREVILABS_API_BASE_URL}${endpoint}`);

    // try {
    //   const response = await fetch(url.toString(), {
    //     method: "POST",
    //     headers: {
    //       // No Content-Type header - browser will set it automatically with boundary
    //       Authorization: `Bearer ${await getDecryptedKey(getSettings().plusLicenseKey)}`,
    //       "X-Client-Version": this.pluginVersion,
    //     },
    //     body: formData,
    //   });

    //   const data = await response.json();
    //   if (!response.ok) {
    //     try {
    //       const errorDetail = data.detail;
    //       const error = new Error(errorDetail.reason);
    //       error.name = errorDetail.error;
    //       return { data: null, error };
    //     } catch {
    //       return { data: null, error: new Error(`HTTP error: ${response.status}`) };
    //     }
    //   }
    //   logInfo(`==== ${endpoint} FormData request ====:`, data);
    //   return { data };
    // } catch (error) {
    //   return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    // }
    return Promise.resolve({ data: null, error: new Error("BrevilabsClient disabled") });
  }

  /**
   * Validate the license key and update the isPlusUser setting.
   * @returns true if the license key is valid, false if the license key is invalid, and undefined if
   * unknown error.
   */
  async validateLicenseKey(): Promise<{ isValid: boolean | undefined; plan?: string }> {
    console.warn("BrevilabsClient.validateLicenseKey called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // const { data, error } = await this.makeRequest<LicenseResponse>(
    //   "/license",
    //   {
    //     license_key: await getDecryptedKey(getSettings().plusLicenseKey),
    //   },
    //   "POST",
    //   true,
    //   true
    // );
    // if (error) {
    //   if (error.message === "Invalid license key") {
    //     turnOffPlus();
    //     return { isValid: false };
    //   }
    //   // Do nothing if the error is not about the invalid license key
    //   return { isValid: undefined };
    // }
    // turnOnPlus();
    // return { isValid: true, plan: data?.plan };
    return Promise.resolve({ isValid: false, plan: "none" });
  }

  async broca(userMessage: string, isProjectMode: boolean): Promise<BrocaResponse> {
    console.warn("BrevilabsClient.broca called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // const { data, error } = await this.makeRequest<BrocaResponse>("/broca", {
    //   message: userMessage,
    //   is_project_mode: isProjectMode,
    // });
    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from broca");
    // }
    // return data;
    return Promise.resolve({ response: { tool_calls: [], salience_terms: [] }, elapsed_time_ms: 0 });
  }

  async rerank(query: string, documents: string[]): Promise<RerankResponse> {
    console.warn("BrevilabsClient.rerank called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // const { data, error } = await this.makeRequest<RerankResponse>("/rerank", {
    //   query,
    //   documents,
    //   model: "rerank-2",
    // });
    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from rerank");
    // }
    // return data;
    return Promise.resolve({ response: { object: "", data: [], model: "", usage: {total_tokens: 0}}, elapsed_time_ms: 0 });
  }

  async url4llm(url: string): Promise<Url4llmResponse> {
    console.warn("BrevilabsClient.url4llm called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // const { data, error } = await this.makeRequest<Url4llmResponse>("/url4llm", { url });
    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from url4llm");
    // }
    // return data;
    return Promise.resolve({ response: "", elapsed_time_ms: 0 });
  }

  async pdf4llm(binaryContent: ArrayBuffer): Promise<Pdf4llmResponse> {
    console.warn("BrevilabsClient.pdf4llm called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // // Convert ArrayBuffer to base64 string
    // const base64Content = Buffer.from(binaryContent).toString("base64");

    // const { data, error } = await this.makeRequest<Pdf4llmResponse>("/pdf4llm", {
    //   pdf: base64Content,
    // });
    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from pdf4llm");
    // }
    // return data;
    return Promise.resolve({ response: "", elapsed_time_ms: 0 }); // Changed from content to response
  }

  async docs4llm(binaryContent: ArrayBuffer, fileType: string): Promise<Docs4llmResponse> {
    console.warn("BrevilabsClient.docs4llm called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // // Create a FormData object
    // const formData = new FormData();

    // // Convert ArrayBuffer to Blob with appropriate mime type
    // const mimeType = this.getMimeTypeFromExtension(fileType);
    // const blob = new Blob([binaryContent], { type: mimeType });

    // // Create a File object with a filename including the extension
    // const fileName = `file.${fileType}`;
    // const file = new File([blob], fileName, { type: mimeType });

    // // Append the file to FormData
    // formData.append("files", file);

    // // Add file_type as a regular field
    // formData.append("file_type", fileType);

    // const { data, error } = await this.makeFormDataRequest<Docs4llmResponse>("/docs4llm", formData);

    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from docs4llm");
    // }
    // return data;
    return Promise.resolve({ response: "", elapsed_time_ms: 0 }); // Changed from content to response
  }

  private getMimeTypeFromExtension(extension: string): string {
    const mimeMap: Record<string, string> = {
      // Documents
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      epub: "application/epub+zip",
      txt: "text/plain",
      rtf: "application/rtf",

      // Images
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      tiff: "image/tiff",
      webp: "image/webp",

      // Web
      html: "text/html",
      htm: "text/html",

      // Spreadsheets
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      csv: "text/csv",

      // Audio
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      wav: "audio/wav",
      webm: "video/webm",
    };

    return mimeMap[extension.toLowerCase()] || "application/octet-stream";
  }

  async webSearch(query: string): Promise<WebSearchResponse> {
    console.warn("BrevilabsClient.webSearch called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // const { data, error } = await this.makeRequest<WebSearchResponse>("/websearch", { query });
    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from websearch");
    // }
    // return data;
    return Promise.resolve({ response: { choices: [{ message: { content: "" } }], citations: [] }, elapsed_time_ms: 0 });
  }

  async youtube4llm(url: string): Promise<Youtube4llmResponse> {
    console.warn("BrevilabsClient.youtube4llm called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // const { data, error } = await this.makeRequest<Youtube4llmResponse>("/youtube4llm", { url });
    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from youtube4llm");
    // }
    // return data;
    return Promise.resolve({ response: { transcript: "" }, elapsed_time_ms: 0 });
  }

  async autocomplete(
    prefix: string,
    noteContext: string = "",
    relevant_notes: string = ""
  ): Promise<AutocompleteResponse> {
    console.warn("BrevilabsClient.autocomplete called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // const { data, error } = await this.makeRequest<AutocompleteResponse>("/autocomplete", {
    //   prompt: prefix,
    //   note_context: noteContext,
    //   relevant_notes: relevant_notes,
    //   max_tokens: 64,
    // });
    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from autocomplete");
    // }
    // return data;
    return Promise.resolve({ response: { completion: "" }, elapsed_time_ms: 0 });
  }

  async wordcomplete(
    prefix: string,
    suffix: string = "",
    suggestions: string[]
  ): Promise<WordCompleteResponse> {
    console.warn("BrevilabsClient.wordcomplete called but is disabled in Phase 1. No request sent to api.brevilabs.com.");
    // const { data, error } = await this.makeRequest<WordCompleteResponse>("/wordcomplete", {
    //   prefix: prefix,
    //   suffix: suffix,
    //   suggestions: suggestions,
    // });
    // if (error) {
    //   throw error;
    // }
    // if (!data) {
    //   throw new Error("No data returned from wordcomplete");
    // }
    // return data;
    return Promise.resolve({ response: { selected_word: "" }, elapsed_time_ms: 0 });
  }
}
