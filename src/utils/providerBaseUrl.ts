/**
 * Legacy chat (Google, Groq) needs the host-only base URL; opencode needs the versioned one.
 * Persisted rows keep whatever the user pasted and each consumer normalizes.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/152
 */

function trimBaseUrl(baseUrl: string | undefined): string | undefined {
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
