import type { AgentHarness } from "@earendil-works/pi-agent-core";

/**
 * Field the OpenAI-compatible API uses to pin a conversation to one cache
 * bucket. Sending a stable value per conversation is what lets a provider
 * charge later turns as cache reads instead of fresh input.
 */
const CACHE_KEY_FIELD = "prompt_cache_key";

/**
 * Stamp every provider request from this conversation with the same cache key.
 * Registered as a payload hook rather than a request header because the field
 * belongs in the request body the proxy forwards upstream.
 *
 * @param harness the conversation whose requests get stamped
 * @param cacheKey stable id for this conversation; must not change between turns
 * @returns an unsubscribe function
 */
export function installPromptCacheKey(
  harness: Pick<AgentHarness, "on">,
  cacheKey: string
): () => void {
  return harness.on("before_provider_payload", (event) => {
    if (typeof event.payload !== "object" || event.payload === null) return undefined;
    return { payload: { ...event.payload, [CACHE_KEY_FIELD]: cacheKey } };
  });
}
