import { BREVILABS_API_BASE_URL, BREVILABS_MODELS_BASE_URL } from "@/constants";
import { MissingPlusLicenseError } from "@/error";
import { logInfo } from "@/logger";
import { applyEntitlement, markPaidPendingEntitlement, turnOffPaid } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { arrayBufferToBase64 } from "@/utils/base64";
import { App, requestUrl } from "obsidian";

async function buildMultipartFromFormData(
  formData: FormData
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const boundary = `----CopilotBoundary${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  for (const [name, value] of formData.entries()) {
    parts.push(encoder.encode(`--${boundary}\r\n`));
    if (value instanceof Blob) {
      const filename = value instanceof File ? value.name : "blob";
      const contentType = value.type || "application/octet-stream";
      parts.push(
        encoder.encode(
          `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
            `Content-Type: ${contentType}\r\n\r\n`
        )
      );
      const buf = await value.arrayBuffer();
      parts.push(new Uint8Array(buf));
      parts.push(encoder.encode("\r\n"));
    } else {
      parts.push(encoder.encode(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
      parts.push(encoder.encode(String(value)));
      parts.push(encoder.encode("\r\n"));
    }
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`));

  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return {
    body: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

interface BrevilabsApiResult<T> {
  data: T | null;
  error?: Error;
  status: number;
  detail?: { reason?: string; error?: string };
}

function parseBrevilabsResponse<T>(
  response: { status: number; json: unknown },
  endpoint: string
): BrevilabsApiResult<T> {
  let data: unknown = response.json;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = response.json;
    }
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = (data as { detail?: { reason?: string; error?: string } } | null)?.detail;
    if (detail?.reason) {
      const error = new Error(detail.reason);
      if (detail.error) error.name = detail.error;
      return { data: null, error, status: response.status, detail };
    }
    return {
      data: null,
      error: new Error(`HTTP error: ${response.status}`),
      status: response.status,
    };
  }
  const loggable =
    data && typeof data === "object" && "entitlement" in data
      ? { ...(data as Record<string, unknown>), entitlement: "[redacted]" }
      : data;
  logInfo(`[API ${endpoint} request]:`, loggable);
  return { data: data as T, status: response.status };
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
  tool: unknown;
  args: unknown;
}

export interface Url4llmResponse {
  response: string;
  elapsed_time_ms: number;
}

export interface Pdf4llmResponse {
  response: string;
  elapsed_time_ms: number;
}

export interface Docs4llmResponse {
  response: unknown;
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

export interface Twitter4llmResponse {
  response: string;
  elapsed_time_ms: number;
}

export interface UsageResponse {
  used?: Record<string, { usedPercent?: number; resetsAt?: number } | null> | null;
  dashboard_url?: string;
}

export interface BrevilabsModelEntry {
  id?: string;
  label?: string;
  description?: string;
  context_length?: string;
  supports_images?: boolean;
  supports_tools?: boolean;
  supports_reasoning?: boolean;
  default_enabled?: boolean;
  reasoning_efforts?: string[];
}

export interface BrevilabsModelsResponse {
  data?: BrevilabsModelEntry[];
}

export interface LicenseResponse {
  is_valid: boolean;
  plan: string;
  entitlement?: string;
}

export type LicenseCheckTrigger =
  | "startup"
  | "manual"
  | "refresh"
  | "legacy_chat_turn"
  | "multi_agent_per_turn"
  | "tool_call"
  | "model_gate";

export interface LicenseCheckContext {
  trigger: LicenseCheckTrigger;
  [key: string]: unknown;
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
      throw new MissingPlusLicenseError(
        "Copilot Plus license key not found. Please enter your license key in the settings."
      );
    }
  }

  setPluginVersion(pluginVersion: string) {
    this.pluginVersion = pluginVersion;
  }

  getPluginVersionHeaders(): Record<string, string> {
    return { "X-Client-Version": this.pluginVersion };
  }

  private async makeRequest<T>(
    endpoint: string,
    body: Record<string, unknown>,
    method = "POST",
    excludeAuthHeader = false,
    skipLicenseCheck = false
  ): Promise<BrevilabsApiResult<T>> {
    if (!skipLicenseCheck) {
      this.checkLicenseKey();
    }

    body.user_id = getSettings().userId;

    const url = new URL(`${BREVILABS_API_BASE_URL}${endpoint}`);
    if (method === "GET") {
      Object.entries(body).forEach(([key, value]) => {
        url.searchParams.append(key, value as string);
      });
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.getPluginVersionHeaders(),
    };
    if (!excludeAuthHeader) {
      headers.Authorization = `Bearer ${getSettings().plusLicenseKey}`;
    }
    const response = await requestUrl({
      url: url.toString(),
      method,
      headers,
      ...(method === "POST" && { body: JSON.stringify(body) }),
      throw: false,
    });
    return parseBrevilabsResponse<T>(response, endpoint);
  }

  private async makeFormDataRequest<T>(
    endpoint: string,
    formData: FormData
  ): Promise<BrevilabsApiResult<T>> {
    this.checkLicenseKey();

    formData.append("user_id", getSettings().userId);

    const url = new URL(`${BREVILABS_API_BASE_URL}${endpoint}`);

    try {
      const { body, contentType } = await buildMultipartFromFormData(formData);

      const response = await requestUrl({
        url: url.toString(),
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Authorization: `Bearer ${getSettings().plusLicenseKey}`,
          ...this.getPluginVersionHeaders(),
        },
        body,
        throw: false,
      });
      return parseBrevilabsResponse<T>(response, `${endpoint} form-data`);
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
        status: 0,
      };
    }
  }

  async validateLicenseKey(
    app: App | undefined,
    context: LicenseCheckContext
  ): Promise<{ isValid: boolean | undefined; plan?: string }> {
    const requestedLicenseKey = getSettings().plusLicenseKey;

    // The server answers an empty key with the same 403 as a wrong one, so a keyless check would revoke a user who has not entered a key yet.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/307
    if (!requestedLicenseKey) {
      return { isValid: false };
    }

    const requestBody: Record<string, unknown> = {
      license_key: requestedLicenseKey,
    };

    if (context && typeof context === "object") {
      const filteredContext = Object.fromEntries(
        Object.entries(context).filter(([_, value]) => value !== undefined && value !== null)
      );

      const reservedKeys = new Set(["license_key", "user_id"]);
      for (const key of reservedKeys) {
        if (key in filteredContext) {
          delete (filteredContext as Record<string, unknown>)[key];
        }
      }

      Object.assign(requestBody, filteredContext);
    }

    const { data, error, status, detail } = await this.makeRequest<LicenseResponse>(
      "/license",
      requestBody,
      "POST",
      true,
      true
    );

    if (getSettings().plusLicenseKey !== requestedLicenseKey) {
      return { isValid: undefined };
    }

    if (error) {
      // Revoke only on a 403 with an API error body; a bare 403 comes from a gateway or WAF and says nothing about the key.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/307
      if (status === 403 && detail) {
        turnOffPaid(app);
        return { isValid: false };
      }
      return { isValid: undefined };
    }
    if (data?.entitlement) {
      const verified = await applyEntitlement(data.entitlement);
      if (!verified) {
        markPaidPendingEntitlement();
      }
    } else {
      markPaidPendingEntitlement();
    }
    return { isValid: true, plan: data?.plan };
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

  async getUsage(): Promise<UsageResponse | null> {
    const licenseKey = getSettings().plusLicenseKey;
    if (!licenseKey) return null;

    try {
      const response = await requestUrl({
        url: `${BREVILABS_MODELS_BASE_URL}/usage`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${licenseKey}`,
          ...this.getPluginVersionHeaders(),
        },
        throw: false,
      });
      if (response.status !== 200) {
        logInfo(`[BrevilabsClient] usage read returned ${response.status}; no cap meters`);
        return null;
      }
      return response.json as UsageResponse;
    } catch (error) {
      logInfo("[BrevilabsClient] usage read failed; no cap meters", error);
      return null;
    }
  }

  async getModels(): Promise<BrevilabsModelsResponse | null> {
    try {
      const response = await requestUrl({
        url: `${BREVILABS_MODELS_BASE_URL}/models`,
        method: "GET",
        headers: this.getPluginVersionHeaders(),
        throw: false,
      });
      if (response.status !== 200) {
        logInfo(`[BrevilabsClient] models read returned ${response.status}`);
        return null;
      }
      return response.json as BrevilabsModelsResponse;
    } catch (error) {
      logInfo("[BrevilabsClient] models read failed", error);
      return null;
    }
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
    const base64Content = arrayBufferToBase64(binaryContent);

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

  async docs4llm(binaryContent: ArrayBuffer, fileType: string): Promise<Docs4llmResponse> {
    const formData = new FormData();

    const mimeType = this.getMimeTypeFromExtension(fileType);
    const blob = new Blob([binaryContent], { type: mimeType });

    const fileName = `file.${fileType}`;
    const file = new File([blob], fileName, { type: mimeType });

    formData.append("files", file);

    formData.append("file_type", fileType);

    const { data, error } = await this.makeFormDataRequest<Docs4llmResponse>("/docs4llm", formData);

    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error("No data returned from docs4llm");
    }

    return data;
  }

  private getMimeTypeFromExtension(extension: string): string {
    const mimeMap: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      epub: "application/epub+zip",
      txt: "text/plain",
      rtf: "application/rtf",

      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      tiff: "image/tiff",
      webp: "image/webp",

      html: "text/html",
      htm: "text/html",

      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      csv: "text/csv",

      mp3: "audio/mpeg",
      mp4: "video/mp4",
      wav: "audio/wav",
      webm: "video/webm",
    };

    return mimeMap[extension.toLowerCase()] || "application/octet-stream";
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

  async twitter4llm(url: string): Promise<Twitter4llmResponse> {
    const { data, error } = await this.makeRequest<Twitter4llmResponse>("/twitter4llm", { url });
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error("No data returned from twitter4llm");
    }

    return data;
  }
}
