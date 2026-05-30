/**
 * Enrolls an agent's reported model list into the data model. Creates one
 * `Provider` per `(agentType, providerType)` with `origin: "agent"` and
 * snapshots a `ConfiguredModel` per `wireModelId`.
 *
 * Enablement follows one rule: only the agent's *current* model ends up
 * enabled. `registerAgentProvider` (first enrollment) auto-enrolls every model
 * into `backends[agentType]` so the discovery wiring can then narrow the
 * enabled set down to the current model; `syncAgentModels` (later probes) adds
 * newly-reported models *disabled*, so a model the agent introduces later never
 * silently turns itself on. Either way agent-owned models stay exclusive to
 * their agent's picker.
 *
 * `registerAgentProvider` is idempotent on `(agentType, providerType)`:
 * re-running reconciles the model list. `syncAgentModels` is the narrower
 * variant that refreshes models without touching provider metadata.
 */

import { logWarn } from "@/logger";

import type { CatalogDownloadService } from "@/modelManagement/catalog/CatalogDownloadService";
import type { ModelManagementCoordinator } from "@/modelManagement/createModelManagement";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { AgentType, Provider } from "@/modelManagement/types/persisted";
import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";

export interface RegisterAgentProviderInput {
  agentType: AgentType;
  providerType: ProviderType;
  displayName: string;
  baseUrl?: string;
  /** `null` for CLI-managed agents (Claude Code, Codex): no key is stored, so
   *  the chat-model factory's `getApiKey()` returns `null` and the adapter
   *  must tolerate that. */
  apiKey?: string | null;
  extras?: Record<string, unknown>;
  /** Full set of wire ids the agent reports; the existing model set is diffed
   *  against this list. */
  wireModelIds: readonly string[];
  /** Agent-reported display names, keyed by wire id. For agent-origin
   *  providers these win over catalog metadata (the agent owns the name). */
  fallbackDisplayNames?: Record<string, string>;
  /** Agent-reported capability blurbs, keyed by wire id. Win over catalog. */
  fallbackDescriptions?: Record<string, string>;
}

export interface SyncAgentModelsInput {
  agentType: AgentType;
  wireModelIds: readonly string[];
  /** See `RegisterAgentProviderInput.fallbackDisplayNames`. */
  fallbackDisplayNames?: Record<string, string>;
  /** See `RegisterAgentProviderInput.fallbackDescriptions`. */
  fallbackDescriptions?: Record<string, string>;
}

export interface AgentSetupResult {
  providerId: string;
  configuredModelIds: string[];
}

export interface AgentSyncResult {
  added: string[];
  removed: string[];
}

