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
  apiKey?: string | null;
  extras?: Record<string, unknown>;
  wireModelIds: readonly string[];
  autoEnrollModelIds?: readonly string[];
  fallbackDisplayNames?: Record<string, string>;
  fallbackDescriptions?: Record<string, string>;
}

export interface SyncAgentModelsInput {
  agentType: AgentType;
  wireModelIds: readonly string[];
  fallbackDisplayNames?: Record<string, string>;
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

const ENROLL_NONE: readonly string[] = Object.freeze([]);

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
    coordinator: ModelManagementCoordinator
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
    this.#backends = backendConfigRegistry;
    this.#catalog = catalogService;
    this.#coordinator = coordinator;
  }

  async registerAgentProvider(input: RegisterAgentProviderInput): Promise<AgentSetupResult> {
    const existing = this.#findAgentProvider(input.agentType, input.providerType);

    let providerId: string;
    if (existing) {
      providerId = existing.providerId;
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
    const { added, removed } = await this.#reconcileModels(input.agentType, providerId, infos, {
      autoEnrollModelIds: input.autoEnrollModelIds,
    });

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

    void removed;
    return { providerId, configuredModelIds };
  }

  async syncAgentModels(input: SyncAgentModelsInput): Promise<AgentSyncResult> {
    const providers = this.#listAgentProviders(input.agentType);
    if (providers.length === 0) {
      return { added: [], removed: [] };
    }

    if (providers.length === 1) {
      const provider = providers[0];
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
        { autoEnrollModelIds: ENROLL_NONE }
      );
      return {
        added: added.map((a) => a.configuredModelId),
        removed: removed.map((r) => r.configuredModelId),
      };
    }

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
        { autoEnrollModelIds: ENROLL_NONE }
      );
      for (const a of added) addedAll.push(a.configuredModelId);
      for (const r of removed) removedAll.push(r.configuredModelId);
    }
    return { added: addedAll, removed: removedAll };
  }

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

  #listAgentProviders(agentType: AgentType): readonly Provider[] {
    return this.#providers
      .listByOrigin("agent")
      .filter((p) => p.origin.kind === "agent" && p.origin.agentType === agentType);
  }

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

  async #reconcileModels(
    agentType: AgentType,
    providerId: string,
    infos: readonly ModelInfo[],
    opts: { autoEnrollModelIds?: readonly string[] }
  ): Promise<{
    added: Array<{ wireId: string; configuredModelId: string }>;
    removed: Array<{ wireId: string; configuredModelId: string }>;
  }> {
    const existing = this.#models.listByProvider(providerId);
    const existingByWireId = new Map(existing.map((m) => [m.info.id, m]));
    const desiredWireIds = new Set(infos.map((info) => info.id));
    const autoEnrollFilter = opts.autoEnrollModelIds ? new Set(opts.autoEnrollModelIds) : null;

    const added: Array<{ wireId: string; configuredModelId: string }> = [];
    for (const info of infos) {
      const current = existingByWireId.get(info.id);
      if (!current) {
        const configuredModelId = await this.#models.add({ providerId, info });
        if (!autoEnrollFilter || autoEnrollFilter.has(info.id)) {
          await this.#backends.enableModel(agentType, configuredModelId);
        }
        added.push({ wireId: info.id, configuredModelId });
        continue;
      }
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
