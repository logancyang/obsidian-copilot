import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { useSettingsValue } from "@/settings/model";
import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { modelStateSignature } from "@/agentMode/session/translateBackendState";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { useBackendInstallStates } from "@/agentMode/ui/useBackendDescriptor";
import type { AgentPickerSection } from "@/components/ui/ModelEffortPicker";
import { buildAgentModelPicker } from "./agentModelPickerHelpers";
import type { AgentTalkingTo } from "./useAgentTalkingTo";
import { useManagerSubscribe } from "./useManagerSubscribe";
import type CopilotPlugin from "@/main";

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
  /**
   * The Agent section at the top of the popover. Picking an agent applies its
   * pinned model and effort to the same draft a manual pick writes, so the
   * sections below follow at once (`designdocs/CUSTOM_AGENTS.md` §3).
   */
  agents?: AgentPickerSection;
}

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

export function useAgentModelPicker(
  manager: AgentSessionManager | null,
  plugin: CopilotPlugin,
  talkingTo: AgentTalkingTo
): AgentModelPickerOverride | null {
  const settings = useSettingsValue();
  const descriptors = useMemo(() => listBackendDescriptors(), []);
  const installStates = useBackendInstallStates(plugin);
  const signal = useAgentModelSignal(manager, descriptors);
  return useMemo(() => {
    void signal;
    void installStates;
    return buildAgentModelPicker({ manager, descriptors, settings, talkingTo });
  }, [manager, descriptors, settings, signal, installStates, talkingTo]);
}
