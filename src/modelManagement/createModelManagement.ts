/**
 * Top-level factory + cross-slice coordinator.
 *
 * Host code calls `createModelManagement({ app })` exactly
 * once (in `Plugin.onload`), stores the returned `ModelManagementApi`
 * on the plugin instance, threads it into React via
 * `<ModelManagementProvider>`, and passes it to non-React modules
 * (chat manager, agent backends) via constructor injection.
 *
 * `ModelManagementCoordinator` is the only class authorized to mutate
 * across registry slices. Single-slice mutations go through the
 * relevant registry; multi-slice cascades (delete a provider →
 * orphan ConfiguredModels → broken BackendConfig refs) go through
 * the coordinator. This keeps each registry's surface focused on its
 * slice without inviting cycles or duplicated cascade logic.
 *
 * The catalog tier is the already-real `CatalogDownloadService`
 * (lazy two-tier downloader); there is no placeholder for it. The
 * other tiers (registries, factory, setup APIs) are placeholders
 * whose method bodies throw `not implemented`.
 */

import type { App } from "obsidian";

import { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import { CatalogDownloadService } from "@/modelManagement/catalog/CatalogDownloadService";
import { ChatModelFactory } from "@/modelManagement/chatModel/ChatModelFactory";
import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import {
  createDefaultAdapterRegistry,
  ProviderAdapterRegistry,
} from "@/modelManagement/providers/adapters/ProviderAdapterRegistry";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { AgentSetupApi } from "@/modelManagement/setup/AgentSetupApi";
import { ByokSetupApi } from "@/modelManagement/setup/ByokSetupApi";
import { CopilotPlusSetupApi } from "@/modelManagement/setup/CopilotPlusSetupApi";

export interface CreateModelManagementInput {
  app: App;
}

export interface ModelManagementApi {
  catalogService: CatalogDownloadService;
  providerRegistry: ProviderRegistry;
  configuredModelRegistry: ConfiguredModelRegistry;
  backendConfigRegistry: BackendConfigRegistry;
  chatModelFactory: ChatModelFactory;
  adapters: ProviderAdapterRegistry;
  setup: {
    byok: ByokSetupApi;
    agent: AgentSetupApi;
    copilotPlus: CopilotPlusSetupApi;
  };
  coordinator: ModelManagementCoordinator;
  /**
   * Teardown. Called from `Plugin.onunload` to stop any long-lived
   * resources (catalog auto-refresh timers, subscribers). Idempotent.
   */
  dispose(): void;
}

export class ModelManagementCoordinator {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;
  readonly #backends: BackendConfigRegistry;

  /**
   * Inject all three registries. Prefer calling `createModelManagement`
   * rather than constructing this directly — the factory wires all deps
   * in the correct order.
   */
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
   * Cascade:
   *   1. Look up all ConfiguredModel ids under this provider.
   *   2. Drop those ids from every BackendConfig (`removeRefs`).
   *   3. Remove the ConfiguredModel rows (`removeByProvider`).
   *   4. Remove the Provider row + clear its keychain entry.
   *
   * Order matters — backend refs must be cleared before the
   * ConfiguredModels are removed; otherwise `resolveEnabled` would
   * briefly surface them as broken.
   */
  async removeProvider(providerId: string): Promise<void> {
    const configuredModelIds = this.#models
      .listByProvider(providerId)
      .map((m) => m.configuredModelId);
    await this.#backends.removeRefs(configuredModelIds);
    await this.#models.removeByProvider(providerId);
    await this.#providers.remove(providerId);
  }

  /**
   * Drop a configured model and its backend refs. Refs are cleared first so
   * `resolveEnabled` never briefly surfaces the model as broken. Idempotent —
   * removing an unknown id is a no-op.
   */
  async removeConfiguredModel(configuredModelId: string): Promise<void> {
    await this.#backends.removeRefs([configuredModelId]);
    await this.#models.remove(configuredModelId);
  }
}

/**
 * Wire everything together and return the public API. Each layer's
 * deps are injected at construction time; the factory just expresses
 * the dependency graph.
 *
 * Call exactly once per plugin load. Test isolation is achieved by
 * constructing a fresh api per test (or per `describe` block) — no
 * singleton, no reset helpers needed.
 */
export function createModelManagement(input: CreateModelManagementInput): ModelManagementApi {
  const { app } = input;

  const adapters = createDefaultAdapterRegistry();

  const catalogService = new CatalogDownloadService({ app });
  const providerRegistry = new ProviderRegistry(app, adapters);
  const configuredModelRegistry = new ConfiguredModelRegistry();
  const backendConfigRegistry = new BackendConfigRegistry(
    providerRegistry,
    configuredModelRegistry
  );
  const chatModelFactory = new ChatModelFactory(
    providerRegistry,
    configuredModelRegistry,
    adapters
  );
  // Coordinator is constructed before the setup APIs because both
  // `AgentSetupApi` and `CopilotPlusSetupApi` depend on it for their
  // cross-slice cascades (diff-reconcile drops, sign-out removal).
  const coordinator = new ModelManagementCoordinator(
    providerRegistry,
    configuredModelRegistry,
    backendConfigRegistry
  );
  const setup = {
    byok: new ByokSetupApi(providerRegistry, configuredModelRegistry, backendConfigRegistry),
    agent: new AgentSetupApi(
      providerRegistry,
      configuredModelRegistry,
      backendConfigRegistry,
      catalogService,
      coordinator
    ),
    copilotPlus: new CopilotPlusSetupApi(
      providerRegistry,
      configuredModelRegistry,
      backendConfigRegistry,
      coordinator
    ),
  };

  return {
    catalogService,
    providerRegistry,
    configuredModelRegistry,
    backendConfigRegistry,
    chatModelFactory,
    adapters,
    setup,
    coordinator,
    dispose: () => {
      // Placeholder — implementer adds catalog-timer / subscriber
      // teardown when the service bodies land. Idempotent by
      // contract.
    },
  };
}
