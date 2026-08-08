/**
 * Copilot Plus setup workflow. Called by the Plus auth handler on
 * sign-in and sign-out. Persists exactly one `Provider` row with
 * `origin: { kind: "copilot-plus" }` and a `ConfiguredModel` per
 * Plus-hosted model.
 *
 * Plus is a singleton origin — there's at most one Plus provider at
 * any time. `registerPlusProvider` is idempotent: first call creates,
 * subsequent calls re-sync (rotate the API key, refresh model
 * metadata, diff the model list). Sign-out is
 * `unregisterPlusProvider`, which cascade-removes through
 * `ModelManagementCoordinator`.
 *
 * Auto-enrollment targets the BYOK backends (`BYOK_DEFAULT_AUTO_ENROLL`:
 * Simple Chat + the OpenCode agent picker). `autoEnrollModelIds` narrows
 * *which* models enroll on first add: Plus passes just the default-on
 * subset (the flash model), so the rest of the lineup is created and shown
 * in the pickers but left off for the user to toggle on.
 */

import type { ModelManagementCoordinator } from "@/modelManagement/createModelManagement";
import type { ProviderType } from "@/modelManagement/types/catalog";
import type { BackendType, Provider } from "@/modelManagement/types/persisted";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { BYOK_DEFAULT_AUTO_ENROLL } from "@/modelManagement/setup/ByokSetupApi";

export interface RegisterPlusProviderInput {
  /** Which adapter family backs the Plus relay (Plus may add more
   *  over time — Anthropic-flavoured, OpenAI-flavoured, etc.). */
  providerType: ProviderType;
  displayName: string;
  /** The Plus relay endpoint. */
  baseUrl: string;
  /** Plus-issued long-lived token. Rotated on each sign-in. */
  apiKey?: string;
  /** Authoritative list of currently-available Plus models. Existing
   *  ConfiguredModel rows under the Plus provider are diff-reconciled
   *  against this list (add new, update changed, remove gone). */
  models: readonly ModelInfo[];
  /** Defaults to `BYOK_DEFAULT_AUTO_ENROLL` (= chat + opencode). */
  autoEnrollIn?: readonly BackendType[];
  /** Wire ids (`ModelInfo.id`) eligible for default auto-enrollment. When
   *  provided, only newly-added models whose id is in this set get enrolled
   *  into `autoEnrollIn`; the rest are added available-but-off. When omitted,
   *  every newly-added (non-embedding) model is enrolled — the prior behavior.
   *  Lets Plus curate a default-on subset (just the flash model today) while
   *  still surfacing the full lineup in the pickers. */
  autoEnrollModelIds?: readonly string[];
}

export interface PlusSetupResult {
  providerId: string;
  configuredModelIds: string[];
}

