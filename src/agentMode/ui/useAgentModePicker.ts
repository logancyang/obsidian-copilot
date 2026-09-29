import type { ClientView } from "@/agentMode/protocol/ClientView";
import { useClientView } from "@/agentMode/protocol/react";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { SessionState } from "@/agentMode/protocol/state";
import type { CopilotMode } from "@/agentMode/session/types";
import { useAgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import { reportSwitchFailure } from "@/agentMode/ui/agentModelPickerHelpers";
import { useSessionSlice } from "@/agentMode/ui/hooks/useSessionSlice";
import { useMemo } from "react";

export interface AgentModePickerOverride {
  options: { label: string; value: CopilotMode }[];
  value: CopilotMode | null;
  onChange: (value: CopilotMode) => void;
  disabled?: boolean;
}

const selectMode = (session: SessionState) => session.backendState?.mode ?? null;

/**
 * The permission-mode choices for the shown session, applied through the `applyMode` command.
 * The desktop remembers the pick as the agent's default mode after the host accepts it; the host
 * never changes settings. Null while the session has not reported any modes.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function useAgentModePicker(
  client: SessionClient,
  view: ClientView
): AgentModePickerOverride | null {
  const { activeTab } = useClientView(client, view);
  const persist = useAgentPaneCapabilities().persistDefaults;
  const mode = useSessionSlice(client, activeTab?.id ?? null, selectMode);

  return useMemo(() => {
    if (!activeTab || !mode) return null;
    return {
      options: mode.options,
      value: mode.current,
      disabled: activeTab.canSwitchMode === false,
      onChange: (value) => {
        if (!mode.apply[value]) return;
        void client
          .command({ name: "applyMode", sessionId: activeTab.id, mode: value })
          .then((result) => {
            if (!result.ok) reportSwitchFailure(result, "mode");
            else persist?.persistDefaultMode(activeTab.backendId, value);
          });
      },
    };
  }, [activeTab, mode, client, persist]);
}
