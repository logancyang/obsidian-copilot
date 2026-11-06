/**
 * Legacy chat (Google, Groq) needs the host-only base URL; opencode needs the versioned one.
 * Persisted rows keep whatever the user pasted and each consumer normalizes.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/152
 */

export function trimBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

export function googleHostBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = trimBaseUrl(baseUrl);
  if (!trimmed) return undefined;
  return trimmed.replace(/\/v1(beta)?$/i, "") || undefined;
}

export function groqHostBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = trimBaseUrl(baseUrl);
  if (!trimmed) return undefined;
  return trimmed.replace(/(\/openai\/v1|\/openai|\/v1)$/i, "") || undefined;
}

// OpenCode hands the saved base URL to each provider's own SDK, and these SDKs expect a different ending than Copilot's clients.
// https://github.com/logancyang/obsidian-copilot/issues/3641
const OPENCODE_SDK_URL_ENDINGS = new Map<string, { copilotEnding: RegExp; sdkEnding: string }>([
  ["aihubmix", { copilotEnding: /\/v1$/i, sdkEnding: "" }],
  ["anthropic", { copilotEnding: /(?<!\/v1)$/i, sdkEnding: "/v1" }],
  ["cohere", { copilotEnding: /\/compatibility\/v1$/i, sdkEnding: "/v2" }],
  ["google", { copilotEnding: /(?<!\/v1(?:alpha|beta)?)$/i, sdkEnding: "/v1beta" }],
]);

export function opencodeSdkBaseUrl(
  catalogProviderId: string | undefined,
  baseUrl: string | undefined
): string | undefined {
  const endings = catalogProviderId ? OPENCODE_SDK_URL_ENDINGS.get(catalogProviderId) : undefined;
  if (!endings) return baseUrl;
  return trimBaseUrl(baseUrl)?.replace(endings.copilotEnding, endings.sdkEnding);
}

const CATALOG_DEFAULT_ORIGINS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com",
  openai: "https://api.openai.com",
};

const DEFAULT_ENDPOINT_PATHS = new Set(["", "/v1", "/v1beta", "/openai", "/openai/v1"]);

export function isCatalogProviderDefaultEndpoint(
  catalogProviderId: string | undefined,
  baseUrl: string
): boolean {
  if (!catalogProviderId) return false;
  const defaultOrigin = CATALOG_DEFAULT_ORIGINS[catalogProviderId];
  if (!defaultOrigin) return false;
  try {
    const url = new URL(baseUrl.trim());
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return url.origin === defaultOrigin && DEFAULT_ENDPOINT_PATHS.has(path);
  } catch {
    return false;
  }
}
