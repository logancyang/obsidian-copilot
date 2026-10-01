import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

import { settingsAtom } from "@/settings/model";

import { providerNeedsSelfHostWarning } from "@/modelManagement/providers/selfHostPolicy";
import type {
  BackendConfig,
  BackendType,
  ConfiguredModel,
  PersistedCopilotPlusCatalog,
  Provider,
  ProviderOrigin,
} from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

const EMPTY_PICKER_ENTRIES: readonly EnabledBackendEntry[] = Object.freeze([]);

export const providersAtom = atom<Readonly<Record<string, Provider>>>(
  (get) => get(settingsAtom).providers
);

export const configuredModelsAtom = atom<readonly ConfiguredModel[]>(
  (get) => get(settingsAtom).configuredModels
);

export const backendsAtom = atom<Readonly<Partial<Record<BackendType, BackendConfig>>>>(
  (get) => get(settingsAtom).backends
);

export const copilotPlusCatalogAtom = atom<Readonly<PersistedCopilotPlusCatalog>>(
  (get) => get(settingsAtom).copilotPlusCatalog
);

const selfHostModeAtom = atom<boolean>((get) => get(settingsAtom).enableSelfHostMode);

function filterByOrigin(
  providers: Readonly<Record<string, Provider>>,
  kind: ProviderOrigin["kind"]
): readonly Provider[] {
  return Object.values(providers).filter((p) => p.origin.kind === kind);
}

export const byokProvidersAtom = atom<readonly Provider[]>((get) =>
  filterByOrigin(get(providersAtom), "byok")
);

const EMPTY_BYOK_PROVIDERS: readonly Provider[] = Object.freeze([]);

export const visibleByokProvidersAtom = atom<readonly Provider[]>((get) => {
  const providers = get(byokProvidersAtom);
  const enableSelfHostMode = get(selfHostModeAtom);
  if (!enableSelfHostMode || providers.length === 0) {
    return providers.length === 0 ? EMPTY_BYOK_PROVIDERS : providers;
  }
  const selfHosted: Provider[] = [];
  const cloud: Provider[] = [];
  for (const p of providers) {
    (providerNeedsSelfHostWarning(p, { enableSelfHostMode }) ? cloud : selfHosted).push(p);
  }
  if (cloud.length === 0) return providers;
  return [...selfHosted, ...cloud];
});

export const backendPickerAtomFamily = atomFamily((backend: BackendType) =>
  atom<readonly EnabledBackendEntry[]>((get) => {
    const config = get(backendsAtom)[backend] ?? { enabledModels: [] };
    const models = get(configuredModelsAtom);
    const providers = get(providersAtom);
    const enableSelfHostMode = get(selfHostModeAtom);
    if (config.enabledModels.length === 0) return EMPTY_PICKER_ENTRIES;
    return config.enabledModels.map<EnabledBackendEntry>((configuredModelId) => {
      const configuredModel = models.find((m) => m.configuredModelId === configuredModelId);
      const provider = configuredModel ? providers[configuredModel.providerId] : undefined;
      if (configuredModel && provider) {
        const needsSelfHostWarning =
          enableSelfHostMode && providerNeedsSelfHostWarning(provider, { enableSelfHostMode });
        return { configuredModelId, state: "ok", configuredModel, provider, needsSelfHostWarning };
      }
      return { configuredModelId, state: "broken" };
    });
  })
);
