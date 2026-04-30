import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Notice } from "obsidian";
import type { ModelInfo, SessionModelState } from "@agentclientprotocol/sdk";
import type { CustomModel } from "@/aiParams";
import { logError } from "@/logger";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { backendRegistry, listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import {
  buildEffortAdapter,
  dedupeAvailableModels,
  stripEffortSuffix,
  type EffortAdapter,
} from "@/agentMode/session/effortAdapter";
import { isAgentModelEnabledOrKept } from "@/agentMode/session/modelEnable";
import { getBackendModelOverrides } from "@/agentMode/session/backendSettingsAccess";
import {
  buildModeAdapter,
  type CopilotMode,
  type ModeAdapter,
} from "@/agentMode/session/modeAdapter";
import type { BackendDescriptor } from "@/agentMode/session/types";

export interface AgentModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
  disabled?: boolean;
  /**
   * Sibling effort picker, present only when the active model belongs to a
   * group with multiple efforts (opencode-style modelId variants) or
   * exposes an effort `SessionConfigOption` (claude-code-style).
   */
  effort?: {
    options: { label: string; value: string | null }[];
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  };
  /**
   * Sibling mode picker — Copilot-canonical operational modes (build/plan/
   * auto-build) mapped per-backend to native ACP modes (Claude permission
   * modes, Codex sandbox presets) or to OpenCode's managed agents. Absent
   * when the active backend doesn't support any canonical mode.
   */
  mode?: {
    options: { label: string; value: CopilotMode }[];
    value: CopilotMode | null;
    onChange: (value: CopilotMode) => void;
    disabled?: boolean;
  };
}

/** A pseudo-provider value used for agent-only synthesized entries. */
const AGENT_PROVIDER = "agent";

/**
 * Build the `modelPickerOverride` for `ChatInput` — one grouped section per
 * registered backend. Backends that integrate with Copilot contribute
 * curated entries; others contribute their live `availableModels` (active
 * session or preloader cache). Once the active session has any user-visible
 * messages, non-active backend sections are hidden so picks can't muddle
 * mid-conversation history; cross-backend picks on an empty tab swap the
 * tab for a fresh session on the target backend.
 */
