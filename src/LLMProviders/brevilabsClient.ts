import { BREVILABS_API_BASE_URL, BREVILABS_MODELS_BASE_URL } from "@/constants";
import { MissingPlusLicenseError } from "@/error";
import { logInfo } from "@/logger";
import { applyEntitlement, markPaidPendingEntitlement, turnOffPaid } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { arrayBufferToBase64 } from "@/utils/base64";
import { App, requestUrl } from "obsidian";

/**
 * Build a multipart/form-data body buffer from a FormData instance.
 * Returned as an ArrayBuffer suitable for passing to Obsidian's requestUrl.
 *
 * @param formData - FormData containing strings and/or File/Blob entries.
 * @returns The serialized multipart body and the Content-Type header (including boundary).
 */
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

/**
 * Normalize a requestUrl response into the {data, error} shape used by Brevilabs API methods.
 * Handles the case where `response.json` is a raw string (non-JSON body, e.g. HTML error page).
 */
function parseBrevilabsResponse<T>(
  response: { status: number; json: unknown },
  endpoint: string
): { data: T | null; error?: Error } {
  let data: unknown = response.json;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // Non-JSON body — fall through to status-based error.
    }
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = (data as { detail?: { reason?: string; error?: string } } | null)?.detail;
    if (detail?.reason) {
      const error = new Error(detail.reason);
      if (detail.error) error.name = detail.error;
      return { data: null, error };
    }
    return { data: null, error: new Error(`HTTP error: ${response.status}`) };
  }
  // Redact the signed entitlement JWS so it never lands in the shared
  // copilot-log.md when a license response is logged.
  const loggable =
    data && typeof data === "object" && "entitlement" in data
      ? { ...(data as Record<string, unknown>), entitlement: "[redacted]" }
      : data;
  logInfo(`[API ${endpoint} request]:`, loggable);
  return { data: data as T };
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

/**
 * `GET /usage` — the account's plan-cap utilization, for the usage meter.
 *
 * A window appears only when the plan caps it, and none appear when the counters
 * cannot be read, so an absent window means "no meter" rather than "0% used".
 * `usedPercent` is 0-100 and may exceed 100 while an account is served past its cap
 * on purchased credit. `resetsAt` is epoch SECONDS.
 */
export interface UsageResponse {
  used?: Record<string, { usedPercent?: number; resetsAt?: number } | null> | null;
  dashboard_url?: string;
}

/** One entry of the models host's public `GET /models` listing. */
export interface BrevilabsModelEntry {
  id?: string;
  label?: string;
  /** Input context window as a display string: `1M`, `256K`. */
  context_length?: string;
}

export interface BrevilabsModelsResponse {
  data?: BrevilabsModelEntry[];
}

export interface LicenseResponse {
  is_valid: boolean;
  plan: string;
  /** Signed entitlement token (JWS). Absent when the server could not issue one. */
  entitlement?: string;
}

/** Why the plugin is revalidating a stored license. */
export type LicenseCheckTrigger =
  | "startup"
  | "manual"
  | "refresh"
  | "legacy_chat_turn"
  | "multi_agent_per_turn"
  | "tool_call"
  | "model_gate";