export class CopilotPlusSetupApi {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;
  readonly #backends: BackendConfigRegistry;
  readonly #coordinator: ModelManagementCoordinator;

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry,
    backendConfigRegistry: BackendConfigRegistry,
    /** Required for the diff-reconcile + sign-out cascade: vanished
     *  Plus models and the Plus provider on sign-out are removed via
     *  `coordinator.removeConfiguredModel` /
     *  `coordinator.removeProvider`. */
    coordinator: ModelManagementCoordinator
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
    this.#backends = backendConfigRegistry;
    this.#coordinator = coordinator;
  }

  /**
   * Idempotent. First call creates a `Provider` row with
   * `origin: { kind: "copilot-plus" }` and ConfiguredModels for each
   * input model, then auto-enrolls them. Subsequent calls update the
   * Provider in place, rotate the API key, and diff-reconcile the
   * ConfiguredModel list.
   *
   * Newly-added ConfiguredModels are auto-enrolled into
   * `autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL`. Existing models that
   * are no longer in `input.models` are removed (cascading their
   * backend refs through the coordinator).
   *
   * Writes happen in order — provider row, then key (only if non-null),
   * then models — so a failed later step leaves earlier writes for
   * `coordinator.removeProvider` (sign-out) to clean up.
   */
  async registerPlusProvider(input: RegisterPlusProviderInput): Promise<PlusSetupResult> {
    const existing = this.#findPlusProvider();

    let providerId: string;
    if (existing) {
      providerId = existing.providerId;
      // Reuse the row so re-syncing never spawns a second Plus provider;
      // providerType/origin/keychain id are immutable through `update`.
      await this.#providers.update(providerId, {
        displayName: input.displayName,
        baseUrl: input.baseUrl,
      });
    } else {
      providerId = await this.#providers.add({
        providerType: input.providerType,
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        origin: { kind: "copilot-plus" },
        // Provisioned by Plus sign-in, not a user-entered BYOK key.
        requiresApiKey: false,
      });
    }

    // The license key IS the relay token; store it so the chat factory and
    // `buildOpencodeConfig` can read it back via `getApiKey` at call time.
    if (input.apiKey != null) {
      await this.#providers.setApiKey(providerId, input.apiKey);
    }

    const configuredModelIds = await this.#reconcileModels(
      providerId,
      input.models,
      input.autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL,
      input.autoEnrollModelIds
    );

    return { providerId, configuredModelIds };
  }

  /**
   * Sign-out. Cascade-removes the (at most one) Plus provider,
   * dropping its ConfiguredModels and clearing backend refs. No-op
   * when no Plus provider exists.
   */
  async unregisterPlusProvider(): Promise<void> {
    const existing = this.#findPlusProvider();
    if (!existing) return;
    await this.#coordinator.removeProvider(existing.providerId);
  }

  /**
   * The single Plus provider (origin filter). Throws if more than one exists —
   * Plus is a singleton origin and a silent pick would corrupt state.
   */
  #findPlusProvider(): Provider | undefined {
    const matches = this.#providers.listByOrigin("copilot-plus");
    if (matches.length > 1) {
      throw new Error(
        `[modelManagement] CopilotPlusSetupApi: ${matches.length} copilot-plus providers ` +
          `found; the singleton invariant is violated`
      );
    }
    return matches[0];
  }

  /**
   * Diff-reconcile the Plus provider's ConfiguredModel set against `models`:
   * add new wire ids (auto-enrolling each eligible non-embedding model), refresh
   * drifted display + capability fields in place (no configuredModelId churn), and
   * cascade-remove vanished ones. Returns the resulting ids in input order.
   * Mirrors `AgentSetupApi.#reconcileModels`; only real deltas write, so
   * re-syncing an unchanged list never resets user curation.
   *
   * `autoEnrollModelIds`, when provided, restricts auto-enrollment to that set
   * of wire ids — newly-added models outside it are still created (so they
   * appear in the pickers) but left off. `undefined` means enroll every
   * newly-added non-embedding model (the prior, unrestricted behavior).
   */
  async #reconcileModels(
    providerId: string,
    models: readonly ModelInfo[],
    autoEnrollIn: readonly BackendType[],
    autoEnrollModelIds?: readonly string[]
  ): Promise<string[]> {
    const existing = this.#models.listByProvider(providerId);
    const existingByWireId = new Map(existing.map((m) => [m.info.id, m]));
    const desiredWireIds = new Set(models.map((info) => info.id));
    const autoEnrollFilter = autoEnrollModelIds ? new Set(autoEnrollModelIds) : null;

    for (const info of models) {
      const current = existingByWireId.get(info.id);
      if (!current) {
        const configuredModelId = await this.#models.add({ providerId, info });
        // Embedding models aren't chat models — enrolling them into chat/agent
        // backends would surface them in completion pickers where they fail.
        // A wire id outside `autoEnrollFilter` (when set) ships available-but-off.
        if (!info.isEmbedding && (!autoEnrollFilter || autoEnrollFilter.has(info.id))) {
          for (const backend of autoEnrollIn) {
            await this.#backends.enableModel(backend, configuredModelId);
          }
        }
        continue;
      }
      // Refresh the curated snapshot in place when any field drifted — not just the
      // display strings. Capability fields (modalities, reasoning, toolCall) must be
      // re-synced too, otherwise an existing user keeps a stale snapshot and never
      // picks up newly-advertised capabilities (e.g. reasoning effort) on re-sign-in.
      // Plus models are server-curated, so there are no user overrides to clobber.
      if (
        current.info.displayName !== info.displayName ||
        current.info.description !== info.description ||
        current.info.toolCall !== info.toolCall ||
        current.info.reasoning !== info.reasoning ||
        JSON.stringify(current.info.modalities) !== JSON.stringify(info.modalities)
      ) {
        await this.#models.update(current.configuredModelId, {
          info: {
            displayName: info.displayName,
            description: info.description,
            toolCall: info.toolCall,
            reasoning: info.reasoning,
            modalities: info.modalities,
          },
        });
      }
    }

    for (const model of existing) {
      if (desiredWireIds.has(model.info.id)) continue;
      await this.#coordinator.removeConfiguredModel(model.configuredModelId);
    }

    const ids: string[] = [];
    for (const info of models) {
      const found = this.#models.getByWireId(providerId, info.id);
      if (found) ids.push(found.configuredModelId);
    }
    return ids;
  }
}
