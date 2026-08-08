/**
 * Dispatches the "list available model ids from the live endpoint"
 * request to the right per-provider adapter, so the BYOK setup dialog
 * can auto-populate its model picker without caring about the wire
 * shape differences (`{ data: [{ id }] }` vs `{ models: [{ name }] }`).
 *
 * Returns `null` for provider types we cannot list over plain HTTP
 * (Bedrock needs SigV4 region awareness; Azure needs the deployment
 * URL + a different endpoint). Callers treat null as "skip auto-fetch"
 * — the picker is still functional via catalog metadata + manual add.
 */

import type { ProviderType } from "@/modelManagement/types/catalog";
import { listAnthropicModels } from "./listAnthropicModels";
import { listGoogleModels } from "./listGoogleModels";
import type { ListModelsResult } from "./listOpenAICompatibleModels";
import { listOpenAICompatibleModels } from "./listOpenAICompatibleModels";
import { logWarn } from "@/logger";

export interface ListProviderModelsOptions {
  apiKey?: string | null;
  /** Per-provider extras (currently used only for OpenAI org id). */
  extras?: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * `null` => this provider type doesn't expose a listable endpoint; the
 * dialog should skip auto-fetch and rely on catalog + manual add.
 */
export async function listProviderModels(
  providerType: ProviderType,
  baseUrl: string,
  opts: ListProviderModelsOptions = {}
): Promise<ListModelsResult | null> {
  switch (providerType) {
    case "openai-compatible": {
      const openAIOrgId =
        typeof opts.extras?.openAIOrgId === "string" ? opts.extras.openAIOrgId : undefined;
      return listOpenAICompatibleModels(baseUrl, {
        apiKey: opts.apiKey,
        openAIOrgId,
        timeoutMs: opts.timeoutMs,
      });
    }
    case "anthropic":
      return listAnthropicModels(baseUrl, { apiKey: opts.apiKey, timeoutMs: opts.timeoutMs });
    case "google":
      return listGoogleModels(baseUrl, { apiKey: opts.apiKey, timeoutMs: opts.timeoutMs });
    case "azure":
    case "bedrock":
      logWarn(`Listing provider models for ${providerType} is not yet supported`);
      return null;
  }
}