export class AgentSetupApi {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;
  readonly #backends: BackendConfigRegistry;
  readonly #catalog: CatalogDownloadService;
  readonly #coordinator: ModelManagementCoordinator;

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry,
    backendConfigRegistry: BackendConfigRegistry,
    catalogService: CatalogDownloadService,
    /** Used to cascade-remove an orphaned ConfiguredModel (and its backend
     *  refs) when a wire id vanishes from the agent's reported list. */
    coordinator: ModelManagementCoordinator
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
    this.#backends = backendConfigRegistry;
    this.#catalog = catalogService;
    this.#coordinator = coordinator;
  }

  /**
   * Idempotent on `(agentType, providerType)`: the first call creates the
   * provider, later calls update it in place and reconcile its model list.
   * Catalog metadata enriches each model snapshot where the wire id matches;
   * unmatched ids fall back to `fallbackDisplayNames[wireId] ?? wireId`.
   *
   * Writes happen in order — provider row, then key (only if non-null), then
   * models — and a failed later step leaves earlier writes in place for
   * `coordinator.removeProvider` to clean up.
   */
  async registerAgentProvider(input: RegisterAgentProviderInput): Promise<AgentSetupResult> {
    const existing = this.#findAgentProvider(input.agentType, input.providerType);

    let providerId: string;
    if (existing) {
      providerId = existing.providerId;
      // Reuse the existing row so re-running never spawns a second provider for
      // the same `(agentType, providerType)`. providerType/origin/keychain id
      // are immutable through `update`.
      await this.#providers.update(providerId, {
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        extras: input.extras,
      });
    } else {
      providerId = await this.#providers.add({
        providerType: input.providerType,
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        origin: { kind: "agent", agentType: input.agentType },
        extras: input.extras,
        // Agent-owned providers route through the agent's own auth (native /
        // CLI-managed); the user never supplies a BYOK key for them.
        requiresApiKey: false,
      });
    }

    if (input.apiKey != null) {
      await this.#providers.setApiKey(providerId, input.apiKey);
    }

    const infos = await this.#resolveModelInfos(
      input.providerType,
      input.wireModelIds,
      input.fallbackDisplayNames,
      input.fallbackDescriptions
    );
    // First enrollment enables every model; the discovery wiring narrows the
    // enabled set to the current model afterward.
    const { added, removed } = await this.#reconcileModels(input.agentType, providerId, infos, {
      enableNewModels: true,
    });

    // Return the configured-model ids in wire-id order, joining freshly-added
    // ids with the surviving ones.
    const addedByWireId = new Map(added.map((a) => [a.wireId, a.configuredModelId]));
    const configuredModelIds: string[] = [];
    for (const info of infos) {
      const fromAdd = addedByWireId.get(info.id);
      if (fromAdd) {
        configuredModelIds.push(fromAdd);
        continue;
      }
      const surviving = this.#models.getByWireId(providerId, info.id);
      if (surviving) configuredModelIds.push(surviving.configuredModelId);
    }

    // `#reconcileModels` already applied the removals; the delta isn't surfaced
    // here (callers that need it use `syncAgentModels`).
    void removed;
    return { providerId, configuredModelIds };
  }

  /**
   * Reconcile an existing agent provider's model list without touching the
   * Provider row. No-op when no agent provider exists yet (the caller must run
   * `registerAgentProvider` first).
   *
   * The single-provider case (claude / codex, and opencode as enrolled
   * today) reconciles directly. When several agent providers share one
   * `agentType`, wire ids are partitioned by their owning provider so each only
   * reconciles its own — never corrupting another provider's list.
   *
   * Newly-reported models are added *disabled*: a model the agent introduces on
   * a later probe never turns itself on, so the enabled set keeps reflecting the
   * user's curation (only the current model was seeded at first enrollment).
   */
  async syncAgentModels(input: SyncAgentModelsInput): Promise<AgentSyncResult> {
    const providers = this.#listAgentProviders(input.agentType);
    if (providers.length === 0) {
      return { added: [], removed: [] };
    }

    if (providers.length === 1) {
      const provider = providers[0];
      // Every reported wire id belongs to this one provider.
      const infos = await this.#resolveModelInfosForProvider(
        provider,
        input.wireModelIds,
        input.fallbackDisplayNames,
        input.fallbackDescriptions
      );
      const { added, removed } = await this.#reconcileModels(
        input.agentType,
        provider.providerId,
        infos,
        { enableNewModels: false }
      );
      return {
        added: added.map((a) => a.configuredModelId),
        removed: removed.map((r) => r.configuredModelId),
      };
    }

    // Partition reported wire ids by their owning provider. Ids owned by no
    // provider yet can't be placed without a providerType, so they're left for
    // `registerAgentProvider` (which carries one) rather than guessing.
    const addedAll: string[] = [];
    const removedAll: string[] = [];
    const wireIdSet = new Set(input.wireModelIds);
    for (const provider of providers) {
      const ownedWireIds: string[] = [];
      for (const wireId of wireIdSet) {
        if (this.#models.getByWireId(provider.providerId, wireId)) {
          ownedWireIds.push(wireId);
        }
      }
      // Reconcile only owned ids: a dropped id is one this provider owned and
      // the agent no longer reports. Unowned ids aren't added here (no
      // providerType to resolve their catalog metadata).
      const infos = await this.#resolveModelInfosForProvider(
        provider,
        ownedWireIds,
        input.fallbackDisplayNames,
        input.fallbackDescriptions
      );
      const { added, removed } = await this.#reconcileModels(
        input.agentType,
        provider.providerId,
        infos,
        { enableNewModels: false }
      );
      for (const a of added) addedAll.push(a.configuredModelId);
      for (const r of removed) removedAll.push(r.configuredModelId);
    }
    return { added: addedAll, removed: removedAll };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Find the single agent-owned provider for `(agentType, providerType)`.
   * Throws if more than one matches — the `(agentType, providerType)`
   * idempotency invariant is violated and a silent pick would corrupt
   * state.
   */
  #findAgentProvider(agentType: AgentType, providerType: ProviderType): Provider | undefined {
    const matches = this.#providers
      .listByOrigin("agent")
      .filter(
        (p) =>
          p.origin.kind === "agent" &&
          p.origin.agentType === agentType &&
          p.providerType === providerType
      );
    if (matches.length > 1) {
      throw new Error(
        `[modelManagement] AgentSetupApi: ${matches.length} providers found for ` +
          `(${agentType}, ${providerType}); the (agentType, providerType) ` +
          `idempotency invariant is violated`
      );
    }
    return matches[0];
  }

  /** All agent-owned providers for an `agentType` (origin filter). */
  #listAgentProviders(agentType: AgentType): readonly Provider[] {
    return this.#providers
      .listByOrigin("agent")
      .filter((p) => p.origin.kind === "agent" && p.origin.agentType === agentType);
  }

  /**
   * Catalog-enrich each wire id under one `providerType`, then overlay the
   * agent-reported `fallbackDisplayNames`/`fallbackDescriptions` so the agent
   * owns the display strings (catalog `limits`/`cost` survive). On a catalog
   * miss the id itself is the base, so correctness never depends on the catalog
   * being reachable.
   *
   * The input carries only `providerType`, which maps to many catalog
   * providers, so the lookup scans them and takes the first match. A wire id
   * colliding across two same-type providers resolves to whichever comes first
   * — fine, since this only affects display metadata.
   */
  async #resolveModelInfos(
    providerType: ProviderType,
    wireModelIds: readonly string[],
    fallbackDisplayNames?: Record<string, string>,
    fallbackDescriptions?: Record<string, string>
  ): Promise<ModelInfo[]> {
    const wireToInfo = await this.#buildCatalogLookup(providerType);
    return this.#snapshotInfos(
      wireModelIds,
      wireToInfo,
      fallbackDisplayNames,
      fallbackDescriptions
    );
  }

  /**
   * Like `#resolveModelInfos` but scoped to one provider: on a catalog miss it
   * reuses the existing `ConfiguredModel.info`, so a re-sync never downgrades an
   * already-enriched row to a bare fallback. Agent-reported display strings
   * still override the resolved name/description (see `#applyAgentDisplay`).
   */
  async #resolveModelInfosForProvider(
    provider: Provider,
    wireModelIds: readonly string[],
    fallbackDisplayNames?: Record<string, string>,
    fallbackDescriptions?: Record<string, string>
  ): Promise<ModelInfo[]> {
    const wireToInfo = await this.#buildCatalogLookup(provider.providerType);
    return wireModelIds.map((wireId) => {
      const base = wireToInfo.get(wireId) ??
        this.#models.getByWireId(provider.providerId, wireId)?.info ?? {
          id: wireId,
          displayName: wireId,
        };
      return this.#applyAgentDisplay(base, wireId, fallbackDisplayNames, fallbackDescriptions);
    });
  }

  /** Pure wire-id → `ModelInfo` mapping, split from the catalog IO so it stays testable. */
  #snapshotInfos(
    wireModelIds: readonly string[],
    wireToInfo: ReadonlyMap<string, ModelInfo>,
    fallbackDisplayNames?: Record<string, string>,
    fallbackDescriptions?: Record<string, string>
  ): ModelInfo[] {
    return wireModelIds.map((wireId) => {
      const base = wireToInfo.get(wireId) ?? { id: wireId, displayName: wireId };
      return this.#applyAgentDisplay(base, wireId, fallbackDisplayNames, fallbackDescriptions);
    });
  }

  /**
   * Overlay the agent's reported name/description onto a resolved `ModelInfo`.
   * For agent-origin models the agent owns these strings, so they win over any
   * catalog match — this is what keeps `ConfiguredModel.info` byte-identical to
   * the chat picker's `ModelEntry`. Catalog-supplied `limits`/`cost`/etc. are
   * preserved. A missing fallback leaves the resolved value untouched.
   */
  #applyAgentDisplay(
    base: ModelInfo,
    wireId: string,
    fallbackDisplayNames?: Record<string, string>,
    fallbackDescriptions?: Record<string, string>
  ): ModelInfo {
    const displayName = fallbackDisplayNames?.[wireId];
    const description = fallbackDescriptions?.[wireId];
    if (displayName === undefined && description === undefined) return base;
    return {
      ...base,
      displayName: displayName ?? base.displayName,
      description: description ?? base.description,
    };
  }

  /**
   * Build a `wireId → ModelInfo` map across every catalog provider whose
   * `providerType` matches. Best-effort: `ensureLoaded` failure is
   * logged and an empty map is returned so the fallback path takes over.
   */
  async #buildCatalogLookup(providerType: ProviderType): Promise<ReadonlyMap<string, ModelInfo>> {
    try {
      await this.#catalog.ensureLoaded();
    } catch (err) {
      logWarn(
        "[modelManagement] AgentSetupApi: catalog ensureLoaded failed; falling back to wire-id metadata",
        err
      );
    }
    const lookup = new Map<string, ModelInfo>();
    for (const catalogProvider of this.#catalog.getAllProviders()) {
      if (catalogProvider.providerType !== providerType) continue;
      for (const [wireId, info] of Object.entries(catalogProvider.models)) {
        if (!lookup.has(wireId)) lookup.set(wireId, info);
      }
    }
    return lookup;
  }

  /**
   * Diff-reconcile one provider's ConfiguredModel set against `infos`: add new
   * wire ids, refresh the display strings of existing ids whose
   * name/description changed (so a CLI upgrade or this feature's rollout updates
   * already-enrolled rows), and cascade-remove vanished ones. Only real deltas
   * write, so re-syncing an unchanged list is a no-op that never resets user
   * curation.
   *
   * `enableNewModels` controls whether each freshly-added model is enrolled into
   * `backends[agentType]`: `true` on first enrollment (the discovery wiring
   * narrows to the current model afterward), `false` on later syncs so a model
   * the agent introduces later stays disabled until the user enables it.
   */
  async #reconcileModels(
    agentType: AgentType,
    providerId: string,
    infos: readonly ModelInfo[],
    opts: { enableNewModels: boolean }
  ): Promise<{
    added: Array<{ wireId: string; configuredModelId: string }>;
    removed: Array<{ wireId: string; configuredModelId: string }>;
  }> {
    const existing = this.#models.listByProvider(providerId);
    const existingByWireId = new Map(existing.map((m) => [m.info.id, m]));
    const desiredWireIds = new Set(infos.map((info) => info.id));

    const added: Array<{ wireId: string; configuredModelId: string }> = [];
    for (const info of infos) {
      const current = existingByWireId.get(info.id);
      if (!current) {
        const configuredModelId = await this.#models.add({ providerId, info });
        // Enroll into this agent's backend only — agent models never leak into
        // chat or another agent's picker. Skipped on sync so later-discovered
        // models stay disabled until the user enables them.
        if (opts.enableNewModels) {
          await this.#backends.enableModel(agentType, configuredModelId);
        }
        added.push({ wireId: info.id, configuredModelId });
        continue;
      }
      // Refresh display strings in place when they drifted, without touching the
      // configuredModelId (so `BackendConfig.enabledModels` refs don't churn).
      if (
        current.info.displayName !== info.displayName ||
        current.info.description !== info.description
      ) {
        await this.#models.update(current.configuredModelId, {
          info: { displayName: info.displayName, description: info.description },
        });
      }
    }

    const removed: Array<{ wireId: string; configuredModelId: string }> = [];
    for (const model of existing) {
      if (desiredWireIds.has(model.info.id)) continue;
      await this.#coordinator.removeConfiguredModel(model.configuredModelId);
      removed.push({ wireId: model.info.id, configuredModelId: model.configuredModelId });
    }

    return { added, removed };
  }
}
