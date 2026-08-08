/**
 * Source of truth for `BackendConfig` rows, keyed by `BackendType`.
 *
 * Wraps `settings.backends: Partial<Record<BackendType, BackendConfig>>`
 * with typed reads and mutations. Resolves `enabledModels:
 * configuredModelId[]` into picker-ready entries via the joined
 * `ConfiguredModelRegistry` + `ProviderRegistry` state — see
 * `resolveEnabled()`.
 *
 * Invariants enforced here:
 *   - Broken refs (`enabledModels[i]` not found in
 *     `configuredModels`) are surfaced as `state: "broken"`, never
 *     silently dropped (#3).
 *
 * React components consume reactive reads through
 * `state/atoms.ts`'s `backendPickerAtomFamily(backend)`. This class
 * is for mutations and non-React callers.
 */

import { logError } from "@/logger";
import { getSettings, setSettings } from "@/settings/model";

import { providerNeedsSelfHostWarning } from "@/modelManagement/providers/selfHostPolicy";
import type { BackendConfig, BackendType } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";

// Shared frozen empty so `get()` returns a stable reference for backends
// that haven't been touched yet — Jotai derived atoms and React memos
// short-circuit on `===`. See AGENTS.md → "Referential stability".
const EMPTY_ENABLED: string[] = Object.freeze([]) as unknown as string[];
const EMPTY_CONFIG: BackendConfig = Object.freeze({
  enabledModels: EMPTY_ENABLED,
});

const EMPTY_RESOLVED: readonly EnabledBackendEntry[] = Object.freeze([]);

// Positional equality — same length, same order, same ids. The enabled-
// models list is a display order, not a set, so reorders are real writes.
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

  // Listeners fire when the `backends` settings slice actually changes (by
  // reference). Consumers that bake the enabled-models list into spawn-time
  // config (notably the opencode backend's `OPENCODE_CONFIG_CONTENT`) hang
  // off this so a fresh spawn picks up the new set.
  readonly #listeners = new Set<() => void>();

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
  }

  /** Subscribe to enabled-models mutations. Returns unsubscribe. Fires
   *  after the change has been persisted. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    // Snapshot before iterating so a listener that (un)subscribes mid-emit
    // doesn't fire a phantom notification or skip a peer.
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (err) {
        logError("[modelManagement] BackendConfigRegistry listener threw", err);
      }
    }
  }

  /** Run `mutate`, then emit only if `settings.backends` changed by reference
   *  (cheap and accurate — the registry's writers always allocate a fresh
   *  slice on real changes, and return `{}` from the updater on no-ops). */
  #mutateAndEmit(mutate: () => void): void {
    const before = getSettings().backends;
    mutate();
    if (getSettings().backends !== before) this.#emit();
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Returns a `BackendConfig` even when none is persisted yet —
   *  empty default `{ enabledModels: [] }` so callers don't have to
   *  null-check. The same `EMPTY_CONFIG` reference is returned for
   *  every untouched backend (referential stability). */
  get(backend: BackendType): BackendConfig {
    return getSettings().backends[backend] ?? EMPTY_CONFIG;
  }

  /**
   * Resolve `enabledModels` (an array of `configuredModelId`s) into
   * picker-ready entries by joining against the current
   * ConfiguredModel + Provider state. Order preserved. Broken refs
   * surface as `state: "broken"` rather than silently dropping (data-
   * model spec invariant #3).
   *
   * While Self-Host Mode is on, cloud-provider entries are annotated with
   * `needsSelfHostWarning` (not dropped): the UI flags them and sorts them last,
   * but the runtime still sees every enabled model in its original order. This
   * matters because this method feeds the opencode provider-config injection and
   * chat model resolution — both rely on order, and Self-Host Mode is a
   * presentation label, not a technical egress block. Read-time projection:
   * `settings.backends` is never rewritten, so the flags clear when the mode is
   * turned off. Broken entries carry no provider to flag on.
   */
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

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Replace the enabled-models list for a backend.
   */
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

  /** Idempotent: appending an already-enabled id is a no-op. */
  async enableModel(backend: BackendType, configuredModelId: string): Promise<void> {
    const existing = getSettings().backends[backend];
    if (existing?.enabledModels.includes(configuredModelId)) return;
    this.#mutateAndEmit(() => {
      setSettings((cur) => {
        const current = cur.backends[backend];
        // Re-check inside the updater so a concurrent write that already
        // added the id doesn't produce a duplicate row.
        if (current?.enabledModels.includes(configuredModelId)) return {};
        const next: BackendConfig = {
          enabledModels: [...(current?.enabledModels ?? []), configuredModelId],
        };
        return { backends: { ...cur.backends, [backend]: next } };
      });
    });
  }

  /** Idempotent. */
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

  /**
   * Used by `ModelManagementCoordinator` to drop refs to deleted
   * configured models. Sweeps every backend's `enabledModels`. Single
   * `setSettings` write so subscribers only see one settings revision
   * per cascade.
   */
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
