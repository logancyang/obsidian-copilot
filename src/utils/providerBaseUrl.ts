/**
 * Per-consumer normalization for a stored provider base URL.
 *
 * One persisted `Provider.baseUrl` feeds two SDK stacks with opposite
 * conventions (logancyang/obsidian-copilot-preview#152):
 *
 * - The legacy-chat LangChain clients for Google and Groq append their own
 *   version path (`ChatGoogleGenerativeAI` adds `/v1beta`, groq-sdk adds
 *   `/openai/v1`), so they need the HOST-ONLY form — a versioned base URL
 *   doubles the path and 404s.
 * - opencode's AI SDK providers treat `baseURL` as the complete prefix and
 *   append only the route, so they need the VERSIONED form (the models.dev
 *   `api` convention) — a host-only base URL drops the version segment.
 *
 * Both forms reach persistence: the configure dialog seeds models.dev's
 * versioned `api` URL when the catalog carries one (Groq) and a host-only
 * known default when it doesn't (Google), and users paste either form from
 * provider docs. Persisted rows are left untouched; each consumer normalizes
 * through these helpers instead.
 */

/** Trim and drop trailing slashes; blank input becomes `undefined`. */
function trimBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

/**
 * Host form for `ChatGoogleGenerativeAI`, which appends `/${apiVersion}`
 * (default `v1beta`) itself. Strips a trailing `/v1beta` or `/v1` regardless
 * of origin: a Google-compatible proxy must mirror the `/v1beta/models/…`
 * path shape, so the same stripping holds for it.
 */
export function googleHostBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = trimBaseUrl(baseUrl);
  if (!trimmed) return undefined;
  return trimmed.replace(/\/v1(beta)?$/i, "") || undefined;
}

/**
 * Host form for `ChatGroq`, whose groq-sdk client appends `/openai/v1`
 * itself. Strips a trailing `/openai/v1`, `/openai`, or `/v1`.
 */
export function groqHostBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = trimBaseUrl(baseUrl);
  if (!trimmed) return undefined;
  return trimmed.replace(/(\/openai\/v1|\/openai|\/v1)$/i, "") || undefined;
}

/**
 * Canonical API origins for catalog providers whose endpoints we know.
 * Used to recognize "this base URL is the provider's own endpoint in some
 * spelling" as opposed to a genuine proxy/gateway override.
 */
const CATALOG_DEFAULT_ORIGINS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com",
  openai: "https://api.openai.com",
};

/**
 * Path spellings that still mean "the default endpoint": bare host plus any
 * known version/prefix segment a user (or our own seeding) might include.
 */
const DEFAULT_ENDPOINT_PATHS = new Set(["", "/v1", "/v1beta", "/openai", "/openai/v1"]);

/**
 * `true` when `baseUrl` points at the catalog provider's own canonical API
 * endpoint (any version-suffix / trailing-slash / case spelling). Callers
 * with a more reliable default for that provider — opencode's models.dev
 * registry — can then drop the stored value rather than guess which path
 * form it needs. Unknown catalog ids, non-default paths, and unparseable
 * URLs return `false` so genuine overrides are always forwarded.
 */
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
