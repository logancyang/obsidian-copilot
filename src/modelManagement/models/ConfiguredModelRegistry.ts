/**
 * Source of truth for `ConfiguredModel` rows.
 *
 * Wraps `settings.configuredModels: ConfiguredModel[]` with typed reads
 * and mutations. Uniqueness invariant: `(providerId, info.id)` —
 * enforced on `add()` and implicit in `bulkSet()` writes.
 *
 * React components consume reactive reads through the atoms in
 * `state/atoms.ts`. This class is for mutations and non-React callers.
 *
 * Referential stability — read methods cache their result keyed on the
 * source-slice reference (`getSettings().configuredModels`). On a cache
 * hit (slice unchanged since last call) the same array reference is
 * returned. `bulkSet` preserves `configuredModelId` + `configuredAt`
 * when `(providerId, info.id)` matches an existing row (so external
 * refs like `BackendConfig.enabledModels` don't churn), and reuses the
 * row reference verbatim only when the same `info` object is passed
 * back in. See AGENTS.md → "Referential stability".
 */

import { v4 as uuidv4 } from "uuid";

import { getSettings, setSettings } from "@/settings/model";
import { frozenOr, sliceMemoByKey } from "@/utils/sliceCache";

import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { ConfiguredModel } from "@/modelManagement/types/persisted";

// Frozen empty shared across all reads (both `list()` and filtered
// views) so consumers see a stable reference for the zero case.
const EMPTY_LIST: readonly ConfiguredModel[] = Object.freeze([]);

