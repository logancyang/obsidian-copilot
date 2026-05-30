/**
 * BYOK setup workflow. The user-facing wizard ("Add Provider" → pick a
 * provider definition → enter key → select models → save) calls
 * `setupProvider`. Bundles the "create Provider row + create N
 * ConfiguredModel rows + auto-enroll in default backends" recipe so the
 * wizard doesn't have to know the order or invariants.
 *
 * `models.dev` is treated as a metadata enhancer, not a source of
 * truth: the caller supplies fully-formed `ModelInfo`s for whichever
 * model ids the live endpoint returned (catalog-enriched when possible,
 * synthesized otherwise). The optional `catalogProviderId` on the input
 * just records the catalog link on the Provider's `origin` for future
 * metadata lookups.
 *
 * Default auto-enrollment is `BYOK_DEFAULT_AUTO_ENROLL`
 * = `["chat", "opencode"]` so BYOK models surface in both Simple Chat
 * and the OpenCode agent picker out of the box.
 */

import { logError } from "@/logger";
import { looksLikeEmbeddingModel } from "@/modelManagement/catalog/catalogTransform";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { BackendType } from "@/modelManagement/types/persisted";
import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";

/**
 * Default set of backends that new BYOK / Plus models are
 * auto-enrolled into. Exported so other origins (Plus, future flows)
 * reuse the same default and the constant is greppable.
 */
export const BYOK_DEFAULT_AUTO_ENROLL: readonly BackendType[] = ["chat", "opencode"];

export interface AddModelsInput {
  providerId: string;
  /** Catalog-snapshotted or hand-typed `ModelInfo`s — same shape
   *  either way. */
  models: readonly ModelInfo[];
  autoEnrollIn?: readonly BackendType[];
}

/**
 * Unified input for `setupProvider`. Replaces the catalog / template
 * split — the caller hands over fully-formed `ModelInfo`s (enriched
 * with catalog metadata when available) and an optional
 * `catalogProviderId` link.
 */
export interface SetupProviderInput {
  /** Catalog provider id when the picker resolved against a catalog
   *  entry; omit for built-in templates (Ollama, custom, …). */
  catalogProviderId?: string;
  providerType: ProviderType;
  displayName: string;
  /** Overrides the provider definition's `defaultBaseUrl`. */
  baseUrl?: string;
  /** Stored in the keychain. */
  apiKey?: string;
  /** Per-providerType payload (Azure deployment, Bedrock region,
   *  OpenAI org id, …). */
  extras?: Record<string, unknown>;
  /** Whether this provider needs an API key. Flows through from the
   *  `ProviderDefinition` (`state.source.requiresApiKey`); persisted on the
   *  `Provider` row so the requires-key question never re-infers from the
   *  endpoint. Defaults to `true` when omitted (a hosted provider). */
  requiresApiKey?: boolean;
  /** Full `ModelInfo` snapshots for every model the user selected.
   *  The caller is responsible for catalog enrichment so the API can
   *  stay catalog-agnostic. */
  models: readonly ModelInfo[];
  autoEnrollIn?: readonly BackendType[];
}

export interface ByokSetupResult {
  providerId: string;
  configuredModelIds: string[];
}

