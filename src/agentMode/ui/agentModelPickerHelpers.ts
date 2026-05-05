import type { ModelInfo, SessionModelState } from "@agentclientprotocol/sdk";
import type { CustomModel } from "@/aiParams";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { getModelKeyFromModel } from "@/settings/model";
import type { CopilotSettings } from "@/settings/model";
import { dedupeAvailableModels, stripEffortSuffix } from "@/agentMode/session/effortAdapter";
import { isAgentModelEnabledOrKept } from "@/agentMode/session/modelEnable";
import type { BackendDescriptor } from "@/agentMode/session/types";

/** A pseudo-provider value used for agent-only synthesized entries. */
export const AGENT_PROVIDER = "agent";

/**
 * Resolve an optimistic `SessionModelState` for the active backend: prefer
 * live, fall back to preloader cache. When the cached `currentModelId` isn't
 * actually in `availableModels` (rare — stale probe), prefer the user's
 * persisted preference if present.
 */
export function resolveOptimisticModelState(
  live: SessionModelState | null,
  backendId: string | null,
  descriptor: BackendDescriptor | undefined,
  getCached: (id: string) => SessionModelState | null,
  settings: CopilotSettings
): SessionModelState | null {
  if (live) return live;
  if (!backendId) return null;
  const cached = getCached(backendId);
  if (!cached) return null;
  const ids = new Set(cached.availableModels.map((m) => m.modelId));
  if (ids.has(cached.currentModelId)) return cached;
  const preferred = descriptor?.getPreferredModelId?.(settings);
  if (preferred && ids.has(preferred)) {
    return { availableModels: cached.availableModels, currentModelId: preferred };
  }
  return cached;
}

export function appendBackendSection(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  activeModels: CustomModel[],
  ctx: {
    liveAvailable: ReadonlyArray<ModelInfo> | null;
    isRunning: boolean;
    isActiveBackend: boolean;
    overrides: Record<string, boolean> | undefined;
    /** Agent-native modelId of the active session — never filtered out. */
    keepModelId: string | null;
  }
): void {
  const filterFn = descriptor.filterCopilotModels;
  const translateFn = descriptor.copilotModelKeyToAgentModelId;
  const reverseProviderFn = descriptor.agentModelIdToCopilotProvider;
  const partition = filterFn
    ? filterFn(activeModels)
    : { compatible: [] as CustomModel[], incompatible: [] as CustomModel[] };

  // Collapse opencode-style per-variant entries before any iteration so the
  // dropdown shows one row per base model and the curated/synthesized
  // dedupe checks operate on the same id surface.
  const dedupedLive = ctx.liveAvailable
    ? dedupeAvailableModels(ctx.liveAvailable, descriptor)
    : null;

  // Apply the user's enable/disable overrides. The collapsed `dedupedLive`
  // entries are matched by `modelId`, which is the same key written by the
  // settings tab toggles. `keepModelId` carves out the user's current
  // selection so curation never strands it.
  const filteredLive = dedupedLive
    ? dedupedLive.filter((m) =>
        isAgentModelEnabledOrKept(descriptor, m, ctx.overrides, ctx.keepModelId)
      )
    : null;

  const liveIds = new Set((filteredLive ?? []).map((m) => m.modelId));
  const curatedProviders = new Set<string>();
  const curatedAgentIds = new Set<string>();
  const compiled = partition.compatible
    .map((m) => ({ m, agentId: translateFn?.(m) }))
    // Curated entries inherit the same toggle. We can only check overrides
    // when we know the agent-native id for the model — entries without one
    // can't be filtered (no key to look up) and pass through. Use the
    // CustomModel's display name so a backend's default policy that pattern-
    // matches on `name` (e.g. opencode "Big Pickle") still sees the curated
    // human label even when `agentId` is opaque.
    .filter(({ m, agentId }) => {
      if (!agentId) return true;
      const synthetic: ModelInfo = { modelId: agentId, name: m.name || agentId };
      return isAgentModelEnabledOrKept(descriptor, synthetic, ctx.overrides, ctx.keepModelId);
    });
  for (const { m, agentId } of compiled) {
    curatedProviders.add(m.provider);
    if (agentId) curatedAgentIds.add(agentId);
  }

  for (const { m, agentId } of compiled) {
    const isAvailable = ctx.isRunning && agentId !== undefined && liveIds.has(agentId);
    let disabledReason: string | undefined;
    if (ctx.isActiveBackend && !ctx.isRunning) {
      disabledReason = `Start ${descriptor.displayName} session to use`;
    } else if (ctx.isActiveBackend && !isAvailable) {
      disabledReason = "Restart agent to load";
    }
    entries.push({
      ...m,
      enabled: true,
      _group: descriptor.displayName,
      _backendId: descriptor.id,
      _disabledReason: disabledReason,
    });
  }

  // Live entries — surface uncurated models. Skip providers the user has
  // already curated; those should not be drowned out by the agent catalog.
  if (!filteredLive) return;
  for (const m of filteredLive) {
    if (curatedAgentIds.has(m.modelId)) continue;
    const copilotProvider = reverseProviderFn?.(m.modelId);
    if (copilotProvider && curatedProviders.has(copilotProvider)) continue;
    entries.push(synthesizeAgentEntry(m.modelId, m.name, descriptor));
  }
}

