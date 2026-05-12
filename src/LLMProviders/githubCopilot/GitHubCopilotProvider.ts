import { getSettings, setSettings } from "@/settings/model";
import { getDecryptedKey } from "@/encryptionService";
import { GitHubCopilotModelResponse } from "@/settings/providerModels";
import { requestUrl, type RequestUrlResponse } from "obsidian";
import { AuthCancelledError } from "./errors";

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
export const COPILOT_API_BASE = "https://api.githubcopilot.com";
const MODELS_URL = `${COPILOT_API_BASE}/models`;

// Token refresh buffer: refresh 1 minute before expiration
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
// Default token expiration: 1 hour
const DEFAULT_TOKEN_EXPIRATION_MS = 60 * 60 * 1000;
// Maximum refresh attempts before giving up
const MAX_REFRESH_ATTEMPTS = 3;

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

/**
 * GitHubCopilotProvider handles:
 * - GitHub OAuth device code flow
 * - Token management (access token + copilot token)
 * - Model listing
 *
 * Chat requests are handled by GitHubCopilotChatModel / GitHubCopilotResponsesModel,
 * which use this provider for token lifecycle via buildCopilotRequestHeaders/getValidCopilotToken.
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
   * Cache of model policy terms keyed by model ID.
   * Populated after each listModels() call. Used to surface helpful
   * "enable this model" guidance when a 400 "not supported" error occurs.
   */
  private modelPolicyTermsCache = new Map<string, string>();
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
        errorDetail
          ? `Failed to get device code: ${errorDetail}`
          : `Failed to get device code: ${res.status}`
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
          throw new AuthCancelledError();
        }

        attempt++;
        onPoll?.(attempt);

        await this.delay(interval * 1000, controller.signal);

        // Check again after delay
        if (controller.signal.aborted || this.authGeneration !== currentGeneration) {
          throw new AuthCancelledError();
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
          throw new AuthCancelledError();
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
            throw new AuthCancelledError();
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
      throw new AuthCancelledError("Authentication was reset during token refresh.");
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
      throw new AuthCancelledError("Authentication was reset during token refresh.");
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
      "User-Agent": "GitHubCopilotChat/0.38.2026022001",
      "Editor-Version": "vscode/1.110.0",
      "Editor-Plugin-Version": "copilot-chat/0.38.2026022001",
      "Copilot-Integration-Id": "vscode-chat",
      "Openai-Intent": "conversation-panel",
      "X-GitHub-Api-Version": "2025-05-01",
    };
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
    this.modelPolicyTermsCache.clear();
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
          ...this.buildCopilotHeaders(token),
          Accept: "application/json",
          // Reason: VSCode Copilot uses "model-access" intent when listing models,
          // which may return additional fields (billing, is_chat_default, etc.)
          "Openai-Intent": "model-access",
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

    const result = this.getRequestUrlJson(res) as GitHubCopilotModelResponse;

    // Cache policy terms for each model so they can be surfaced in error messages.
    this.modelPolicyTermsCache.clear();
    result.data?.forEach((model) => {
      if (model.policy?.terms) {
        this.modelPolicyTermsCache.set(model.id, model.policy.terms);
      }
    });

    return result;
  }

  /**
   * Get the policy terms for a model, if available.
   * Returns the human-readable guidance text (may include Markdown links)
   * that explains how the user can enable the model on GitHub's settings page.
   */
  getPolicyTerms(modelId: string): string | undefined {
    return this.modelPolicyTermsCache.get(modelId);
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
   * Build headers required for GitHub Copilot API requests.
   * Public wrapper around the private buildCopilotHeaders method,
   * exposed for use by ChatOpenAI-based models that inject auth via configuration.fetch.
   */
  buildCopilotRequestHeaders(token: string): Record<string, string> {
    return this.buildCopilotHeaders(token);
  }

  /**
   * Invalidate the cached Copilot token so the next request forces a refresh.
   * Public wrapper around clearCopilotToken, used by the fetch wrapper
   * to implement "401 → refresh token → retry once" logic.
   */
  invalidateCopilotToken(): void {
    this.clearCopilotToken();
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
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    if (signal.aborted) {
      return Promise.reject(new AuthCancelledError());
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        window.clearTimeout(timeoutId);
        reject(new AuthCancelledError());
      };

      const timeoutId = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
