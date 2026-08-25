/**
 * Dispatches the "list available model ids from the live endpoint"
 * request to the right per-provider adapter, so the BYOK setup dialog
 * can auto-populate its model picker without caring about the wire
 * shape differences (`{ data: [{ id }] }` vs `{ models: [{ name }] }`).
 *
 * Every provider type this dispatches on can be listed over plain HTTP, so the
 * dialog always gets a result to work from; a provider that answers badly
 * surfaces as `ok: false` rather than an absent answer.
 */

import type { ProviderType } from "@/modelManagement/types/catalog";
import { listAnthropicModels } from "./listAnthropicModels";
import { listGoogleModels } from "./listGoogleModels";
import type { ListModelsResult } from "./listOpenAICompatibleModels";
import { listOpenAICompatibleModels } from "./listOpenAICompatibleModels";

export interface ListProviderModelsOptions {
  apiKey?: string | null;
  /** Per-provider extras (currently used only for OpenAI org id). */
  extras?: Record<string, unknown>;
  timeoutMs?: number;
}

export async function listProviderModels(
  providerType: ProviderType,
  baseUrl: string,
  opts: ListProviderModelsOptions = {}
): Promise<ListModelsResult> {
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
  }
}
