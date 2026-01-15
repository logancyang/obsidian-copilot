import { getSettings, setSettings } from "@/settings/model";
import { getDecryptedKey } from "@/encryptionService";
import { GitHubCopilotModelResponse } from "@/settings/providerModels";
import { requestUrl, type RequestUrlResponse } from "obsidian";
import { createParser, type ParsedEvent, type ReconnectInterval } from "eventsource-parser";

/**
 * GitHub Copilot OAuth Client ID (from VSCode).
 * WARNING: This is VSCode's OAuth client ID. Using it in third-party apps
 * may violate GitHub's Terms of Service. GitHub could revoke this at any time.
 * This integration is unofficial and provided "as-is" without guarantees.
 */
const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_API_BASE = "https://api.githubcopilot.com";
const CHAT_COMPLETIONS_URL = `${COPILOT_API_BASE}/chat/completions`;
const MODELS_URL = `${COPILOT_API_BASE}/models`;

// Token refresh buffer: refresh 1 minute before expiration
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
// Default token expiration: 1 hour
const DEFAULT_TOKEN_EXPIRATION_MS = 60 * 60 * 1000;
// Maximum refresh attempts before giving up
const MAX_REFRESH_ATTEMPTS = 3;

// Common HTTP status error messages for Copilot API
const HTTP_STATUS_MESSAGES: Record<number, string> = {
  401: "Authentication failed - token may be expired",
  403: "Access denied - check your Copilot subscription",
  429: "Rate limited - please wait before retrying",
};

interface GitHubDeviceCodeApiResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface GitHubOAuthTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface CopilotTokenApiResponse {
  token?: string;
  expires_at?: number | string;
  expires_in?: number | string;
  error?: string;
  message?: string;
}

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface CopilotAuthState {
  status: "idle" | "pending" | "authenticated" | "error";
  error?: string;
}

export interface CopilotChatResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens: number;
    };
  };
  model?: string;
  created?: number;
  id?: string;
}