export function synthesizeAgentEntry(
  modelId: string,
  humanName: string,
  descriptor: BackendDescriptor
): ModelSelectorEntry {
  // `name` is the agent-native model id verbatim; uniqueness across backends
  // comes from `_backendId`, which `getModelKeyFromModel` prefixes into the
  // returned key.
  return {
    name: modelId,
    provider: AGENT_PROVIDER,
    enabled: true,
    isBuiltIn: false,
    displayName: humanName || modelId,
    _group: descriptor.displayName,
    _backendId: descriptor.id,
  };
}

export function computeValueKeyForActive(
  currentModelId: string,
  collapsedId: string,
  descriptor: BackendDescriptor,
  activeModels: CustomModel[]
): string {
  const translateFn = descriptor.copilotModelKeyToAgentModelId;
  if (translateFn) {
    const filterFn = descriptor.filterCopilotModels;
    const partition = filterFn
      ? filterFn(activeModels)
      : { compatible: activeModels, incompatible: [] };
    const match = partition.compatible.find((m) => translateFn(m) === currentModelId);
    // Curated entries pushed by `appendBackendSection` carry `_backendId`,
    // so their keys are prefixed (`<backend>:<name>|<provider>`). The match
    // comes straight from `activeModels` and lacks the prefix — re-attach it
    // here so the returned key compares equal to the entry the picker stored.
    if (match) return getModelKeyFromModel({ ...match, _backendId: descriptor.id });
  }
  // For effort-variant backends, match the id retained by
  // `dedupeAvailableModels`: bare id when advertised, otherwise the first
  // concrete variant observed for this base.
  return getModelKeyFromModel({
    name: collapsedId,
    provider: AGENT_PROVIDER,
    _backendId: descriptor.id,
  } as CustomModel & { _backendId: string });
}

/**
 * Resolve the model id used for a collapsed picker row while preserving an
 * advertised id for effort-only catalogs.
 */
export function resolveCollapsedModelId(
  modelId: string,
  availableModels: ReadonlyArray<ModelInfo>,
  descriptor: BackendDescriptor
): string {
  const parsedCurrent = descriptor.parseEffortFromModelId?.(modelId);
  if (!parsedCurrent) return modelId;

  let firstVariant: string | null = null;
  for (const m of availableModels) {
    const parsed = descriptor.parseEffortFromModelId?.(m.modelId);
    if (!parsed || parsed.baseId !== parsedCurrent.baseId) continue;
    if (parsed.effort === null) return m.modelId;
    firstVariant ??= m.modelId;
  }
  return firstVariant ?? modelId;
}

/**
 * For effort-in-modelId backends (codex/opencode), recompose a picker-
 * resolved agent id with the user's saved effort. The picker collapses
 * per-effort variants into one row per base, so the surviving entry's
 * effort is whichever variant `dedupeAvailableModels` happened to keep —
 * not necessarily what the user picked.
 */
export function preserveSavedEffort(
  agentId: string,
  descriptor: BackendDescriptor,
  settings: CopilotSettings
): string {
  if (!descriptor.parseEffortFromModelId || !descriptor.composeModelId) return agentId;
  const parsedNew = descriptor.parseEffortFromModelId(agentId);
  if (!parsedNew) return agentId;
  const savedId = descriptor.getPreferredModelId?.(settings);
  const savedEffort = savedId ? descriptor.parseEffortFromModelId(savedId)?.effort : null;
  if (!savedEffort) return agentId;
  return descriptor.composeModelId(parsedNew.baseId, savedEffort);
}

export function resolveAgentId(
  entry: ModelSelectorEntry,
  descriptor: BackendDescriptor,
  activeModels: CustomModel[]
): string | undefined {
  // Synthesized agent entries store the raw agent model id directly in `name`.
  if (entry.provider === AGENT_PROVIDER) return entry.name;
  if (!descriptor.copilotModelKeyToAgentModelId) return undefined;
  const match = activeModels.find((m) => m.name === entry.name && m.provider === entry.provider);
  if (!match) return undefined;
  return descriptor.copilotModelKeyToAgentModelId(match);
}

/**
 * For a synthesized agent entry whose `name` is the live `modelId`, replace
 * the display label with the cleaned human name (effort suffix stripped).
 */
export function buildSynthesizedActiveEntry(
  currentInfo: ModelInfo,
  collapsedActiveId: string | null,
  descriptor: BackendDescriptor
): ModelSelectorEntry {
  const parsed = descriptor.parseEffortFromModelId?.(currentInfo.modelId);
  const synthesizedId = collapsedActiveId ?? currentInfo.modelId;
  const cleanName = stripEffortSuffix(currentInfo.name, parsed?.effort) || currentInfo.name;
  return synthesizeAgentEntry(synthesizedId, cleanName, descriptor);
}
