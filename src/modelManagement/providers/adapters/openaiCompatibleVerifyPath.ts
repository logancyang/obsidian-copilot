/**
 * Per-provider verification path for OpenAI-compatible endpoints.
 *
 * Most hosted OpenAI-compatible providers (OpenAI, Groq, Mistral, DeepSeek,
 * xAI) gate `GET /models` behind the API key, so verify-via-`/models` proves
 * the key is valid. OpenRouter is the notable exception: its `/models` is
 * public and returns 200 for any (or no) `Authorization`, so a blank/wrong key
 * would read as "Verified". OpenRouter exposes `GET /api/v1/key` which 401s on
 * a bad key and 200s on a valid one, so we probe `/key` for it instead.
 *
 * Data-driven by `catalogProviderId` so adding another public-`/models`
 * provider is a one-line entry, never an `if (openrouter)` branch.
 */

/** The path suffix appended to the provider's base URL when verifying. */
export type VerifyPath = "models" | "key";

const DEFAULT_VERIFY_PATH: VerifyPath = "models";

/** Catalog provider ids whose `/models` is public → verify against an
 *  auth-gated endpoint instead. */
const VERIFY_PATH_BY_CATALOG_ID: Record<string, VerifyPath> = {
  openrouter: "key",
};

/**
 * The verification path for a given catalog provider id. Returns `"models"`
 * for everything not in the override map (including custom endpoints with no
 * catalog id).
 */
export function verifyPathForCatalogProviderId(catalogProviderId: string | undefined): VerifyPath {
  if (!catalogProviderId) return DEFAULT_VERIFY_PATH;
  return VERIFY_PATH_BY_CATALOG_ID[catalogProviderId] ?? DEFAULT_VERIFY_PATH;
}