export class ConfiguredModelRegistry {
  // Per-provider cache keyed on the source-slice reference; see
  // `@/utils/sliceCache` for the underlying pattern.
  readonly #byProvider = sliceMemoByKey((source: readonly ConfiguredModel[], providerId: string) =>
    frozenOr(
      source.filter((m) => m.providerId === providerId),
      EMPTY_LIST
    )
  );

  /**
   * No constructor args — `settings.configuredModels` is read/written
   * through the module-level helpers in `@/settings/model`, not
   * through Obsidian APIs.
   */
  constructor() {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  list(): readonly ConfiguredModel[] {
    const source = getSettings().configuredModels;
    return source.length === 0 ? EMPTY_LIST : source;
  }

  listByProvider(providerId: string): readonly ConfiguredModel[] {
    return this.#byProvider(getSettings().configuredModels, providerId);
  }

  get(configuredModelId: string): ConfiguredModel | undefined {
    return getSettings().configuredModels.find((m) => m.configuredModelId === configuredModelId);
  }

  /** Resolve by the wire-form id under a specific provider. Used when
   *  reconciling external references — e.g. an agent picker rehydrating
   *  `<providerId>/<wireId>` strings into rows. */
  getByWireId(providerId: string, wireModelId: string): ConfiguredModel | undefined {
    return getSettings().configuredModels.find(
      (m) => m.providerId === providerId && m.info.id === wireModelId
    );
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /** Mints `configuredModelId`, stamps `configuredAt`. Throws if the
   *  `(providerId, info.id)` pair already exists. */
  async add(input: Omit<ConfiguredModel, "configuredModelId" | "configuredAt">): Promise<string> {
    const existing = getSettings().configuredModels;
    if (existing.some((m) => m.providerId === input.providerId && m.info.id === input.info.id)) {
      throw new Error(
        `[modelManagement] ConfiguredModelRegistry.add: ` +
          `model "${input.info.id}" already configured for providerId ${input.providerId}`
      );
    }
    const configuredModelId = uuidv4();
    const row: ConfiguredModel = {
      ...input,
      configuredModelId,
      configuredAt: Date.now(),
    };
    setSettings((cur) => ({
      configuredModels: [...cur.configuredModels, row],
    }));
    return configuredModelId;
  }

  /** Patches `info` only — id / providerId / configuredAt are
   *  immutable. Used by `CopilotPlusSetupApi` to refresh model
   *  metadata when Plus updates context limits / pricing. */
  async update(configuredModelId: string, patch: { info?: Partial<ModelInfo> }): Promise<void> {
    const existing = getSettings().configuredModels.find(
      (m) => m.configuredModelId === configuredModelId
    );
    if (!existing) {
      throw new Error(
        `[modelManagement] ConfiguredModelRegistry.update: unknown configuredModelId ${configuredModelId}`
      );
    }
    if (!patch.info) return;
    const next: ConfiguredModel = {
      ...existing,
      info: { ...existing.info, ...patch.info },
    };
    setSettings((cur) => ({
      configuredModels: cur.configuredModels.map((m) =>
        m.configuredModelId === configuredModelId ? next : m
      ),
    }));
  }

  async remove(configuredModelId: string): Promise<void> {
    setSettings((cur) => ({
      configuredModels: cur.configuredModels.filter(
        (m) => m.configuredModelId !== configuredModelId
      ),
    }));
  }

  /**
   * Replace the set of configured models under one provider in a
   * single write. Used by "Configure Provider → save" where the user
   * picked N catalog models at once. Existing rows with matching
   * `(providerId, info.id)` are preserved by id so downstream
   * `BackendConfig.enabledModels` refs don't churn. Returns the
   * resulting `configuredModelId`s in input order.
   */
  async bulkSet(providerId: string, infos: readonly ModelInfo[]): Promise<string[]> {
    const current = getSettings().configuredModels;
    const existingForProvider = new Map<string, ConfiguredModel>();
    for (const m of current) {
      if (m.providerId === providerId) existingForProvider.set(m.info.id, m);
    }

    const resultIds: string[] = [];
    const reusedOrNew: ConfiguredModel[] = [];
    // Dedupe within the input: callers must not pass duplicate `info.id`
    // entries (the `(providerId, info.id)` invariant `add()` enforces).
    // Silently drop later duplicates rather than emit rows that violate
    // it.
    const seenInfoIds = new Set<string>();
    const now = Date.now();
    for (const info of infos) {
      if (seenInfoIds.has(info.id)) continue;
      seenInfoIds.add(info.id);
      const reused = existingForProvider.get(info.id);
      if (reused) {
        // Preserve `configuredModelId` + `configuredAt` so external refs
        // (BackendConfig.enabledModels) don't churn, but adopt the
        // caller-supplied `info` — they may have passed refreshed
        // catalog metadata (displayName, context limits, pricing).
        // Reuse the row reference verbatim when the persisted info is
        // structurally equal to the incoming info, so a catalog refresh
        // that rebuilds equal-but-fresh info objects doesn't churn the
        // row identity for every downstream memoization site.
        reusedOrNew.push(isSameInfo(reused.info, info) ? reused : { ...reused, info });
        resultIds.push(reused.configuredModelId);
      } else {
        const configuredModelId = uuidv4();
        const row: ConfiguredModel = {
          configuredModelId,
          providerId,
          info,
          configuredAt: now,
        };
        reusedOrNew.push(row);
        resultIds.push(configuredModelId);
      }
    }

    setSettings((cur) => ({
      configuredModels: [
        ...cur.configuredModels.filter((m) => m.providerId !== providerId),
        ...reusedOrNew,
      ],
    }));
    return resultIds;
  }

  /** Used by `ModelManagementCoordinator.removeProvider` to drop all
   *  models under a provider during cascade. */
  async removeByProvider(providerId: string): Promise<void> {
    setSettings((cur) => ({
      configuredModels: cur.configuredModels.filter((m) => m.providerId !== providerId),
    }));
  }
}

/**
 * Structural equality for `ModelInfo`. Cheap stringify is sufficient
 * here — the type is a small bag of primitives plus a few flat nested
 * objects (`modalities`, `limits`, `cost`) whose key order is stable
 * across both the catalog fetcher (writes them in a fixed order) and
 * Plus-side refresh paths. A `JSON.stringify` mismatch on equal content
 * costs at most a fresh row spread; correctness is preserved either
 * way.
 */
function isSameInfo(a: ModelInfo, b: ModelInfo): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
