import type { App } from "obsidian";

import { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import { ModelManagementCoordinator } from "@/modelManagement/createModelManagement";
import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { ProviderAdapterRegistry } from "@/modelManagement/providers/adapters/ProviderAdapterRegistry";
import { KeychainService } from "@/services/keychainService";
import { resetSettings, setSettings } from "@/settings/model";

export interface TestRegistries {
  app: App;
  providers: ProviderRegistry;
  models: ConfiguredModelRegistry;
  backends: BackendConfigRegistry;
  coordinator: ModelManagementCoordinator;
}

export function createFakeApp(): App {
  const secrets = new Map<string, string>();
  return {
    secretStorage: {
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
      listSecrets: () => Array.from(secrets.keys()),
      deleteSecret: (id: string) => {
        secrets.delete(id);
      },
    },
    vault: { adapter: {} },
  } as unknown as App;
}

export function createTestRegistries(): TestRegistries {
  resetSettings();
  setSettings({ providers: {}, configuredModels: [] });
  KeychainService.resetInstance();
  const app = createFakeApp();
  KeychainService.getInstance(app);
  const providers = new ProviderRegistry(app, new ProviderAdapterRegistry());
  const models = new ConfiguredModelRegistry();
  const backends = new BackendConfigRegistry(providers, models);
  const coordinator = new ModelManagementCoordinator(providers, models, backends);
  return { app, providers, models, backends, coordinator };
}
