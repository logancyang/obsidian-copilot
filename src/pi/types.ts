import type { PiTool, PiToolContext } from "@/pi/tools";
import type { Model, Models } from "@earendil-works/pi-ai";

/**
 * Minimal structural view of the response fields this module reads. Declared
 * instead of reusing the DOM `Response` so callers can inject a plain object
 * in tests without constructing a real one.
 */
export interface PiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Injected network access, satisfied by the platform `fetch`. */
export type PiFetch = (url: string) => Promise<PiFetchResponse>;

/**
 * A Copilot Plus catalog model. pi's `Model` has no description field, so the
 * catalog's human-readable blurb rides along as an extra property that pi
 * carries through opaquely.
 */
export interface PiCatalogModel extends Model<"openai-completions"> {
  description?: string;
}

/** One user-configured OpenAI-compatible endpoint to expose as a pi provider. */
export interface PiByokProvider {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  modelIds: readonly string[];
}

/**
 * Everything the provider collection needs from the host. Passing these in
 * keeps the engine free of Copilot settings and singletons so it can run on
 * mobile and be exercised without a live vault.
 */
export interface PiProviderDeps {
  /** Decrypted Copilot Plus license key, used as the bearer for Plus models. */
  plusLicenseKey: string;
  byokProviders: readonly PiByokProvider[];
  fetch: PiFetch;
}

/** A model offered by the engine, flattened for host-side pickers. */
export interface PiModelEntry {
  id: string;
  providerId: string;
  label: string;
  description?: string;
  contextWindow: number;
  supportsImages: boolean;
  supportsReasoning: boolean;
}

/** Token accounting for the most recent assistant response. */
export interface PiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextTokens: number;
  contextWindow: number;
}

export interface PiEngineOptions {
  models: Models;
  /** Model the first turn runs on; must exist in `models`. */
  modelId: string;
  systemPrompt?: string;
  /** Tools offered to the model. Order is preserved so the tool block stays cacheable. */
  tools?: readonly PiTool[];
  /** Host dependencies the tools execute against. Required whenever `tools` is set. */
  toolContext?: PiToolContext;
}
