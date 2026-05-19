import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { useSettingsValue } from "@/settings/model";
import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { modelStateSignature } from "@/agentMode/session/translateBackendState";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { buildAgentModelPicker } from "./agentModelPickerHelpers";
import { useManagerSubscribe } from "./useManagerSubscribe";

export interface AgentModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
  disabled?: boolean;
  /**
   * Sibling effort picker — present only when the active backend's current
   * model exposes effort options.
   */
  effort?: {
    options: { label: string; value: string | null }[];
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  };
  /**
   * Per-model effort catalog, keyed by `getModelKeyFromModel(entry)`. Empty
   * array for models with no effort dimension. Consumers that render a
   * merged model+effort picker (e.g. `ModelEffortPicker`) read this to
   * preview the stepper for any row, not just the active one.
   */
  effortOptionsByModelKey?: Record<string, { label: string; value: string | null }[]>;
  /**
   * Atomically commit both the model and its effort. Same-backend picks
   * route through `applySelection({ baseModelId, effort })`; cross-backend
   * picks seed a fresh session on the target with the drafted selection.
   * Neither path writes to the saved default.
   */
  commitSelection?: (modelKey: string, effort: string | null) => void;
}

/**
 * Subscribe to manager changes that affect the *model+effort* picker view,
 * and return a string key that mutates whenever any of them change. The key
 * is purely a memo invalidator — `buildAgentModelPicker` reads fresh state
 * directly off the manager.
 *
 * Encodes only model-relevant slices (active session id, active backend
 * id, hasUserVisibleMessages, per-backend `modelStateSignature`) — switching
 * mode on the active session does not change this key.
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
      session?.hasUserVisibleMessages() ? "1" : "0",
    ];
    for (const d of descriptors) {
      parts.push(`${d.id}:${modelStateSignature(manager.getCachedBackendState(d.id))}`);
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
  manager: AgentSessionManager | null
): AgentModelPickerOverride | null {
  const settings = useSettingsValue();
  const descriptors = useMemo(() => listBackendDescriptors(), []);
  const signal = useAgentModelSignal(manager, descriptors);
  return useMemo(() => {
    // `signal` is the memo invalidator — referenced here so
    // react-hooks/exhaustive-deps accepts it in the dep array.
    void signal;
    return buildAgentModelPicker({ manager, descriptors, settings });
  }, [manager, descriptors, settings, signal]);
}
