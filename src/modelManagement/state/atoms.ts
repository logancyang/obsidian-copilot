/**
 * Reactive read layer for model management. Single source of
 * reactivity for the whole module — registries no longer carry
 * `onChange` APIs; subscribers (React or otherwise) attach to these
 * atoms instead.
 *
 * Derived from the existing `settingsAtom` so any settings write
 * fans out automatically through Jotai. React components use
 * `useAtomValue(<atom>, { store: settingsStore })`; non-React
 * subscribers use `settingsStore.sub(<atom>, listener)`.
 *
 * The three persisted slices (`providers`, `configuredModels`,
 * `backends`) live directly on `CopilotSettings` and are backfilled
 * with frozen empties by `sanitizeSettings` on load — so derived atoms
 * never observe a fresh `{}` / `[]` and Jotai's `===` short-circuit
 * holds across reads. See AGENTS.md → "Referential stability".
 */

import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

import { settingsAtom } from "@/settings/model";

import { providerNeedsSelfHostWarning } from "@/modelManagement/providers/selfHostPolicy";
import type {
  BackendConfig,
  BackendType,
  ConfiguredModel,
  Provider,
  ProviderOrigin,
} from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

/** Frozen empty picker view — referential stability so a filtered-to-empty
 *  backend keeps the same reference across reads. See "Referential stability". */
const EMPTY_PICKER_ENTRIES: readonly EnabledBackendEntry[] = Object.freeze([]);

// -----------------------------------------------------------------------------
// Raw slice atoms — derived directly from settings.
// -----------------------------------------------------------------------------

export const providersAtom = atom<Readonly<Record<string, Provider>>>(
  (get) => get(settingsAtom).providers
);

export const configuredModelsAtom = atom<readonly ConfiguredModel[]>(
  (get) => get(settingsAtom).configuredModels
);

export const backendsAtom = atom<Readonly<Partial<Record<BackendType, BackendConfig>>>>(
  (get) => get(settingsAtom).backends
);

/** Self-Host Mode toggle, isolated so the picker view recomputes only when the
 *  flag flips — not on every unrelated settings write. */
export const selfHostModeAtom = atom<boolean>((get) => get(settingsAtom).enableSelfHostMode);

// -----------------------------------------------------------------------------
// Common filtered views.
// -----------------------------------------------------------------------------

function filterByOrigin(
  providers: Readonly<Record<string, Provider>>,
  kind: ProviderOrigin["kind"]
): readonly Provider[] {
  return Object.values(providers).filter((p) => p.origin.kind === kind);
}

/** All providers with `origin.kind === "byok"`. The raw, unfiltered set —
 *  used where the full BYOK inventory matters regardless of Self-Host Mode
 *  (e.g. the Configure dialog's duplicate-provider check). */
export const byokProvidersAtom = atom<readonly Provider[]>((get) =>
  filterByOrigin(get(providersAtom), "byok")
);

/** Frozen empty BYOK list — referential stability when no BYOK provider exists. */
const EMPTY_BYOK_PROVIDERS: readonly Provider[] = Object.freeze([]);

/**
 * BYOK providers for the BYOK settings table, ordered for Self-Host Mode. Same
 * as `byokProvidersAtom` when the mode is off; while on, cloud providers stay
 * listed (never hidden) but sort below self-hosted / local endpoints so the
 * warned options land at the bottom (`providerNeedsSelfHostWarning`). A stable
 * sort preserves each group's original relative order. View-layer projection
 * only — the raw `byokProvidersAtom` and the persisted providers are untouched,
 * so the original order returns when the mode is turned off.
 */
export const visibleByokProvidersAtom = atom<readonly Provider[]>((get) => {
  const providers = get(byokProvidersAtom);
  const enableSelfHostMode = get(selfHostModeAtom);
  if (!enableSelfHostMode || providers.length === 0) {
    return providers.length === 0 ? EMPTY_BYOK_PROVIDERS : providers;
  }
  // Stable partition: self-hosted first, cloud (warned) last.
  const selfHosted: Provider[] = [];
  const cloud: Provider[] = [];
  for (const p of providers) {
    (providerNeedsSelfHostWarning(p, { enableSelfHostMode }) ? cloud : selfHosted).push(p);
  }
  // No cloud providers → order is unchanged; keep the original reference.
  if (cloud.length === 0) return providers;
  return [...selfHosted, ...cloud];
});

/** All providers with `origin.kind === "agent"`. Used by the agent
 *  setup panels (each panel filters further by `origin.agentType`). */
export const agentProvidersAtom = atom<readonly Provider[]>((get) =>
  filterByOrigin(get(providersAtom), "agent")
);

/** The (at most one) provider with `origin.kind === "copilot-plus"`. */
export const copilotPlusProvidersAtom = atom<readonly Provider[]>((get) =>
  filterByOrigin(get(providersAtom), "copilot-plus")
);

// -----------------------------------------------------------------------------
// Picker-ready join view per backend.
// -----------------------------------------------------------------------------

/**
 * Resolves a backend's `enabledModels` into picker-ready entries.
 * Order preserved. Broken refs (configured model deleted, provider
 * deleted) surface as `state: "broken"` rather than being silently
 * dropped — see data-model spec invariant #3.
 *
 * While Self-Host Mode is on, cloud-provider entries are annotated with
 * `needsSelfHostWarning` (not dropped): the UI flags them and sorts them last.
 * Order is preserved here so selection-resolution and display stay aligned with
 * the runtime's order-preserving fallback. View projection only — the persisted
 * `enabledModels` is untouched, so the flags clear when the mode is turned off.
 * Broken entries always survive (no provider to flag on).
 *
 * Use as: `useAtomValue(backendPickerAtomFamily("chat"), { store: settingsStore })`.
 */
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