/** Product context attached to each license validation request. */
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
  ): Promise<{ data: T | null; error?: Error }> {
    if (!skipLicenseCheck) {
      this.checkLicenseKey();
    }

    body.user_id = getSettings().userId;

    const url = new URL(`${BREVILABS_API_BASE_URL}${endpoint}`);
    if (method === "GET") {
      // Add query parameters for GET requests
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
    formData: FormData,
    skipLicenseCheck = false
  ): Promise<{ data: T | null; error?: Error }> {
    if (!skipLicenseCheck) {
      this.checkLicenseKey();
    }

    // Add user_id to FormData
    formData.append("user_id", getSettings().userId);

    const url = new URL(`${BREVILABS_API_BASE_URL}${endpoint}`);

    try {
      // Build multipart body manually for requestUrl (does not natively support FormData).
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
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Validate the license key and update the entitlement flags (isPaidUser /
   * isPlusUser). A verified signed entitlement determines strict feature access;
   * otherwise a confirmed license remains paid while those features stay closed.
   * @param context Required product context describing why the license key is being validated.
   * @returns true if the license key is valid, false if the license key is invalid, and undefined if
   * unknown error.
   */
  async validateLicenseKey(
    app: App | undefined,
    context: LicenseCheckContext
  ): Promise<{ isValid: boolean | undefined; plan?: string }> {
    // Identity this response will belong to. Validations can overlap (startup,
    // a send-boundary re-check, the user pasting a different key), and every
    // branch below mutates global entitlement state, so a response that outlives
    // the key it was requested for must be discarded rather than applied.
    const requestedLicenseKey = getSettings().plusLicenseKey;

    // Build the request body with proper structure
    const requestBody: Record<string, unknown> = {
      license_key: requestedLicenseKey,
    };

    // Safely spread context if provided, ensuring no conflicts with required fields
    if (context && typeof context === "object") {
      // Filter out any undefined or null values from context
      const filteredContext = Object.fromEntries(
        Object.entries(context).filter(([_, value]) => value !== undefined && value !== null)
      );

      // Remove any reserved fields that must not be overridden by context
      const reservedKeys = new Set(["license_key", "user_id"]);
      for (const key of reservedKeys) {
        if (key in filteredContext) {
          delete (filteredContext as Record<string, unknown>)[key];
        }
      }

      // Spread the filtered context into the request body
      Object.assign(requestBody, filteredContext);
    }

    const { data, error } = await this.makeRequest<LicenseResponse>(
      "/license",
      requestBody,
      "POST",
      true,
      true
    );

    // The key changed under us while this was in flight, so this answer is about
    // a license the user no longer has. Applying it would let a slow response for
    // an eligible key land after a downgraded key's, restoring revoked features
    // (and the token that carries them) for the rest of that token's lifetime.
    if (getSettings().plusLicenseKey !== requestedLicenseKey) {
      return { isValid: undefined };
    }

    if (error) {
      if (error.message === "Invalid license key") {
        turnOffPaid(app);
        return { isValid: false };
      }
      // Do nothing if the error is not about the invalid license key
      return { isValid: undefined };
    }
    if (data?.entitlement) {
      // An unverifiable token is not an authoritative negative, but it cannot
      // grant strict features until its claims can be trusted.
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

  /**
   * Read the account's 5-hour and weekly cap utilization.
   *
   * Talks to the MODELS host, not the tools/license API the rest of this client uses.
   * The caps are enforced by the model proxy on the request path, so their read side
   * lives beside them; `api.brevilabs.com` has no such route and answers 404.
   *
   * Returns null instead of throwing: this feeds a meter, and a meter that cannot be
   * drawn is not an error worth interrupting anyone over. The endpoint is read-only and
   * consumes no quota, so it is safe to poll.
   */
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

  /**
   * The models host's public catalog. Unauthenticated, and the only place the context
   * window of a Copilot Plus model is published, so the usage meter can size its ring.
   *
   * Returns null rather than throwing, for the same reason as {@link getUsage}: this
   * feeds a gauge, and a gauge that cannot be drawn is not an error worth raising.
   */
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
    // Convert ArrayBuffer to base64 string
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
    // Create a FormData object
    const formData = new FormData();

    // Convert ArrayBuffer to Blob with appropriate mime type
    const mimeType = this.getMimeTypeFromExtension(fileType);
    const blob = new Blob([binaryContent], { type: mimeType });

    // Create a File object with a filename including the extension
    const fileName = `file.${fileType}`;
    const file = new File([blob], fileName, { type: mimeType });

    // Append the file to FormData
    formData.append("files", file);

    // Add file_type as a regular field
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
