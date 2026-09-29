import type { ProviderType } from "@/modelManagement/types/catalog";
import { listAnthropicModels } from "./listAnthropicModels";
import { listGoogleModels } from "./listGoogleModels";
import type { ListModelsResult } from "./listOpenAICompatibleModels";
import { listOpenAICompatibleModels } from "./listOpenAICompatibleModels";

export interface ListProviderModelsOptions {
  apiKey?: string | null;
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
