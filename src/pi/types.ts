import type { PiTool, PiToolContext } from "@/pi/tools";
import type { Session } from "@earendil-works/pi-agent-core";
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

/**
 * Vault file operations the transcript store needs. Modelled on Obsidian's
 * adapter rather than node's `fs` so the same code path works on a phone.
 */
export interface PiFileStore {
  /**
   * Folder transcripts are written to. Resolved by the host, because the
   * Obsidian config folder is user-configurable and must never be hardcoded.
   */
  readonly dir: string;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
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
  /**
   * Conversation store. Omitted for a throwaway conversation, which then lives
   * only in memory.
   */
  session?: Session;
}
