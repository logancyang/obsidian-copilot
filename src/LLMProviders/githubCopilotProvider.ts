// Based on the flow used in Pierrad/obsidian-github-copilot
// Handles device code flow, token exchange, and chat requests

import { getSettings, updateSetting } from "@/settings/model";
import { requestUrl, Notice } from "obsidian";

const CLIENT_ID = "Iv1.b507a08c87ecfe98"; // Copilot VSCode client ID
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const CHAT_COMPLETIONS_URL = "https://api.githubcopilot.com/chat/completions";

export interface CopilotAuthState {
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  expiresIn?: number;
  interval?: number;
  accessToken?: string;
  copilotToken?: string;
  copilotTokenExpiresAt?: number;
  status: "idle" | "pending" | "authenticated" | "error";
  error?: string;
}

export class GitHubCopilotProvider {
  private authState: CopilotAuthState = { status: "idle" };

  constructor() {
    // Load persisted tokens from settings
    const settings = getSettings();
    if (settings.copilotAccessToken && settings.copilotToken) {
      this.authState.accessToken = settings.copilotAccessToken;
      this.authState.copilotToken = settings.copilotToken;
      this.authState.copilotTokenExpiresAt = settings.copilotTokenExpiresAt;
      if (settings.copilotTokenExpiresAt && settings.copilotTokenExpiresAt > Date.now()) {
        this.authState.status = "authenticated";
      }
    }
  }

  getAuthState() {
    return this.authState;
  }

  // Step 1: Start device code flow
  async startDeviceCodeFlow() {
    this.authState.status = "pending";
    try {
      const res = await requestUrl({
        url: DEVICE_CODE_URL,
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID, scope: "read:user" }),
      });
      if (res.status !== 200) throw new Error("Failed to get device code");
      const data = res.json;
      this.authState.deviceCode = data.device_code;
      this.authState.userCode = data.user_code;
      this.authState.verificationUri = data.verification_uri || data.verification_uri_complete;
      this.authState.expiresIn = data.expires_in;
      this.authState.interval = data.interval;
      this.authState.status = "pending";
      return {
        userCode: data.user_code,
        verificationUri: data.verification_uri || data.verification_uri_complete,
      };
    } catch (e: any) {
      this.authState.status = "error";
      this.authState.error = e.message;
      throw e;
    }
  }

  // Step 2: Poll for access token
  async pollForAccessToken() {
    if (!this.authState.deviceCode) throw new Error("No device code");

    new Notice("Waiting for you to authorize in the browser...", 15000);

    const poll = async () => {
      const res = await requestUrl({
        url: ACCESS_TOKEN_URL,
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: this.authState.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = res.json;
      if (data.error === "authorization_pending") return null;
      if (data.error) throw new Error(data.error_description || data.error);
      return data.access_token;
    };
    const interval = this.authState.interval || 5;
    const expiresAt = Date.now() + (this.authState.expiresIn || 900) * 1000;
    while (Date.now() < expiresAt) {
      const token = await poll();
      if (token) {
        this.authState.accessToken = token;
        // Persist access token
        updateSetting("copilotAccessToken", token);
        return token;
      }
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }
    throw new Error("Device code expired");
  }

  // Step 3: Exchange for Copilot token
  async fetchCopilotToken() {
    if (!this.authState.accessToken) throw new Error("No access token");
    const res = await requestUrl({
      url: COPILOT_TOKEN_URL,
      method: "GET",
      headers: { Authorization: `Bearer ${this.authState.accessToken}` },
    });
    if (res.status !== 200) throw new Error("Failed to get Copilot token");
    const data = res.json;
    this.authState.copilotToken = data.token;
    this.authState.copilotTokenExpiresAt =
      Date.now() + (data.expires_at ? data.expires_at * 1000 : 3600 * 1000);
    this.authState.status = "authenticated";
    // Persist Copilot token and expiration
    updateSetting("copilotToken", data.token);
    updateSetting("copilotTokenExpiresAt", this.authState.copilotTokenExpiresAt);
    return data.token;
  }

  // Step 4: Send chat message
  async sendChatMessage(messages: { role: string; content: string }[], model = "gpt-4") {
    if (!this.authState.copilotToken) throw new Error("Not authenticated with Copilot");
    const res = await requestUrl({
      url: CHAT_COMPLETIONS_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.authState.copilotToken}`,
        "User-Agent": "vscode/1.80.1",
        "Editor-Version": "vscode/1.80.1",
        "OpenAI-Intent": "conversation-panel",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });
    if (res.status !== 200) throw new Error("Copilot chat request failed");
    const data = res.json;
    return data;
  }

  // Utility: Reset authentication state
  resetAuth() {
    this.authState = { status: "idle" };
    // Clear persisted tokens
    updateSetting("copilotAccessToken", "");
    updateSetting("copilotToken", "");
    updateSetting("copilotTokenExpiresAt", 0);
  }
}
