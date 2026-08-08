/**
 * Catalog types — transient, setup-time only.
 *
 * The catalog (e.g. `models.dev`) is consumed during the BYOK / agent /
 * Plus setup flows to scaffold defaults. Once a model is configured, its
 * metadata is snapshotted onto the persisted `ConfiguredModel.info` row
 * and the catalog is never consulted again. Nothing in this file is
 * persisted to disk.
 */

/**
 * Closed dispatch set the chat-model factory switches on.
 *
 * The user never types this — the BYOK / agent / Plus setup wizard
 * assigns it from the catalog (via the `npm` field on `models.dev`
 * entries) or from a built-in template (Ollama, LMStudio, Custom
 * OpenAI-compatible, Azure OpenAI, AWS Bedrock).
 *
 *   "anthropic"          → @langchain/anthropic
 *   "openai-compatible"  → @langchain/openai with custom baseUrl
 *                          (OpenAI, Mistral, Groq, OpenRouter, Together,
 *                          DeepSeek, Ollama, LMStudio, custom proxies)
 *   "google"             → @langchain/google-genai
 *   "azure"              → @langchain/openai (Azure path)
 *   "bedrock"            → @langchain/aws
 */
export type ProviderType = "anthropic" | "openai-compatible" | "google" | "azure" | "bedrock";

/**
 * Description of a single model. Used both as the catalog's per-model
 * record and embedded into `ConfiguredModel.info`. One shape — the
 * downstream code can iterate either catalog-side or persisted-side
 * models with the same fields.
 *
 * The catalog fetcher populates whatever `models.dev` exposes. Self-
 * hosted custom models (Ollama hand-typed) populate `id` + `displayName`
 * and leave the metadata fields empty.
 */
export interface ModelInfo {
  /** Wire-form id passed to the SDK ("claude-sonnet-4-5", "gpt-5", …). */
  id: string;
  displayName: string;
  /**
   * Optional one-line capability blurb. `models.dev` never sends this
   * (see `modelsDevWire.ts`), so it stays empty for catalog-derived models;
   * agent backends populate it from their own reported metadata (e.g. the
   * Claude SDK's "Opus 4.7 with 1M context · …" or codex-acp's model blurb).
   */
  description?: string;
  /**
   * Every sub-field is optional so partial catalog coverage (e.g. a
   * model that publishes only an `input` limit, or `output`-only cost)
   * survives the transform without zero-defaults masking "unknown".
   */
  modalities?: { input?: string[]; output?: string[] };
  limits?: { context?: number; output?: number; input?: number };
  reasoning?: boolean;
  toolCall?: boolean;
  /** True when the catalog `family` marks this as an embedding model. */
  isEmbedding?: boolean;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  releaseDate?: string;
}

/**
 * A provider as listed by the catalog. Lives in memory during a setup
 * wizard pass; never persisted.
 */
export interface CatalogProvider {
  /** Catalog provider id ("anthropic", "openai", "opencode-zen", …). */
  id: string;
  /** From the catalog's `name` field. */
  displayName: string;
  /** From the catalog's `api` field. Pre-fills `Provider.baseUrl`.
   *  Omitted when the catalog entry has no `api` URL — the BYOK wizard
   *  treats this as "user must enter a base URL" rather than blindly
   *  copying an empty string into the persisted row. */
  defaultBaseUrl?: string;
  /**
   * Derived from the catalog's `npm` field by the catalog fetcher.
   *   "@ai-sdk/anthropic"  → "anthropic"
   *   "@ai-sdk/google"     → "google"
   *   "@ai-sdk/azure"      → "azure"
   *   "@ai-sdk/bedrock"    → "bedrock"
   *   anything else        → "openai-compatible"
   */
  providerType: ProviderType;
  /** Keyed by `ModelInfo.id` (the wire-form id). */
  models: Record<string, ModelInfo>;
}
