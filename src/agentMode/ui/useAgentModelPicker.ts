import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ModelEffortPickerOverride } from "@/components/ui/ModelEffortPicker";
import { useSettingsValue } from "@/settings/model";
import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { modelStateSignature } from "@/agentMode/session/translateBackendState";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { useBackendInstallStates } from "@/agentMode/ui/useBackendDescriptor";
import { buildAgentModelPicker } from "./agentModelPickerHelpers";
import { useManagerSubscribe } from "./useManagerSubscribe";
import type CopilotPlugin from "@/main";

export interface AgentModelPickerOverride extends ModelEffortPickerOverride {
  onChange: (modelKey: string) => void;
}

/**
 * Subscribe to manager changes that affect the *model+effort* picker view,
 * and return a string key that mutates whenever any of them change. The key
 * is purely a memo invalidator — `buildAgentModelPicker` reads fresh state
 * directly off the manager.
 *
 * Encodes only model-relevant slices: active-session identity, status,
 * history and model state, plus each backend's shared catalog/effort
 * signature. Switching mode on the active session does not change this key.
 */
function useAgentModelSignal(
  manager: AgentSessionManager | null,
  descriptors: BackendDescriptor[]
): string {
  const subscribe = useManagerSubscribe(manager);

  const getSnapshot = useCallback((): string => {
    if (!manager) return "";
    const session = manager.getActiveSession();
    const parts: string[] = [
      session?.internalId ?? "",
      session?.backendId ?? "",
      // Include status so the picker's `disabled` flips when the session
      // transitions out of "starting" (canSwitchModel/Effort gate on status).
      session?.getStatus() ?? "",
      session?.hasUserVisibleMessages() ? "1" : "0",
      modelStateSignature(session?.getState() ?? null),
    ];
    for (const d of descriptors) {
      parts.push(`${d.id}:${manager.getModelCacheSignature(d.id)}`);
    }
    return parts.join("|");
  }, [manager, descriptors]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Build the `modelPickerOverride` for `ChatInput` — one grouped section per
 * registered backend, plus an optional effort sibling for the active model.
 * Once the active session has any user-visible messages, non-active backend
 * sections are hidden so picks can't muddle history; cross-backend picks on
 * an empty tab swap the tab for a fresh session on the target backend.
 *
 * Mode is *not* part of this override — see `useAgentModePicker` for that.
 */
export function useAgentModelPicker(
  manager: AgentSessionManager | null,
  plugin: CopilotPlugin
): AgentModelPickerOverride | null {
  const settings = useSettingsValue();
  // Every registered backend shows in the picker; Self-Host Mode marks cloud
  // agents (via `settings` in `buildAgentModelPicker`) rather than hiding them.
  // The registry is static, so the descriptor list is a stable module constant.
  const descriptors = useMemo(() => listBackendDescriptors(), []);
  const installStates = useBackendInstallStates(plugin);
  const signal = useAgentModelSignal(manager, descriptors);
  return useMemo(() => {
    // These are memo invalidators: the builder reads the manager and
    // descriptors directly after either external store reports a change.
    void signal;
    void installStates;
    return buildAgentModelPicker({ manager, descriptors, settings });
  }, [manager, descriptors, settings, signal, installStates]);
}
