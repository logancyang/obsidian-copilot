import { logError } from "@/logger";
import { getSettings, setSettings } from "@/settings/model";

import { providerNeedsSelfHostWarning } from "@/modelManagement/providers/selfHostPolicy";
import type { BackendConfig, BackendType } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";

const EMPTY_ENABLED: string[] = Object.freeze([]) as unknown as string[];
const EMPTY_CONFIG: BackendConfig = Object.freeze({
  enabledModels: EMPTY_ENABLED,
});

const EMPTY_RESOLVED: readonly EnabledBackendEntry[] = Object.freeze([]);

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class BackendConfigRegistry {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;

  readonly #listeners = new Set<() => void>();

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (err) {
        logError("[modelManagement] BackendConfigRegistry listener threw", err);
      }
    }
  }

  #mutateAndEmit(mutate: () => void): void {
    const before = getSettings().backends;
    mutate();
    if (getSettings().backends !== before) this.#emit();
  }

  get(backend: BackendType): BackendConfig {
    return getSettings().backends[backend] ?? EMPTY_CONFIG;
  }

  resolveEnabled(backend: BackendType): readonly EnabledBackendEntry[] {
    const settings = getSettings();
    const config = settings.backends[backend] ?? EMPTY_CONFIG;
    if (config.enabledModels.length === 0) return EMPTY_RESOLVED;
    return config.enabledModels.map((configuredModelId): EnabledBackendEntry => {
      const configuredModel = this.#models.get(configuredModelId);
      const provider = configuredModel
        ? this.#providers.get(configuredModel.providerId)
        : undefined;
      if (configuredModel && provider) {
        const needsSelfHostWarning =
          settings.enableSelfHostMode && providerNeedsSelfHostWarning(provider, settings);
        return { configuredModelId, state: "ok", configuredModel, provider, needsSelfHostWarning };
      }
      return { configuredModelId, state: "broken" };
    });
  }

  async setEnabledModels(
    backend: BackendType,
    configuredModelIds: readonly string[]
  ): Promise<void> {
    this.#mutateAndEmit(() => {
      setSettings((cur) => {
        const existing = cur.backends[backend];
        const nextIds = [...configuredModelIds];
        if (existing && arraysEqual(existing.enabledModels, nextIds)) {
          return {};
        }
        const next: BackendConfig = { enabledModels: nextIds };
        return { backends: { ...cur.backends, [backend]: next } };
      });
    });
  }

  async enableModel(backend: BackendType, configuredModelId: string): Promise<void> {
    const existing = getSettings().backends[backend];
    if (existing?.enabledModels.includes(configuredModelId)) return;
    this.#mutateAndEmit(() => {
      setSettings((cur) => {
        const current = cur.backends[backend];
        if (current?.enabledModels.includes(configuredModelId)) return {};
        const next: BackendConfig = {
          enabledModels: [...(current?.enabledModels ?? []), configuredModelId],
        };
        return { backends: { ...cur.backends, [backend]: next } };
      });
    });
  }

  async disableModel(backend: BackendType, configuredModelId: string): Promise<void> {
    const existing = getSettings().backends[backend];
    if (!existing || !existing.enabledModels.includes(configuredModelId)) return;
    this.#mutateAndEmit(() => {
      setSettings((cur) => {
        const current = cur.backends[backend];
        if (!current) return {};
        const nextIds = current.enabledModels.filter((id) => id !== configuredModelId);
        const next: BackendConfig = { enabledModels: nextIds };
        return { backends: { ...cur.backends, [backend]: next } };
      });
    });
  }

  async removeRefs(configuredModelIds: readonly string[]): Promise<void> {
    if (configuredModelIds.length === 0) return;
    const removed = new Set(configuredModelIds);
    this.#mutateAndEmit(() => {
      setSettings((cur) => {
        let mutated = false;
        const nextBackends: Partial<Record<BackendType, BackendConfig>> = { ...cur.backends };
        for (const [backendKey, config] of Object.entries(cur.backends) as Array<
          [BackendType, BackendConfig]
        >) {
          if (!config.enabledModels.some((id) => removed.has(id))) continue;
          nextBackends[backendKey] = {
            enabledModels: config.enabledModels.filter((id) => !removed.has(id)),
          };
          mutated = true;
        }
        return mutated ? { backends: nextBackends } : {};
      });
    });
  }
}
