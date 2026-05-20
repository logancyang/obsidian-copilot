import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { modeStateSignature } from "@/agentMode/session/translateBackendState";
import type { CopilotMode } from "@/agentMode/session/types";
import { buildAgentModePicker } from "./agentModePickerHelpers";
import { useManagerSubscribe } from "./useManagerSubscribe";

export interface AgentModePickerOverride {
  options: { label: string; value: CopilotMode }[];
  value: CopilotMode | null;
  onChange: (value: CopilotMode) => void;
  disabled?: boolean;
}

/**
 * Subscribe to manager changes that affect the *mode* picker view, and
 * return a string key that mutates whenever any of them change. The key
 * is purely a memo invalidator — `buildAgentModePicker` reads fresh state
 * directly off the manager.
 *
 * Encodes only mode-relevant slices: active session id, active backend id,
 * and the mode-state signature of the active session's state. Picking a
 * different model on the active backend does not change this key.
 */
function useAgentModeSignal(manager: AgentSessionManager | null): string {
  const subscribe = useManagerSubscribe(manager);

  const getSnapshot = useCallback((): string => {
    if (!manager) return "";
    const session = manager.getActiveSession();
    const state = session?.getState() ?? manager.getCachedBackendState(session?.backendId ?? "");
    return [
      session?.internalId ?? "",
      session?.backendId ?? "",
      // Include status so the picker's `disabled` flips when the session
      // transitions out of "starting" (canSwitchMode gates on status).
      session?.getStatus() ?? "",
      modeStateSignature(state),
    ].join("|");
  }, [manager]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Build the `modePickerOverride` for `ChatInput` — the canonical
 * Copilot-mode picker (default/plan/auto) for the active session, or
 * `null` when the active backend exposes no modes. The picker is
 * deliberately separate from `useAgentModelPicker` because mode and
 * model+effort have no functional overlap; splitting them lets each
 * re-render only on its own concern's changes.
 */
export function useAgentModePicker(
  manager: AgentSessionManager | null
): AgentModePickerOverride | null {
  const signal = useAgentModeSignal(manager);
  return useMemo(() => {
    // `signal` is the memo invalidator — referenced here so
    // react-hooks/exhaustive-deps accepts it in the dep array.
    void signal;
    return buildAgentModePicker({ manager });
  }, [manager, signal]);
}
