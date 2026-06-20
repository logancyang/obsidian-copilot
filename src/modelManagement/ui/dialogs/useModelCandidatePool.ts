/**
 * `useModelCandidatePool` — the model-selection state machine behind
 * `ConfigureProviderForm`. It owns the candidate pool (existing ∪ fetched ∪
 * manual − removed), the live `GET /models` fetch, and the catalog →
 * snapshot → synthesize precedence used to materialize `ModelInfo`s for the
 * picker and the save path. The dialog body is left as a thin presenter that
 * reads `availableModels` / `selectedWireIds` and routes ticks through the
 * returned actions.
 *
 * `models.dev` (the catalog) is a metadata enhancer here, never a source of
 * truth: candidate ids come from existing configured models (edit), the live
 * endpoint, or manual entry. Catalog hits only enrich row labels/limits.
 */
import { looksLikeEmbeddingModel } from "@/modelManagement/catalog/catalogTransform";
import {
  applyCapsToModelInfo,
  capsFromModelInfo,
  type CapFlags,
} from "@/modelManagement/chatModel/modelCapabilityFlags";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { listProviderModels } from "@/modelManagement/providers/adapters/listProviderModels";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel } from "@/modelManagement/types/persisted";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_CAP_OVERRIDES: Readonly<Record<string, CapFlags>> = Object.freeze({});

export interface UseModelCandidatePoolArgs {
  mode: "new" | "edit";
  /** Edit mode only — the provider whose saved key the fetch falls back to. */
  providerId: string | undefined;
  providerType: ProviderType | undefined;
  effectiveBaseUrl: string;
  existingModels: readonly ConfiguredModel[];
  /** Catalog metadata for row enrichment; referentially stable per provider. */
  catalogMetadata: Record<string, ModelInfo>;
  /** Read lazily inside the fetch so edits don't re-fire the mount fetch. */
  apiKey: string;
  extras: Record<string, unknown>;
  /** New mode: skip the mount fetch until the user has typed a key. */
  requiresApiKey: boolean;
  /** Edit mode: gate the mount fetch on the provider row having hydrated. */
  providerHydrated: boolean;
  /**
   * Per-wire-id capability overrides from the Advanced panel. `buildSelectedModelInfos`
   * overlays these onto each selected non-embedding model so the user's vision/reasoning
   * choices survive catalog-wins precedence on re-save (Risk R1). Embedding models are
   * never overlaid.
   */
  capOverrides?: Readonly<Record<string, CapFlags>>;
  api: ModelManagementApi;
}

export interface ModelCandidatePool {
  availableModels: readonly ModelInfo[];
  customIds: ReadonlySet<string>;
  selectedWireIds: ReadonlySet<string>;
  /** Existing rows the user X'd this session — the save path persists these. */
  removedExistingIds: ReadonlySet<string>;
  fetching: boolean;
  fetchError: string | null;
  resolveModelInfo: (id: string) => ModelInfo;
  buildSelectedModelInfos: () => ModelInfo[];
  toggle: (wireId: string, next: boolean) => void;
  addId: (id: string) => void;
  removeId: (id: string) => void;
  /** Re-run the live model fetch (e.g. after a successful credential test). */
  fetchModels: () => Promise<void>;
}