export class ByokSetupApi {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;
  readonly #backends: BackendConfigRegistry;

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry,
    backendConfigRegistry: BackendConfigRegistry
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
    this.#backends = backendConfigRegistry;
  }

  /**
   * Unified BYOK setup. Creates the Provider (with `origin.kind = "byok"`
   * and an optional `catalogProviderId` link), stores the API key,
   * creates `ConfiguredModel` rows from the supplied `models`
   * snapshots, and enrolls non-embedding models into
   * `autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL`. Replaces the
   * catalog / template split — the caller pre-enriches `ModelInfo`s.
   *
   * Order: provider row → API key → models → backend enrollment. If any
   * later step throws, the provider row is rolled back so a half-built
   * provider doesn't surface in `byokProvidersAtom`.
   */
  async setupProvider(input: SetupProviderInput): Promise<ByokSetupResult> {
    const providerId = await this.#providers.add({
      providerType: input.providerType,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      // Persist the explicit requires-key flag (default hosted = needs a key)
      // so the runtime never re-infers it from the endpoint.
      requiresApiKey: input.requiresApiKey ?? true,
      origin: {
        kind: "byok",
        ...(input.catalogProviderId ? { catalogProviderId: input.catalogProviderId } : {}),
      },
      extras: input.extras,
    });

    try {
      if (input.apiKey) {
        await this.#providers.setApiKey(providerId, input.apiKey);
      }

      const configuredModelIds = await this.#models.bulkSet(providerId, input.models);

      // `models` carries no duplicate `info.id` (selection is a set), so
      // `bulkSet` returns ids 1:1 in input order — `configuredModelIds[i]`
      // pairs with `models[i]`. Embeddings aren't chat models, so we keep
      // them out of the chat/agent backends.
      const newChatIds = configuredModelIds.filter((_, i) => !input.models[i]?.isEmbedding);
      await this.#enrollInBackends(input.autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL, newChatIds);

      return { providerId, configuredModelIds };
    } catch (err) {
      await this.#rollbackProvider(providerId);
      throw err;
    }
  }

  /**
   * Add more configured models to an existing BYOK provider without
   * touching the Provider row. Skips models that already exist on
   * the provider (the `(providerId, info.id)` uniqueness invariant),
   * reusing their existing `configuredModelId`. Newly-added models are
   * enrolled into `autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL`. Returns
   * the resulting `configuredModelId`s in input order.
   */
  async addModels(input: AddModelsInput): Promise<string[]> {
    const resultIds: string[] = [];
    // Track only freshly-added non-embedding ids so we don't re-enroll
    // already-configured models and don't enroll embeddings into chat
    // backends (mirrors `setupProvider`).
    const newChatIds: string[] = [];
    for (const info of input.models) {
      const existing = this.#models.getByWireId(input.providerId, info.id);
      if (existing) {
        resultIds.push(existing.configuredModelId);
        continue;
      }
      const configuredModelId = await this.#models.add({ providerId: input.providerId, info });
      resultIds.push(configuredModelId);
      // The caller may pass bare `ModelInfo` (id + displayName) for
      // hand-typed self-hosted models; fall back to the id heuristic
      // when `isEmbedding` is unset.
      const isEmbedding = info.isEmbedding ?? looksLikeEmbeddingModel(info.id);
      if (!isEmbedding) {
        newChatIds.push(configuredModelId);
      }
    }
    await this.#enrollInBackends(input.autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL, newChatIds);
    return resultIds;
  }

  /**
   * Batch-enroll `newChatIds` into each backend with a single
   * `setEnabledModels` call instead of N×M `enableModel` awaits. Reads
   * the current `enabledModels` so we preserve ids contributed by
   * other providers, and dedupes in case `newChatIds` overlaps the
   * existing set.
   */
  async #enrollInBackends(
    enrollIn: readonly BackendType[],
    newChatIds: readonly string[]
  ): Promise<void> {
    if (newChatIds.length === 0) return;
    for (const backend of enrollIn) {
      const current = this.#backends.get(backend).enabledModels;
      const merged = [...current];
      for (const id of newChatIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      await this.#backends.setEnabledModels(backend, merged);
    }
  }

  /**
   * Best-effort rollback after a partial setup. Cascades through the same
   * order the coordinator's removal path uses: drop backend refs to any
   * `ConfiguredModel`s `bulkSet` already wrote, then drop the rows, then
   * drop the Provider row. Failure at any step is logged and swallowed —
   * we're already unwinding from an upstream throw the caller cares about.
   */
  async #rollbackProvider(providerId: string): Promise<void> {
    try {
      const modelIds = this.#models.listByProvider(providerId).map((m) => m.configuredModelId);
      if (modelIds.length > 0) {
        await this.#backends.removeRefs(modelIds);
        await this.#models.removeByProvider(providerId);
      }
      await this.#providers.remove(providerId);
    } catch (err) {
      logError(`[modelManagement] ByokSetupApi rollback failed for ${providerId}`, err);
    }
  }
}
