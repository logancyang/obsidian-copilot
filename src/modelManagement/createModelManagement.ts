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
  dispose(): void;
}

export class ModelManagementCoordinator {
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

  async removeProvider(providerId: string): Promise<void> {
    const configuredModelIds = this.#models
      .listByProvider(providerId)
      .map((m) => m.configuredModelId);
    await this.#backends.removeRefs(configuredModelIds);
    await this.#models.removeByProvider(providerId);
    await this.#providers.remove(providerId);
  }

  async removeConfiguredModel(configuredModelId: string): Promise<void> {
    await this.#backends.removeRefs([configuredModelId]);
    await this.#models.remove(configuredModelId);
  }
}

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
    dispose: () => {},
  };
}