export function useAgentModelPicker(
  manager: AgentSessionManager | null
): AgentModelPickerOverride | null {
  const settings = useSettingsValue();
  const descriptors = useMemo(() => listBackendDescriptors(), []);

  // Subscribe to preloader cache updates as a useMemo dep, so the picker
  // rebuilds when models arrive after first render. Snapshot is a string
  // keyed off cached counts and current id per backend.
  const subscribeCache = useCallback(
    (cb: () => void) => manager?.subscribeModelCache(cb) ?? (() => {}),
    [manager]
  );
  const getCacheSnapshot = useCallback(() => {
    if (!manager) return "";
    return descriptors
      .map((d) => {
        const c = manager.getCachedModels(d.id);
        const m = manager.getCachedModes(d.id);
        const o = manager.getCachedConfigOptions(d.id);
        const cfgSig = (o ?? [])
          .map((opt) => `${opt.id}=${"currentValue" in opt ? String(opt.currentValue) : ""}`)
          .join(";");
        return `${d.id}=${c?.currentModelId ?? ""}/${c?.availableModels.length ?? 0}|${m?.currentModeId ?? ""}/${m?.availableModes.length ?? 0}|${cfgSig}`;
      })
      .join(",");
  }, [manager, descriptors]);
  const cacheSnapshot = useSyncExternalStore(subscribeCache, getCacheSnapshot, getCacheSnapshot);

  // Re-render only when picker-relevant state changes. The chat UI state
  // notifies on every streamed chunk during a turn, but none of those change
  // the picker's view of the world — short-circuiting via a signature keeps
  // the dropdown's `useMemo` from rebuilding on every tick.
  const [, forceRender] = useState(0);
  const sigRef = useRef<string>("");
  useEffect(() => {
    if (!manager) return;

    const computeSignature = (): string => {
      const session = manager.getActiveSession();
      const ui = manager.getActiveChatUIState();
      const running = descriptors
        .map((d) => `${d.id}:${manager.getBackendProcess(d.id)?.isRunning() ? "1" : "0"}`)
        .join(",");
      // configOptions: hash by id + currentValue. Picker re-renders when the
      // effort adapter would change shape — adding/removing the option,
      // flipping its currentValue, or shifting select choices.
      const configOpts = (ui?.getConfigOptions() ?? [])
        .map((o) => `${o.id}=${"currentValue" in o ? String(o.currentValue) : ""}`)
        .join(",");
      const modeState = ui?.getModeState();
      const modeSig = modeState
        ? `${modeState.currentModeId}#${modeState.availableModes.map((m) => m.id).join(",")}`
        : "";
      return [
        session?.internalId ?? "",
        session?.backendId ?? "",
        session?.hasUserVisibleMessages() ? "1" : "0",
        ui?.getModelState()?.currentModelId ?? "",
        ui?.isModelSwitchSupported() ?? "",
        ui?.isSetModeSupported() ?? "",
        running,
        configOpts,
        modeSig,
      ].join("|");
    };

    const tick = (): void => {
      const next = computeSignature();
      if (next === sigRef.current) return;
      sigRef.current = next;
      forceRender((n) => n + 1);
    };

    // Active chat UI state can change identity on session swap. Re-wire the
    // per-turn subscription whenever the manager fires a lifecycle event.
    let unsubActive: (() => void) | null = null;
    let lastUI: ReturnType<typeof manager.getActiveChatUIState> = null;
    const rewireActive = (): void => {
      const cur = manager.getActiveChatUIState();
      if (cur === lastUI) return;
      unsubActive?.();
      lastUI = cur;
      unsubActive = cur?.subscribe(tick) ?? null;
    };
    rewireActive();

    const unsub = manager.subscribe(() => {
      rewireActive();
      tick();
    });
    return () => {
      unsub();
      unsubActive?.();
    };
  }, [manager, descriptors]);

  const activeChatUIState = manager?.getActiveChatUIState() ?? null;
  const activeSession = manager?.getActiveSession() ?? null;
  const activeModelState = activeChatUIState?.getModelState() ?? null;
  const activeConfigOptions = activeChatUIState?.getConfigOptions() ?? null;
  const activeModeState = activeChatUIState?.getModeState() ?? null;
  const isModelSwitchSupported = activeChatUIState?.isModelSwitchSupported() ?? null;
  const isSetConfigOptionSupported = activeChatUIState?.isSetSessionConfigOptionSupported() ?? null;
  const isSetModeSupported = activeChatUIState?.isSetModeSupported() ?? null;
  const activeBackendId = activeSession?.backendId ?? null;
  const activeSessionHasHistory = activeSession?.hasUserVisibleMessages() ?? false;

  return useMemo<AgentModelPickerOverride | null>(() => {
    if (!manager) return null;

    const entries: ModelSelectorEntry[] = [];
    const activeDescriptor = activeBackendId ? backendRegistry[activeBackendId] : undefined;

    // Fall back to preloader cache during session/new so the picker doesn't
    // blink empty. The live response replaces the cached state once it arrives.
    const optimisticModelState = resolveOptimisticModelState(
      activeModelState,
      activeBackendId,
      activeDescriptor,
      manager.getCachedModels.bind(manager),
      settings
    );
    const optimisticModeState =
      activeModeState ?? (activeBackendId ? manager.getCachedModes(activeBackendId) : null);
    const optimisticConfigOptions =
      activeConfigOptions ??
      (activeBackendId ? manager.getCachedConfigOptions(activeBackendId) : null);

    for (const descriptor of descriptors) {
      const isActiveBackend = descriptor.id === activeBackendId;
      if (!isActiveBackend && activeSessionHasHistory) continue;

      const cachedAvailable = manager.getCachedModels(descriptor.id)?.availableModels ?? null;
      const liveAvailable = isActiveBackend
        ? (optimisticModelState?.availableModels ?? cachedAvailable)
        : cachedAvailable;
      const isRunning = manager.getBackendProcess(descriptor.id)?.isRunning() ?? false;

      const overrides = getBackendModelOverrides(settings, descriptor.id);
      // Carve out the user's current pick so curation never strands it. For
      // the active backend that's the live session model; for inactive
      // backends, the persisted preference (base-id only, to match
      // `dedupedLive`).
      let keepModelId: string | null = null;
      if (isActiveBackend) {
        keepModelId = optimisticModelState?.currentModelId ?? null;
      } else {
        const persisted = descriptor.getPreferredModelId?.(settings);
        if (persisted) {
          keepModelId = descriptor.parseEffortFromModelId?.(persisted)?.baseId ?? persisted;
        }
      }
      appendBackendSection(entries, descriptor, settings.activeModels ?? [], {
        liveAvailable,
        isRunning,
        isActiveBackend,
        overrides,
        keepModelId,
      });
    }

    // Surface the session's current model if a curated/synthesized entry for
    // it isn't already present (stale selectedModelKey, or filtered out).
    const collapsedActiveId =
      activeDescriptor && optimisticModelState?.currentModelId
        ? resolveCollapsedModelId(
            optimisticModelState.currentModelId,
            optimisticModelState.availableModels,
            activeDescriptor
          )
        : null;
    const valueKey =
      activeBackendId && activeDescriptor && optimisticModelState
        ? computeValueKeyForActive(
            optimisticModelState.currentModelId,
            collapsedActiveId ?? optimisticModelState.currentModelId,
            activeDescriptor,
            settings.activeModels ?? []
          )
        : "";
    if (activeBackendId && activeDescriptor && optimisticModelState?.currentModelId) {
      const currentInfo = optimisticModelState.availableModels.find(
        (m) => m.modelId === optimisticModelState.currentModelId
      );
      if (currentInfo && !entries.some((e) => getModelKeyFromModel(e) === valueKey)) {
        const parsed = activeDescriptor.parseEffortFromModelId?.(currentInfo.modelId);
        const synthesizedId = collapsedActiveId ?? currentInfo.modelId;
        const cleanName = stripEffortSuffix(currentInfo.name, parsed?.effort) || currentInfo.name;
        entries.unshift(synthesizeAgentEntry(synthesizedId, cleanName, activeDescriptor));
      }
    }

    // Effort picker — built from either modelId-suffix variants (opencode)
    // or a SessionConfigOption (claude-code), normalized to one shape.
    let effortBlock: AgentModelPickerOverride["effort"] | undefined;
    if (activeBackendId && activeDescriptor && (optimisticModelState || optimisticConfigOptions)) {
      const adapter = buildEffortAdapter(activeDescriptor, {
        modelState: optimisticModelState,
        configOptions: optimisticConfigOptions,
      });
      if (adapter) {
        effortBlock = buildEffortOverride(
          adapter,
          activeBackendId,
          manager,
          isModelSwitchSupported,
          isSetConfigOptionSupported
        );
      }
    }

    // Mode picker — Copilot-canonical operational modes (build/plan/auto-build)
    // mapped per-backend to native ACP modes or OpenCode managed agents.
    let modeBlock: AgentModelPickerOverride["mode"] | undefined;
    if (activeBackendId && activeDescriptor && (optimisticModeState || optimisticConfigOptions)) {
      const adapter = buildModeAdapter(activeDescriptor, {
        modeState: optimisticModeState,
        configOptions: optimisticConfigOptions,
      });
      if (adapter) {
        modeBlock = buildModeOverride(
          adapter,
          activeBackendId,
          manager,
          isSetModeSupported,
          isSetConfigOptionSupported
        );
      }
    }

    return {
      models: entries,
      value: valueKey,
      // Cross-backend picks are valid even when the active session can't
      // switch models at runtime; intra-backend support is checked per-call.
      disabled: false,
      effort: effortBlock,
      mode: modeBlock,
      onChange: (modelKey: string) => {
        const entry = entries.find((e) => getModelKeyFromModel(e) === modelKey);
        if (!entry) return;
        const targetBackendId = entry._backendId;
        if (!targetBackendId) {
          logError("[AgentMode] picker entry missing _backendId", entry);
          return;
        }
        const targetDescriptor = backendRegistry[targetBackendId];
        if (!targetDescriptor) {
          logError("[AgentMode] picker entry references unknown backend", targetBackendId);
          return;
        }
        const agentId = resolveAgentId(entry, targetDescriptor, settings.activeModels ?? []);
        if (!agentId) {
          new Notice("Could not resolve a model id for this selection.");
          return;
        }

        if (!activeSession || activeSession.backendId !== targetBackendId) {
          // Cross-backend pick: persist model first so the new session's
          // getPreferredModelId sees it, then spawn — `createSession` is sync
          // (returns once the session is registered as active; ACP startup
          // continues in the background). Close the old empty tab in the
          // background so the UI swap is instant.
          const emptyId = activeSession?.internalId;
          void (async () => {
            try {
              await manager.persistModelSelectionFor(targetBackendId, agentId);
              await manager.createSession(targetBackendId);
              manager.setDefaultBackend(targetBackendId);
              if (emptyId) {
                void manager
                  .closeSession(emptyId)
                  .catch((e) => logError("[AgentMode] closeSession of empty tab failed", e));
              }
            } catch (err) {
              logError("[AgentMode] cross-backend pick failed", err);
              new Notice(
                `Failed to start ${targetDescriptor.displayName}. See console for details.`
              );
            }
          })();
          return;
        }
        // Same backend as the active session — flip the default eagerly,
        // then route the model switch through the running session.
        manager.setDefaultBackend(targetBackendId);
        if (isModelSwitchSupported === false) {
          new Notice("This agent doesn't support runtime model switching.");
          return;
        }
        manager.setActiveSessionModel(agentId).catch((err) => {
          if (err instanceof MethodUnsupportedError) {
            new Notice("This agent doesn't support runtime model switching.");
            return;
          }
          logError("[AgentMode] setActiveSessionModel failed", err);
          new Notice("Failed to switch model. See console for details.");
        });
      },
    };
    // cacheSnapshot is intentionally referenced as a dep — it changes when
    // the preloader cache updates, which is read inside this memo via
    // `manager.getCachedModels(...)`. Eslint can't see the indirection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    manager,
    descriptors,
    settings.activeModels,
    // Per-backend slice carries `modelEnabledOverrides` — rebuild when toggles change.
    settings.agentMode?.backends,
    activeBackendId,
    activeModelState,
    activeConfigOptions,
    activeModeState,
    isModelSwitchSupported,
    isSetConfigOptionSupported,
    isSetModeSupported,
    activeSession,
    activeSessionHasHistory,
    cacheSnapshot,
  ]);
}

