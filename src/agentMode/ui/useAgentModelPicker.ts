import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Notice } from "obsidian";
import { logError } from "@/logger";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { backendRegistry, listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import { buildEffortAdapter, type EffortAdapter } from "@/agentMode/session/effortAdapter";
import { getBackendModelOverrides } from "@/agentMode/session/backendSettingsAccess";
import {
  buildModeAdapter,
  type CopilotMode,
  type ModeAdapter,
} from "@/agentMode/session/modeAdapter";
import {
  appendBackendSection,
  buildSynthesizedActiveEntry,
  computeValueKeyForActive,
  preserveSavedEffort,
  resolveAgentId,
  resolveCollapsedModelId,
  resolveOptimisticModelState,
} from "./agentModelPickerHelpers";

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
   * Sibling mode picker — Copilot-canonical operational modes (default/plan/
   * auto) mapped per-backend to native ACP modes (Claude permission modes,
   * Codex sandbox presets) or to OpenCode's managed agents. Absent when the
   * active backend doesn't support any canonical mode.
   */
  mode?: {
    options: { label: string; value: CopilotMode }[];
    value: CopilotMode | null;
    onChange: (value: CopilotMode) => void;
    disabled?: boolean;
  };
}

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

  // Picker-relevant session state, as a signature string. Re-subscribes
  // automatically when the active session changes.
  const subscribeSession = useCallback(
    (cb: () => void) => {
      if (!manager) return () => {};
      let unsubActive: (() => void) | null = null;
      let lastUI: ReturnType<typeof manager.getActiveChatUIState> = null;
      const rewireActive = (): void => {
        const cur = manager.getActiveChatUIState();
        if (cur === lastUI) return;
        unsubActive?.();
        lastUI = cur;
        unsubActive = cur?.subscribe(cb) ?? null;
      };
      rewireActive();
      const unsub = manager.subscribe(() => {
        rewireActive();
        cb();
      });
      return () => {
        unsub();
        unsubActive?.();
      };
    },
    [manager]
  );
  const getSessionSignature = useCallback((): string => {
    if (!manager) return "";
    const session = manager.getActiveSession();
    const ui = manager.getActiveChatUIState();
    const running = descriptors
      .map((d) => `${d.id}:${manager.getBackendProcess(d.id)?.isRunning() ? "1" : "0"}`)
      .join(",");
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
  }, [manager, descriptors]);
  const sessionSignature = useSyncExternalStore(
    subscribeSession,
    getSessionSignature,
    getSessionSignature
  );

  return useMemo<AgentModelPickerOverride | null>(() => {
    if (!manager) return null;

    const activeChatUIState = manager.getActiveChatUIState();
    const activeSession = manager.getActiveSession();
    const activeModelState = activeChatUIState?.getModelState() ?? null;
    const activeConfigOptions = activeChatUIState?.getConfigOptions() ?? null;
    const activeModeState = activeChatUIState?.getModeState() ?? null;
    const isModelSwitchSupported = activeChatUIState?.isModelSwitchSupported() ?? null;
    const isSetConfigOptionSupported =
      activeChatUIState?.isSetSessionConfigOptionSupported() ?? null;
    const isSetModeSupported = activeChatUIState?.isSetModeSupported() ?? null;
    const activeBackendId = activeSession?.backendId ?? null;
    const activeSessionHasHistory = activeSession?.hasUserVisibleMessages() ?? false;

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
        entries.unshift(
          buildSynthesizedActiveEntry(currentInfo, collapsedActiveId, activeDescriptor)
        );
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

    // Mode picker — Copilot-canonical operational modes (default/plan/auto)
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
        const rawAgentId = resolveAgentId(entry, targetDescriptor, settings.activeModels ?? []);
        if (!rawAgentId) {
          new Notice("Could not resolve a model id for this selection.");
          return;
        }
        const agentId = preserveSavedEffort(rawAgentId, targetDescriptor, settings);

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
    // sessionSignature + cacheSnapshot are intentional deps: they change
    // when the manager / preloader fires updates, and the memo body reads
    // those stores via `manager.*` methods that eslint can't see through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, descriptors, settings, sessionSignature, cacheSnapshot]);
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
