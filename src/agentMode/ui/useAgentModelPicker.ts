import { useEffect, useMemo, useState } from "react";
import { Notice } from "obsidian";
import type { CustomModel } from "@/aiParams";
import { logError } from "@/logger";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { backendRegistry, listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError, type BackendId } from "@/agentMode/acp/types";
import type { BackendDescriptor } from "@/agentMode/session/types";

export interface AgentModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
  disabled?: boolean;
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
  backend: AgentChatBackend | null,
  manager: AgentSessionManager | null
): AgentModelPickerOverride | null {
  const settings = useSettingsValue();
  const descriptors = useMemo(() => listBackendDescriptors(), []);

  // Re-render on active-session model-state changes, manager lifecycle
  // changes, and preloader cache updates — all three drive picker contents.
  const [, forceRender] = useState(0);
  const preloader = manager?.getModelPreloader() ?? null;
  useEffect(() => {
    const tick = () => forceRender((n) => n + 1);
    const unsubs = [backend?.subscribe(tick), manager?.subscribe(tick), preloader?.subscribe(tick)];
    return () => unsubs.forEach((u) => u?.());
  }, [backend, manager, preloader]);

  const activeModelState = backend?.getModelState() ?? null;
  const isModelSwitchSupported = backend?.isModelSwitchSupported() ?? null;
  const activeSession = manager?.getActiveSession() ?? null;
  const activeBackendId = activeSession?.backendId ?? null;
  const activeSessionHasHistory = activeSession?.hasUserVisibleMessages() ?? false;

  return useMemo<AgentModelPickerOverride | null>(() => {
    if (!manager) return null;

    const entries: ModelSelectorEntry[] = [];

    for (const descriptor of descriptors) {
      const isActiveBackend = descriptor.id === activeBackendId;
      if (!isActiveBackend && activeSessionHasHistory) continue;

      const liveAvailable = isActiveBackend
        ? (activeModelState?.availableModels ?? null)
        : (preloader?.getCachedModels(descriptor.id)?.availableModels ?? null);
      const isRunning = manager.getBackendProcess(descriptor.id)?.isRunning() ?? false;

      appendBackendSection(entries, descriptor, settings.activeModels ?? [], {
        liveAvailable,
        isRunning,
        isActiveBackend,
      });
    }

    // Surface the session's current model if a curated/synthesized entry for
    // it isn't already present (stale selectedModelKey, or filtered out).
    const activeDescriptor = activeBackendId ? backendRegistry[activeBackendId] : undefined;
    const valueKey =
      activeBackendId && activeDescriptor && activeModelState
        ? computeValueKeyForActive(
            activeModelState.currentModelId,
            activeDescriptor,
            settings.activeModels ?? []
          )
        : "";
    if (activeBackendId && activeDescriptor && activeModelState?.currentModelId) {
      const currentInfo = activeModelState.availableModels.find(
        (m) => m.modelId === activeModelState.currentModelId
      );
      if (currentInfo && !entries.some((e) => getModelKeyFromModel(e) === valueKey)) {
        entries.unshift(
          synthesizeAgentEntry(currentInfo.modelId, currentInfo.name, activeDescriptor)
        );
      }
    }

    return {
      models: entries,
      value: valueKey,
      // Cross-backend picks are valid even when the active session can't
      // switch models at runtime; intra-backend support is checked per-call.
      disabled: false,
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
          // getPreferredModelId sees it, then spawn, then close the old empty
          // tab. Default-backend flip waits until the new session resolves so
          // a failed start doesn't leave the user pointing at a broken backend.
          const emptyId = activeSession?.internalId;
          void (async () => {
            try {
              await manager.persistModelSelectionFor(targetBackendId, agentId);
              await manager.createSession(targetBackendId);
              manager.setDefaultBackend(targetBackendId);
              if (emptyId) {
                await manager
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
  }, [
    manager,
    descriptors,
    settings.activeModels,
    activeBackendId,
    activeModelState,
    isModelSwitchSupported,
    activeSession,
    activeSessionHasHistory,
    preloader,
  ]);
}

function appendBackendSection(
  entries: ModelSelectorEntry[],
  descriptor: BackendDescriptor,
  activeModels: CustomModel[],
  ctx: {
    liveAvailable: ReadonlyArray<{ modelId: string; name: string }> | null;
    isRunning: boolean;
    isActiveBackend: boolean;
  }
): void {
  const filterFn = descriptor.filterCopilotModels;
  const translateFn = descriptor.copilotModelKeyToAgentModelId;
  const reverseProviderFn = descriptor.agentModelIdToCopilotProvider;
  const partition = filterFn
    ? filterFn(activeModels)
    : { compatible: [] as CustomModel[], incompatible: [] as CustomModel[] };

  const liveIds = new Set((ctx.liveAvailable ?? []).map((m) => m.modelId));
  const curatedProviders = new Set<string>();
  const curatedAgentIds = new Set<string>();
  for (const m of partition.compatible) {
    curatedProviders.add(m.provider);
    const agentId = translateFn?.(m);
    if (agentId) curatedAgentIds.add(agentId);
  }

  for (const m of partition.compatible) {
    const agentId = translateFn?.(m);
    const isAvailable = ctx.isRunning && agentId !== undefined && liveIds.has(agentId);
    const disabledReason = ctx.isActiveBackend
      ? ctx.isRunning
        ? isAvailable
          ? undefined
          : "Restart agent to load"
        : `Start ${descriptor.displayName} session to use`
      : undefined;
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
  if (!ctx.liveAvailable) return;
  for (const m of ctx.liveAvailable) {
    if (curatedAgentIds.has(m.modelId)) continue;
    const copilotProvider = reverseProviderFn?.(m.modelId);
    if (copilotProvider && curatedProviders.has(copilotProvider)) continue;
    entries.push(synthesizeAgentEntry(m.modelId, m.name, descriptor));
  }
}

// Backend-scoped so two backends reporting the same `sonnet` don't collide
// on React key / dropdown value `<name>|<provider>`. Raw id is preserved in
// `_agentModelId` for outbound resolution.
function scopedSynthName(backendId: BackendId, modelId: string): string {
  return `${backendId}:${modelId}`;
}

function synthesizeAgentEntry(
  modelId: string,
  humanName: string,
  descriptor: BackendDescriptor
): ModelSelectorEntry {
  return {
    name: scopedSynthName(descriptor.id, modelId),
    provider: AGENT_PROVIDER,
    enabled: true,
    isBuiltIn: false,
    displayName: humanName || modelId,
    _group: descriptor.displayName,
    _backendId: descriptor.id,
    _agentModelId: modelId,
  };
}

function computeValueKeyForActive(
  currentModelId: string,
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
    if (match) return getModelKeyFromModel(match);
  }
  return `${scopedSynthName(descriptor.id, currentModelId)}|${AGENT_PROVIDER}`;
}

function resolveAgentId(
  entry: ModelSelectorEntry,
  descriptor: BackendDescriptor,
  activeModels: CustomModel[]
): string | undefined {
  if (entry._agentModelId) return entry._agentModelId;
  if (!descriptor.copilotModelKeyToAgentModelId) return undefined;
  const match = activeModels.find((m) => m.name === entry.name && m.provider === entry.provider);
  if (!match) return undefined;
  return descriptor.copilotModelKeyToAgentModelId(match);
}
