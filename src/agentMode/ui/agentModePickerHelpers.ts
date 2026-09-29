import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, BackendState } from "@/agentMode/session/types";
import type { AgentModePickerOverride } from "./useAgentModePicker";
import { handlePickerSwitchError } from "./agentModelPickerHelpers";

interface ModeActiveContext {
  activeBackendId: BackendId | null;
  activeMode: BackendState["mode"];
  activeSession: AgentSession | null;
}

function collectModeActiveContext(manager: AgentSessionManager): ModeActiveContext {
  const activeSession = manager.getActiveSession();
  const activeBackendId = activeSession?.backendId ?? null;
  const activeState = activeSession?.getState() ?? null;
  return {
    activeBackendId,
    activeMode: activeState?.mode ?? null,
    activeSession,
  };
}

export function buildAgentModePicker(args: {
  manager: AgentSessionManager | null;
}): AgentModePickerOverride | null {
  const { manager } = args;
  if (!manager) return null;
  const ctx = collectModeActiveContext(manager);
  const { activeBackendId, activeMode, activeSession } = ctx;
  if (!activeBackendId || !activeMode) return null;
  return {
    options: activeMode.options,
    value: activeMode.current,
    disabled: activeSession?.canSwitchMode() === false,
    onChange: (value) => {
      const spec = activeMode.apply[value];
      if (!spec) return;
      manager.applyMode(activeBackendId, value, spec).catch((err) => {
        handlePickerSwitchError(err, "mode");
      });
    },
  };
}
