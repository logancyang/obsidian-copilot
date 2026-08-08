/**
 * Persisted types — written to `CopilotSettings` (settings wiring lands
 * in a follow-up PR). Once a row exists, the catalog is no longer
 * consulted at runtime.
 */

import type { ModelInfo, ProviderType } from "./catalog";

/**
 * The three agent backends. Each can own its own `Provider`(s) and
 * reports a runtime model inventory.
 */
export type AgentType = "opencode" | "claude" | "codex";

/**
 * The broader set used for per-backend model curation: the three agents
 * plus `"chat"` (Simple Chat). Used as the map key for `BackendConfig`
 * in `settings.backends: Record<BackendType, BackendConfig>`.
 *
 *   "chat"        → Simple Chat picker
 *   "opencode"    → OpenCode agent picker
 *   "claude" → Claude Code agent picker
 *   "codex"       → Codex agent picker
 *
 * Everything else either has no curated selection (vault-qa / project /
 * quick-chat use their own per-feature model id; custom commands store
 * a model id directly) or is handled by another module.
 */
export type BackendType = AgentType | "chat";

/**
 * Where a `Provider` came from. Drives which settings tab shows it and
 * which code path created it. Downstream consumption is uniform — the
 * chat-model factory dispatches purely on `Provider.providerType`.
 *
 *   "byok"          → user added via the BYOK settings tab
 *   "agent"         → auto-created when an agent was set up; the agent
 *                     owns credentials and routing. Chat doesn't appear
 *                     here because chat doesn't own `Provider`s — its
 *                     models come from BYOK + Plus + provider-sharing
 *                     with backed agents.
 *   "copilot-plus"  → auto-created when the user signed into Plus
 */
export type ProviderOrigin =
  | {
      kind: "byok";
      /**
       * Catalog provider id (`models.dev` id, e.g. `"anthropic"`,
       * `"openai"`, `"amazon-bedrock"`) this row was created from. Stable
       * back-reference to the catalog — unlike `displayName` (user-editable)
       * or `providerType` (ambiguous: `openai`, Groq, OpenRouter all map to
       * `openai-compatible`). Lets the Configure dialog re-surface the full
       * catalog model list when editing. Absent for custom-endpoint BYOK
       * providers (no catalog) and for rows that predate this field.
       */
      catalogProviderId?: string;
    }
  | { kind: "agent"; agentType: AgentType }
  | { kind: "copilot-plus" };

/**
 * A configured connection to a model provider.
 *
 * Multi-instance is supported within `byok`: two BYOK `Provider` rows
 * can share the same `providerType` (e.g. two Anthropic accounts) —
 * distinguished by `providerId` and `displayName`. Agent and Plus
 * origins typically have exactly one row each, but the data model
 * doesn't enforce singleton.
 */
export interface Provider {
  /** UUID; primary key. Also the keychain namespace (BYOK only). */
  providerId: string;
  /** Single dispatch field. See `ProviderType` in catalog.ts. */
  providerType: ProviderType;
  /** User-editable label (BYOK) or auto-assigned (agent / Plus). */
  displayName: string;
  /** Overrides what the wizard pre-filled from catalog / template. */
  baseUrl?: string;
  /**
   * Obsidian keychain entry id. `null` for providers that don't take an
   * API key (Ollama, LMStudio, some agent-owned providers).
   */
  apiKeyKeychainId?: string | null;
  /**
   * Whether this provider needs an API key to function. Authoritative and
   * explicit — never inferred from self-hosting at runtime (self-hosted ≠
   * keyless; see `providerRequiresApiKey`). Written at every creation path
   * (BYOK setup, agent setup, Plus sign-in). Optional only for rows that
   * predate the flag; the settings-v5 migration backfills those by identity, so
   * at runtime `providerRequiresApiKey` reads the flag directly.
   */
  requiresApiKey?: boolean;
  /**
   * Opaque per-`providerType` payload.
   *   azure:   { azureDeploymentName, azureApiVersion, azureInstanceName }
   *   bedrock: { bedrockRegion }
   *   openai:  { openAIOrgId }
   * Kept because those adapters can't function without it.
   */
  extras?: Record<string, unknown>;
  origin: ProviderOrigin;
  addedAt: number;
}

/**
 * A model the plugin knows about. Self-sufficient at runtime — once
 * this row exists, the catalog is no longer consulted.
 *
 * "Configured" means "set up in the plugin, ready to use." Applies to
 * BYOK (user-added), agent-owned (auto-added at agent setup), and Plus
 * (auto-added at Plus sign-in) models alike — the difference is which
 * `Provider` this row belongs to and that provider's `origin`.
 *
 * "Configured" is distinct from "enrolled": a `ConfiguredModel` row
 * says the model exists on a provider; a backend separately enrolls
 * some subset of configured models for its picker via
 * `BackendConfig.enabledModels`. Auto-enrollment is the default UX, but
 * the two layers stay separate so per-backend pruning is expressible.
 */
export interface ConfiguredModel {
  /** UUID; primary key. */
  configuredModelId: string;
  /** FK to `Provider.providerId`. */
  providerId: string;
  /**
   * Embedded model description (wire-form id, display name, optional
   * metadata). The setup flow populates `info` from a `ModelInfo`
   * pulled from the catalog. Self-hosted custom models populate
   * `info.id` + `info.displayName` only.
   *
   * Uniqueness constraint: `(providerId, info.id)`.
   */
  info: ModelInfo;
  configuredAt: number;
}

/**
 * Per-backend model selection. Persisted.
 *
 * Backend identity is the map key in the future settings shape
 * (`settings.backends: Record<BackendType, BackendConfig>`), not a
 * field on this row.
 *
 * `enabledModels` references `ConfiguredModel` rows by
 * `configuredModelId`. The picker shows every entry regardless of any
 * runtime ACP inventory; unreachable models surface at request time,
 * not as silent filters. There is no designated default — the first
 * enabled model is used on first use, and subsequent sessions inherit
 * the previous session's selection.
 */
export interface BackendConfig {
  /** Each entry is a `ConfiguredModel.configuredModelId`. */
  enabledModels: string[];
}
