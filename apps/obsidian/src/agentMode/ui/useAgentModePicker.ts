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

function useAgentModeSignal(manager: AgentSessionManager | null): string {
  const subscribe = useManagerSubscribe(manager);

  const getSnapshot = useCallback((): string => {
    if (!manager) return "";
    const session = manager.getActiveSession();
    const state = session?.getState() ?? null;
    return [
      session?.internalId ?? "",
      session?.backendId ?? "",
      session?.getStatus() ?? "",
      modeStateSignature(state),
    ].join("|");
  }, [manager]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAgentModePicker(
  manager: AgentSessionManager | null
): AgentModePickerOverride | null {
  const signal = useAgentModeSignal(manager);
  return useMemo(() => {
    void signal;
    return buildAgentModePicker({ manager });
  }, [manager, signal]);
}