export function useModelCandidatePool({
  mode,
  providerId,
  providerType,
  effectiveBaseUrl,
  existingModels,
  catalogMetadata,
  apiKey,
  extras,
  requiresApiKey,
  providerHydrated,
  capOverrides = EMPTY_CAP_OVERRIDES,
  api,
}: UseModelCandidatePoolArgs): ModelCandidatePool {
  const [selectedWireIds, setSelectedWireIds] = useState<Set<string>>(() =>
    mode === "edit" ? new Set(existingModels.map((m) => m.info.id)) : new Set()
  );
  const [fetchedIds, setFetchedIds] = useState<string[]>([]);
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [removedExistingIds, setRemovedExistingIds] = useState<Set<string>>(() => new Set());
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const existingByWireId = useMemo(
    () => new Map(existingModels.map((m) => [m.info.id, m.info])),
    [existingModels]
  );

  // Single resolver for the catalog → snapshot → synthesize precedence so
  // the picker and the save path don't drift on what gets persisted.
  const resolveModelInfo = useCallback(
    (id: string): ModelInfo =>
      catalogMetadata[id] ??
      existingByWireId.get(id) ??
      ({
        id,
        displayName: id,
        ...(looksLikeEmbeddingModel(id) ? { isEmbedding: true } : {}),
      } satisfies ModelInfo),
    [catalogMetadata, existingByWireId]
  );

  // Candidate pool — existing (edit) ∪ fetched ∪ manual, with insertion
  // order preserved so the user sees rows in the order they appeared.
  const availableModels = useMemo<readonly ModelInfo[]>(() => {
    const seen = new Set<string>();
    const out: ModelInfo[] = [];
    const push = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(resolveModelInfo(id));
    };
    for (const m of existingModels) {
      if (removedExistingIds.has(m.info.id)) continue;
      push(m.info.id);
    }
    for (const id of fetchedIds) push(id);
    for (const id of manualIds) push(id);
    return out;
  }, [existingModels, fetchedIds, manualIds, resolveModelInfo, removedExistingIds]);

  // Custom-added ids — drives both the X-button visibility and the
  // custom-first sort tier in the checklist. An id is custom if the user
  // hand-typed it this session, OR (for previously-saved rows in edit mode)
  // it's not known to the catalog and the live endpoint didn't surface it.
  // When the catalog is offline and the fetch fails, saved rows degrade to
  // "all custom" — same as today's pre-fix behavior, no regression.
  const customIds = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>(manualIds);
    const fetched = new Set(fetchedIds);
    for (const m of existingModels) {
      if (removedExistingIds.has(m.info.id)) continue;
      if (!catalogMetadata[m.info.id] && !fetched.has(m.info.id)) {
        set.add(m.info.id);
      }
    }
    return set;
  }, [manualIds, fetchedIds, existingModels, catalogMetadata, removedExistingIds]);

  // Track the merged "known id" set in a ref so `fetchModels` can diff
  // without depending on `fetchedIds` / `manualIds` (which would re-fire
  // the mount-fetch effect every time the user adds a manual id).
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const id of existingByWireId.keys()) next.add(id);
    for (const id of fetchedIds) next.add(id);
    for (const id of manualIds) next.add(id);
    knownIdsRef.current = next;
  }, [existingByWireId, fetchedIds, manualIds]);

  const fetchModels = useCallback(async (): Promise<void> => {
    if (!providerType || !effectiveBaseUrl) return;
    setFetching(true);
    setFetchError(null);
    try {
      let key: string | null = apiKey || null;
      if (!key && mode === "edit" && providerId) {
        key = await api.providerRegistry.getApiKey(providerId);
      }
      const result = await listProviderModels(providerType, effectiveBaseUrl, {
        apiKey: key,
        extras,
      });
      if (result === null) return; // adapter not supported (azure / bedrock)
      if (result.ok) {
        // Discovered ids populate the candidate list only — the user
        // explicitly ticks the ones they want before Save. Diff against
        // the known-id pool so re-fetches don't duplicate rows.
        const known = knownIdsRef.current;
        const trulyNew = result.modelIds.filter((id) => !known.has(id));
        if (trulyNew.length > 0) {
          setFetchedIds((prev) => [...prev, ...trulyNew]);
        }
      } else {
        setFetchError(result.message);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }, [providerType, effectiveBaseUrl, apiKey, extras, mode, providerId, api]);

  // Auto-fetch once on mount. In edit mode wait for the provider row to
  // hydrate so the saved-key probe uses the correct providerId. Skip in new
  // mode when the provider requires a key and the field is still empty — the
  // adapter would 401 and noise the picker with a misleading auth error
  // before the user has typed anything. A successful test re-fires the fetch.
  const mountFetchedRef = useRef(false);
  useEffect(() => {
    if (mountFetchedRef.current) return;
    if (!providerType || !effectiveBaseUrl) return;
    if (mode === "edit" && !providerHydrated) return;
    if (mode === "new" && requiresApiKey && !apiKey) return;
    mountFetchedRef.current = true;
    void fetchModels();
  }, [mode, providerHydrated, providerType, effectiveBaseUrl, requiresApiKey, apiKey, fetchModels]);

  const toggle = useCallback((wireId: string, next: boolean): void => {
    setSelectedWireIds((prev) => {
      const nextSet = new Set(prev);
      if (next) nextSet.add(wireId);
      else nextSet.delete(wireId);
      return nextSet;
    });
  }, []);

  const addId = useCallback((id: string): void => {
    // Manual add: append to the manual pool (skipping if already present)
    // and auto-check, since the user explicitly typed it.
    setManualIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSelectedWireIds((prev) => {
      if (prev.has(id)) return prev;
      const ns = new Set(prev);
      ns.add(id);
      return ns;
    });
  }, []);

  const removeId = useCallback(
    (id: string): void => {
      setFetchedIds((prev) => prev.filter((x) => x !== id));
      setManualIds((prev) => prev.filter((x) => x !== id));
      setSelectedWireIds((prev) => {
        if (!prev.has(id)) return prev;
        const ns = new Set(prev);
        ns.delete(id);
        return ns;
      });
      // Saved-custom rows live in `existingModels` (sourced from atoms);
      // mark them removed locally so the row disappears now. Unchecking
      // them above lets the save path's deselect-and-bulkSet logic persist
      // the removal on save.
      if (existingByWireId.has(id)) {
        setRemovedExistingIds((prev) => {
          if (prev.has(id)) return prev;
          const ns = new Set(prev);
          ns.add(id);
          return ns;
        });
      }
    },
    [existingByWireId]
  );

  // Resolved `ModelInfo`s for the selected ids — same precedence the picker
  // rendered, so what gets persisted matches what the user saw. For every
  // selected non-embedding model we overlay an effective `CapFlags`:
  //   user override (Advanced panel)  ??  the saved snapshot's caps  ??  resolved caps.
  // The saved-snapshot fallback is the Risk R1 fix: `resolveModelInfo` is
  // catalog-first, so without re-asserting the saved caps a re-save would
  // silently discard a prior vision/reasoning override the catalog disagrees
  // with — even when the user never opened the Advanced panel. Embedding
  // models are never overlaid.
  const buildSelectedModelInfos = useCallback(
    (): ModelInfo[] =>
      [...selectedWireIds].map((id) => {
        const info = resolveModelInfo(id);
        if (info.isEmbedding) return info;
        const savedInfo = existingByWireId.get(id);
        const effective = capsFromModelInfo(savedInfo ?? info);
        const caps = capOverrides[id] ?? effective;
        return applyCapsToModelInfo(info, caps);
      }),
    [selectedWireIds, resolveModelInfo, capOverrides, existingByWireId]
  );

  return {
    availableModels,
    customIds,
    selectedWireIds,
    removedExistingIds,
    fetching,
    fetchError,
    resolveModelInfo,
    buildSelectedModelInfos,
    toggle,
    addId,
    removeId,
    fetchModels,
  };
}
