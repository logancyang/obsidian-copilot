import { getSettings, updateSetting } from "@/settings/model";
import { getDecryptedKey } from "@/encryptionService";
import { GitHubCopilotModelResponse } from "@/settings/providerModels";
import { requestUrl } from "obsidian";

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
    const tokenExpiresAt = settings.githubCopilotTokenExpiresAt || 0;
    const isExpired = tokenExpiresAt > 0 && tokenExpiresAt < Date.now();

    // Authenticated if we have a valid copilot token OR we have access token to refresh
    if ((hasCopilotToken && !isExpired) || hasAccessToken) {
      return { status: "authenticated" };
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
    });

    if (res.status !== 200) {
      throw new Error(`Failed to get device code: ${res.status}`);
    }

    const data = res.json;
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri || data.verification_uri_complete,
      expiresIn: data.expires_in,
      interval: data.interval || 5,
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

        await this.delay(interval * 1000);

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
        });

        // Check abort after HTTP request completes
        if (controller.signal.aborted || this.authGeneration !== currentGeneration) {
          throw new Error("Authentication cancelled by user.");
        }

        // Check HTTP status before parsing JSON
        if (res.status !== 200) {
          let errorMessage = `HTTP ${res.status}`;
          try {
            const errorData = res.json;
            if (errorData.error_description) {
              errorMessage = errorData.error_description;
            } else if (errorData.error) {
              errorMessage = errorData.error;
            }
          } catch {
            // Cannot parse JSON, use status code
          }
          throw new Error(`Token request failed: ${errorMessage}`);
        }

        const data = res.json;

        if (data.access_token) {
          // Final check before storing token
          if (controller.signal.aborted || this.authGeneration !== currentGeneration) {
            throw new Error("Authentication cancelled by user.");
          }
          // Store access token
          updateSetting("githubCopilotAccessToken", data.access_token);
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

        if (data.error) {
          throw new Error(data.error_description || data.error);
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
    });

    // Check if auth was reset during the request (generation changed)
    if (this.authGeneration !== currentGeneration) {
      throw new Error("Authentication was reset during token refresh.");
    }

    if (res.status !== 200) {
      throw new Error(`Failed to get Copilot token: ${res.status}`);
    }

    const data = res.json;
    const copilotToken = data.token;

    // Validate token response
    if (!copilotToken || typeof copilotToken !== "string") {
      throw new Error("Invalid response from Copilot API: missing or invalid token");
    }

    // Handle expires_at: could be seconds, milliseconds, or string timestamp
    const rawExpiresAt = Number(data.expires_at);
    let expiresAt: number;
    if (Number.isFinite(rawExpiresAt) && rawExpiresAt > 0) {
      // Determine if it's seconds or milliseconds based on magnitude
      expiresAt = rawExpiresAt > 1e12 ? rawExpiresAt : rawExpiresAt * 1000;
    } else {
      // Invalid or missing expires_at, use default
      expiresAt = Date.now() + DEFAULT_TOKEN_EXPIRATION_MS;
    }

    // Final check before storing tokens (generation may have changed)
    if (this.authGeneration !== currentGeneration) {
      throw new Error("Authentication was reset during token refresh.");
    }

    // Store copilot token and expiration
    updateSetting("githubCopilotToken", copilotToken);
    updateSetting("githubCopilotTokenExpiresAt", expiresAt);

    return copilotToken;
  }

  /**
   * Get valid Copilot token, refreshing if needed.
   * Uses a promise lock to prevent concurrent refresh requests.
   * Includes retry limit to prevent infinite refresh loops.
   */
  async getValidCopilotToken(): Promise<string> {
    const settings = getSettings();
    const tokenExpiresAt = settings.githubCopilotTokenExpiresAt || 0;
    const isExpired = tokenExpiresAt > 0 && tokenExpiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS;

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
   * Send chat message to Copilot API
   */
  async sendChatMessage(
    messages: Array<{ role: string; content: string }>,
    model: string = "gpt-4o"
  ): Promise<{
    choices: Array<{
      message: { role: string; content: string };
      finish_reason: string;
    }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }> {
    const token = await this.getValidCopilotToken();

    const res = await requestUrl({
      url: CHAT_COMPLETIONS_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "GitHubCopilotChat/0.22.2024092501",
        "Editor-Version": "vscode/1.95.1",
        "Copilot-Integration-Id": "vscode-chat",
        "Openai-Intent": "conversation-panel",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    if (res.status !== 200) {
      let errorDetail = "";
      try {
        const errorData = res.json;
        errorDetail =
          errorData.error?.message || errorData.message || JSON.stringify(errorData);
      } catch {
        // Cannot parse JSON
      }

      const statusMessages: Record<number, string> = {
        401: "Authentication failed - token may be expired",
        403: "Access denied - check your Copilot subscription",
        429: "Rate limited - please wait before retrying",
      };

      const baseMessage = statusMessages[res.status] || `Request failed: ${res.status}`;
      throw new Error(errorDetail ? `${baseMessage}: ${errorDetail}` : baseMessage);
    }

    return res.json;
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
    updateSetting("githubCopilotAccessToken", "");
    updateSetting("githubCopilotToken", "");
    updateSetting("githubCopilotTokenExpiresAt", 0);
  }

  /**
   * List available models from GitHub Copilot API
   */
  async listModels(): Promise<GitHubCopilotModelResponse> {
    const token = await this.getValidCopilotToken();

    const res = await requestUrl({
      url: MODELS_URL,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Copilot-Integration-Id": "vscode-chat",
      },
    });

    if (res.status !== 200) {
      throw new Error(`Failed to list models: ${res.status}`);
    }

    return res.json as GitHubCopilotModelResponse;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
