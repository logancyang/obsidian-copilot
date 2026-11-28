import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { modelStateSignature } from "@/agentMode/session/translateBackendState";
import { useHostSlice } from "@/agentMode/ui/hooks/useSessionSlice";
import { buildAgentModelPicker } from "./agentModelPickerHelpers";
import { useManagerSubscribe } from "./useManagerSubscribe";

export interface AgentModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
  disabled?: boolean;
  effort?: {
    options: { label: string; value: string | null }[];
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  };
  effortOptionsByModelKey?: Record<string, { label: string; value: string | null }[]>;
  commitSelection?: (modelKey: string, effort: string | null) => void;
}

function useActiveChatModelSignal(manager: AgentSessionManager | null): string {
  const subscribe = useManagerSubscribe(manager);

  const getSnapshot = useCallback((): string => {
    if (!manager) return "";
    const session = manager.getActiveSession();
    return [
      session?.internalId ?? "",
      session?.backendId ?? "",
      session?.getStatus() ?? "",
      session && manager.isTiedToAgent(session.internalId) ? "1" : "0",
      modelStateSignature(session?.getState() ?? null),
    ].join("|");
  }, [manager]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAgentModelPicker(
  manager: AgentSessionManager | null
): AgentModelPickerOverride | null {
  const catalog = useHostSlice("pickerCatalog");
  const signal = useActiveChatModelSignal(manager);
  return useMemo(() => {
    void signal;
    return buildAgentModelPicker({ manager, catalog });
  }, [manager, catalog, signal]);
}