/**
 * Resolve an optimistic `SessionModelState` for the active backend: prefer
 * live, fall back to preloader cache. When the cached `currentModelId` isn't
 * actually in `availableModels` (rare — stale probe), prefer the user's
 * persisted preference if present.
 */
function resolveOptimisticModelState(
  live: SessionModelState | null,
  backendId: string | null,
  descriptor: BackendDescriptor | undefined,
  getCached: (id: string) => SessionModelState | null,
  settings: ReturnType<typeof useSettingsValue>
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

/**
 * Wire an `EffortAdapter` into the picker override block. Routes user picks
 * through `manager.buildEffortApplyContext` so the descriptor decides which
 * ACP call (setSessionModel vs setSessionConfigOption) to make.
 *
 * Capability gating is keyed off `adapter.kind` rather than descriptor
 * shape — a descriptor that defines both `parseEffortFromModelId` and
 * `findEffortConfigOption` and falls through to the configOption path must
 * still gate on `set_config_option`, not `set_model`.
 */
function buildEffortOverride(
  adapter: EffortAdapter,
  backendId: string,
  manager: AgentSessionManager,
  isModelSwitchSupported: boolean | null,
  isSetConfigOptionSupported: boolean | null
): NonNullable<AgentModelPickerOverride["effort"]> {
  const disabled =
    adapter.kind === "model"
      ? isModelSwitchSupported === false
      : isSetConfigOptionSupported === false;

  return {
    options: adapter.options,
    value: adapter.currentValue,
    disabled: disabled || adapter.disabled,
    onChange: (value: string | null) => {
      const ctx = manager.buildEffortApplyContext(backendId);
      if (!ctx) {
        new Notice("Active session is not on this backend.");
        return;
      }
      adapter.applyEffort(value, ctx).catch((err) => {
        if (err instanceof MethodUnsupportedError) {
          new Notice("This agent doesn't support runtime effort switching.");
          return;
        }
        logError("[AgentMode] effort apply failed", err);
        new Notice("Failed to switch effort. See console for details.");
      });
    },
  };
}

/**
 * Wire a `ModeAdapter` into the picker override block. Routes user picks
 * through `manager.buildModeApplyContext` so the descriptor's mapping
 * decides which native id and ACP call to use.
 *
 * Capability gating is keyed off `adapter.kind` — `setMode` adapters check
 * `isSetModeSupported`, `configOption` adapters check
 * `isSetConfigOptionSupported`.
 */
function buildModeOverride(
  adapter: ModeAdapter,
  backendId: string,
  manager: AgentSessionManager,
  isSetModeSupported: boolean | null,
  isSetConfigOptionSupported: boolean | null
): NonNullable<AgentModelPickerOverride["mode"]> {
  const disabled =
    adapter.kind === "setMode"
      ? isSetModeSupported === false
      : isSetConfigOptionSupported === false;

  return {
    options: adapter.options,
    value: adapter.currentValue,
    disabled: disabled || adapter.disabled,
    onChange: (value: CopilotMode) => {
      const ctx = manager.buildModeApplyContext(backendId);
      if (!ctx) {
        new Notice("Active session is not on this backend.");
        return;
      }
      adapter.applyMode(value, ctx).catch((err) => {
        if (err instanceof MethodUnsupportedError) {
          new Notice("This agent doesn't support runtime mode switching.");
          return;
        }
        logError("[AgentMode] mode apply failed", err);
        new Notice("Failed to switch mode. See console for details.");
      });
    },
  };
}

function appendBackendSection(
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

function synthesizeAgentEntry(
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

function computeValueKeyForActive(
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
function resolveCollapsedModelId(
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

function resolveAgentId(
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