export interface CopilotStreamChunk {
  choices: Array<{
    index: number;
    delta: {
      content?: string | null;
      role?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
  created?: number;
  id?: string;
}

/**
 * GitHubCopilotProvider handles:
 * - GitHub OAuth device code flow
 * - Token management (access token + copilot token)
 * - Chat API calls
 *
 * WARNING: This uses GitHub Copilot's internal API which is not officially
 * supported for third-party applications. Use at your own risk.
 */
export class GitHubCopilotProvider {
  private static instance: GitHubCopilotProvider;
  /** AbortController for cancelling ongoing polling operations */
  private abortController: AbortController | null = null;
  private refreshPromise: Promise<string> | null = null;
  private refreshAttempts = 0;
  /**
   * Auth generation counter - incremented on reset to invalidate in-flight operations.
   * This prevents race conditions where an async operation completes after resetAuth()
   * and accidentally writes back tokens.
   */
  private authGeneration = 0;

  private constructor() {}

  static getInstance(): GitHubCopilotProvider {
    if (!GitHubCopilotProvider.instance) {
      GitHubCopilotProvider.instance = new GitHubCopilotProvider();
    }
    return GitHubCopilotProvider.instance;
  }

  /**
   * Get current authentication state based on stored tokens
   * Returns authenticated only if we have a valid copilot token or can refresh it
   */
  getAuthState(): CopilotAuthState {
    const settings = getSettings();
    const hasAccessToken = Boolean(settings.githubCopilotAccessToken);
    const hasCopilotToken = Boolean(settings.githubCopilotToken);
    const tokenExpiresAt = settings.githubCopilotTokenExpiresAt;
    // Use same expiry logic as getValidCopilotToken: treat missing/invalid expiresAt as expired
    const hasKnownExpiry = typeof tokenExpiresAt === "number" && tokenExpiresAt > 0;
    const isExpired = !hasKnownExpiry || tokenExpiresAt < Date.now();

    // Authenticated if:
    // - we have a valid copilot token, OR
    // - we have a copilot token (even if expired/unknown expiry) AND we can refresh it via access token.
    // Pending if we only have access token but haven't fetched copilot token yet.
    if ((hasCopilotToken && !isExpired) || (hasCopilotToken && hasAccessToken)) {
      return { status: "authenticated" };
    }
    if (hasAccessToken) {
      return { status: "pending" };
    }
    return { status: "idle" };
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.getAuthState().status === "authenticated";
  }

  /**
   * Step 1: Start device code flow
   * Returns device code info for user to authorize
   */
  async startDeviceCodeFlow(): Promise<DeviceCodeResponse> {
    // GitHub OAuth requires application/x-www-form-urlencoded
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: "read:user",
    }).toString();

    const res = await requestUrl({
      url: DEVICE_CODE_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      throw: false,
    });

    const data = this.getRequestUrlJson(res) as Partial<GitHubDeviceCodeApiResponse>;

    if (res.status !== 200) {
      const errorDetail =
        typeof data.error_description === "string"
          ? data.error_description
          : typeof data.error === "string"
            ? data.error
            : "";
      throw new Error(
        errorDetail ? `Failed to get device code: ${errorDetail}` : `Failed to get device code: ${res.status}`
      );
    }

    if (
      typeof data.device_code !== "string" ||
      typeof data.user_code !== "string" ||
      typeof data.expires_in !== "number"
    ) {
      throw new Error("Invalid device code response from GitHub");
    }

    const verificationUri =
      typeof data.verification_uri === "string"
        ? data.verification_uri
        : typeof data.verification_uri_complete === "string"
          ? data.verification_uri_complete
          : null;
    if (!verificationUri) {
      throw new Error("Invalid device code response from GitHub: missing verification URI");
    }

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri,
      expiresIn: data.expires_in,
      interval: typeof data.interval === "number" && data.interval > 0 ? data.interval : 5,
    };
  }

  /**
   * Step 2: Poll for access token after user authorizes
   * @param deviceCode - Device code from step 1
   * @param interval - Polling interval in seconds
   * @param expiresIn - Expiration time in seconds
   * @param onPoll - Callback for each poll attempt
   */
  async pollForAccessToken(
    deviceCode: string,
    interval: number,
    expiresIn: number,
    onPoll?: (attempt: number) => void
  ): Promise<string> {
    // Capture current auth generation to detect if reset was called
    const currentGeneration = this.authGeneration;

    // Abort any existing polling session before starting a new one
    this.abortPolling();

    // Create new AbortController for this polling session
    const controller = new AbortController();
    this.abortController = controller;
    const expiresAt = Date.now() + expiresIn * 1000;
    let attempt = 0;

    try {
      while (Date.now() < expiresAt) {
        // Check abort signal or generation change
        if (controller.signal.aborted || this.authGeneration !== currentGeneration) {
          throw new Error("Authentication cancelled by user.");
        }

        attempt++;
        onPoll?.(attempt);

        await this.delay(interval * 1000, controller.signal);

        // Check again after delay
        if (controller.signal.aborted || this.authGeneration !== currentGeneration) {
          throw new Error("Authentication cancelled by user.");
        }

        // GitHub OAuth requires application/x-www-form-urlencoded
        const body = new URLSearchParams({
          client_id: CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString();

        const res = await requestUrl({
          url: ACCESS_TOKEN_URL,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
          throw: false,
        });

        // Check abort after HTTP request completes
        if (controller.signal.aborted || this.authGeneration !== currentGeneration) {
          throw new Error("Authentication cancelled by user.");
        }

        const data = this.getRequestUrlJson(res) as Partial<GitHubOAuthTokenResponse>;

        // Check HTTP status before processing body
        if (res.status !== 200) {
          const errorMessage =
            typeof data.error_description === "string"
              ? data.error_description
              : typeof data.error === "string"
                ? data.error
                : `HTTP ${res.status}`;
          throw new Error(`Token request failed: ${errorMessage}`);
        }

        if (typeof data.access_token === "string" && data.access_token) {
          // Final check before storing token
          if (controller.signal.aborted || this.authGeneration !== currentGeneration) {
            throw new Error("Authentication cancelled by user.");
          }
          // Store access token
          setSettings({ githubCopilotAccessToken: data.access_token });
          return data.access_token;
        }

        if (data.error === "authorization_pending") {
          // User hasn't authorized yet, continue polling
          continue;
        }

        if (data.error === "slow_down") {
          // Increase interval
          interval += 5;
          continue;
        }

        if (data.error === "device_code_expired" || data.error === "expired_token") {
          throw new Error("Device code expired. Please restart authentication.");
        }

        if (data.error === "access_denied") {
          throw new Error("Authorization denied by user.");
        }

        if (typeof data.error === "string" && data.error) {
          throw new Error(
            typeof data.error_description === "string" && data.error_description
              ? data.error_description
              : data.error
          );
        }
      }

      throw new Error("Device code expired. Please restart authentication.");
    } finally {
      // Clean up abortController when polling ends (success or failure)
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  /**
   * Step 3: Exchange GitHub access token for Copilot token
   */
  async fetchCopilotToken(accessToken?: string): Promise<string> {
    // Capture current auth generation to detect if reset was called during async operations
    const currentGeneration = this.authGeneration;

    let token = accessToken || getSettings().githubCopilotAccessToken;
    if (!token) {
      throw new Error("No GitHub access token available");
    }

    // Decrypt token if it was encrypted
    token = await getDecryptedKey(token);

    const res = await requestUrl({
      url: COPILOT_TOKEN_URL,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      throw: false,
    });

    // Check if auth was reset during the request (generation changed)
    if (this.authGeneration !== currentGeneration) {
      throw new Error("Authentication was reset during token refresh.");
    }

    const data = this.getRequestUrlJson(res) as Partial<CopilotTokenApiResponse>;

    if (res.status !== 200) {
      const detail =
        typeof data.message === "string"
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : "";
      throw new Error(
        detail
          ? `Failed to get Copilot token: ${res.status} (${detail})`
          : `Failed to get Copilot token: ${res.status}`
      );
    }

    const copilotToken = data.token;

    // Validate token response
    if (!copilotToken || typeof copilotToken !== "string") {
      throw new Error("Invalid response from Copilot API: missing or invalid token");
    }

    // Handle expires_at: support numeric seconds/millis, ISO string, and expires_in fallback.
    const expiresAt = this.parseCopilotTokenExpiresAt(data);

    // Final check before storing tokens (generation may have changed)
    if (this.authGeneration !== currentGeneration) {
      throw new Error("Authentication was reset during token refresh.");
    }

    // Store copilot token and expiration
    setSettings({
      githubCopilotToken: copilotToken,
      githubCopilotTokenExpiresAt: expiresAt,
    });

    return copilotToken;
  }

  /**
   * Get valid Copilot token, refreshing if needed.
   * Uses a promise lock to prevent concurrent refresh requests.
   * Includes retry limit to prevent infinite refresh loops.
   */
  async getValidCopilotToken(): Promise<string> {
    const settings = getSettings();
    const tokenExpiresAt = settings.githubCopilotTokenExpiresAt;
    // Treat missing/invalid expiresAt as expired to force refresh
    const hasKnownExpiry = typeof tokenExpiresAt === "number" && tokenExpiresAt > 0;
    const isExpired = !hasKnownExpiry || tokenExpiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS;

    if (settings.githubCopilotToken && !isExpired) {
      // Reset refresh attempts on successful token use
      this.refreshAttempts = 0;
      // Decrypt token before returning
      return await getDecryptedKey(settings.githubCopilotToken);
    }

    // Need to refresh
    if (!settings.githubCopilotAccessToken) {
      throw new Error("Not authenticated with GitHub Copilot. Please set up authentication first.");
    }

    // Check refresh attempt limit
    if (this.refreshAttempts >= MAX_REFRESH_ATTEMPTS) {
      this.refreshAttempts = 0; // Reset for next time
      throw new Error(
        "Failed to refresh Copilot token after multiple attempts. Please try reconnecting."
      );
    }

    // Prevent concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshAttempts++;
    this.refreshPromise = this.fetchCopilotToken().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  /**
   * Build common headers for Copilot API requests
   */
  private buildCopilotHeaders(token: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "GitHubCopilotChat/0.22.2024092501",
      "Editor-Version": "vscode/1.95.1",
      "Copilot-Integration-Id": "vscode-chat",
      "Openai-Intent": "conversation-panel",
    };
  }

  /**
   * Send chat message to Copilot API
   */
  async sendChatMessage(
    messages: Array<{ role: string; content: string }>,
    model: string = "gpt-4o"
  ): Promise<CopilotChatResponse> {
    const doRequest = async (token: string): Promise<RequestUrlResponse> => {
      return await requestUrl({
        url: CHAT_COMPLETIONS_URL,
        method: "POST",
        headers: this.buildCopilotHeaders(token),
        body: JSON.stringify({
          model,
          messages,
          stream: false,
        }),
        throw: false,
      });
    };

    let token = await this.getValidCopilotToken();
    let res = await doRequest(token);

    // 401: clear cached token and retry once
    if (res.status === 401) {
      this.clearCopilotToken();
      token = await this.getValidCopilotToken();
      res = await doRequest(token);
    }

    if (res.status !== 200) {
      const errorData = this.getRequestUrlJson(res);
      let errorDetail = "";
      if (errorData && typeof errorData === "object") {
        const record = errorData as Record<string, unknown>;
        const nestedError = record.error;
        if (nestedError && typeof nestedError === "object") {
          const nestedRecord = nestedError as Record<string, unknown>;
          if (typeof nestedRecord.message === "string") {
            errorDetail = nestedRecord.message;
          }
        }
        if (!errorDetail && typeof record.message === "string") {
          errorDetail = record.message;
        }
        if (!errorDetail) {
          try {
            errorDetail = JSON.stringify(errorData);
          } catch {
            errorDetail = "";
          }
        }
      } else if (typeof errorData === "string") {
        errorDetail = errorData;
      }

      const baseMessage = HTTP_STATUS_MESSAGES[res.status] || `Request failed: ${res.status}`;
      throw new Error(errorDetail ? `${baseMessage}: ${errorDetail}` : baseMessage);
    }

    const data = this.getRequestUrlJson(res);

    // Validate response structure
    if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).choices)) {
      throw new Error("Invalid response from Copilot API: missing choices array");
    }

    return data as CopilotChatResponse;
  }

  /**
   * Send chat message to Copilot API with streaming response.
   * Uses fetch API for true streaming support.
   * @param messages - Chat messages
   * @param model - Model name
   * @param signal - Optional AbortSignal for cancellation
   */
  async *sendChatMessageStream(
    messages: Array<{ role: string; content: string }>,
    model: string = "gpt-4o",
    signal?: AbortSignal
  ): AsyncGenerator<CopilotStreamChunk> {
    const doRequest = async (token: string): Promise<Response> => {
      return await fetch(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          ...this.buildCopilotHeaders(token),
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
        }),
        signal,
      });
    };

    let token = await this.getValidCopilotToken();
    let response = await doRequest(token);

    // 401: clear cached token and retry once
    if (response.status === 401) {
      try {
        await response.body?.cancel();
      } catch {
        // Ignore cancellation errors - body may already be closed
      }
      this.clearCopilotToken();
      token = await this.getValidCopilotToken();
      response = await doRequest(token);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const baseMessage = HTTP_STATUS_MESSAGES[response.status] || `Request failed: ${response.status}`;
      throw new Error(errorText ? `${baseMessage}: ${errorText}` : baseMessage);
    }

    // Verify response is SSE format
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      throw new Error(`Expected text/event-stream but received ${contentType || "unknown"}`);
    }

    if (!response.body) {
      throw new Error("Response body is not available for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Declare chunkQueue before parser to avoid use-before-define issues
    const chunkQueue: CopilotStreamChunk[] = [];
    let receivedDone = false;

    // Use eventsource-parser for robust SSE parsing
    const parser = createParser((event: ParsedEvent | ReconnectInterval) => {
      if (event.type !== "event") {
        return;
      }

      const data = event.data;
      if (data === "[DONE]") {
        receivedDone = true;
        return;
      }

      try {
        const chunk = JSON.parse(data) as CopilotStreamChunk;
        // Store chunk in a queue to be yielded
        chunkQueue.push(chunk);
      } catch {
        // Skip invalid JSON
      }
    });

    try {
      while (true) {
        // Exit early if we received [DONE]
        if (receivedDone) break;

        const { done, value } = await reader.read();
        if (done) break;

        // Feed data to parser
        const text = decoder.decode(value, { stream: true });
        parser.feed(text);

        // Yield all queued chunks
        while (chunkQueue.length > 0) {
          const chunk = chunkQueue.shift();
          if (chunk) {
            yield chunk;
          }
        }
      }

      // Flush decoder at the end
      const finalText = decoder.decode();
      if (finalText) {
        parser.feed(finalText);
        while (chunkQueue.length > 0) {
          const chunk = chunkQueue.shift();
          if (chunk) {
            yield chunk;
          }
        }
      }
    } finally {
      // Cancel the reader to abort any pending reads, then release the lock
      // Wrap in try-catch to avoid overwriting the original error (e.g., AbortError)
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation errors - stream may already be closed
      }
      reader.releaseLock();
    }
  }

  /**
   * Abort any ongoing polling operation
   */
  abortPolling(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Reset authentication - clear all stored tokens and abort any ongoing operations
   */
  resetAuth(): void {
    // Increment generation to invalidate any in-flight async operations
    this.authGeneration++;
    this.abortPolling(); // This will abort any ongoing polling operations
    this.refreshPromise = null;
    this.refreshAttempts = 0;
    setSettings({
      githubCopilotAccessToken: "",
      githubCopilotToken: "",
      githubCopilotTokenExpiresAt: 0,
    });
  }

  /**
   * List available models from GitHub Copilot API
   */
  async listModels(): Promise<GitHubCopilotModelResponse> {
    const doRequest = async (token: string): Promise<RequestUrlResponse> => {
      return await requestUrl({
        url: MODELS_URL,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Copilot-Integration-Id": "vscode-chat",
        },
        throw: false,
      });
    };

    let token = await this.getValidCopilotToken();
    let res = await doRequest(token);

    // 401: clear cached token and retry once
    if (res.status === 401) {
      this.clearCopilotToken();
      token = await this.getValidCopilotToken();
      res = await doRequest(token);
    }

    if (res.status !== 200) {
      throw new Error(`Failed to list models: ${res.status}`);
    }

    return this.getRequestUrlJson(res) as GitHubCopilotModelResponse;
  }

  /**
   * Clear stored Copilot token so the next request forces a refresh.
   */
  private clearCopilotToken(): void {
    setSettings({
      githubCopilotToken: "",
      githubCopilotTokenExpiresAt: 0,
    });
  }

  /**
   * Best-effort JSON extraction from requestUrl responses, which may return an object or a JSON string.
   * @param response - Obsidian requestUrl response.
   * @returns Parsed JSON value, or the original `response.json` value if parsing is not possible.
   */
  private getRequestUrlJson(response: RequestUrlResponse): unknown {
    if (typeof response.json === "string") {
      try {
        return JSON.parse(response.json);
      } catch {
        return response.json;
      }
    }
    return response.json;
  }

  /**
   * Parse the Copilot token expiry timestamp from the token endpoint response.
   * Supports numeric seconds/milliseconds `expires_at`, ISO string `expires_at`, and `expires_in` seconds.
   * @param data - Parsed JSON response from Copilot token endpoint.
   */
  private parseCopilotTokenExpiresAt(data: unknown): number {
    if (!data || typeof data !== "object") {
      return Date.now() + DEFAULT_TOKEN_EXPIRATION_MS;
    }

    const record = data as Record<string, unknown>;

    const expiresAt = this.parseExpiresAtValue(record.expires_at);
    if (expiresAt !== null) {
      return expiresAt;
    }

    const expiresInRaw = record.expires_in;
    const expiresInSeconds =
      typeof expiresInRaw === "number"
        ? expiresInRaw
        : typeof expiresInRaw === "string"
          ? Number(expiresInRaw)
          : Number.NaN;
    if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
      return Date.now() + expiresInSeconds * 1000;
    }

    return Date.now() + DEFAULT_TOKEN_EXPIRATION_MS;
  }

  /**
   * Parse `expires_at` value which may be seconds, milliseconds, or an ISO string.
   * @param expiresAt - Raw expires_at value.
   * @returns Milliseconds since epoch, or null if parsing fails.
   */
  private parseExpiresAtValue(expiresAt: unknown): number | null {
    if (typeof expiresAt === "number") {
      if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
        return null;
      }
      return expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
    }

    if (typeof expiresAt === "string") {
      const trimmed = expiresAt.trim();
      if (!trimmed) return null;

      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 1e12 ? numeric : numeric * 1000;
      }

      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return null;
  }

  /**
   * Delay that can be cancelled via AbortSignal.
   * @param ms - Duration in milliseconds.
   * @param signal - Optional cancellation signal.
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    if (signal.aborted) {
      return Promise.reject(new Error("Authentication cancelled by user."));
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeoutId);
        reject(new Error("Authentication cancelled by user."));
      };

      const timeoutId = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
