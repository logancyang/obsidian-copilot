import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, BackendState } from "@/agentMode/session/types";
import type { AgentModePickerOverride } from "./useAgentModePicker";
import { handlePickerSwitchError, resolveActiveDisplayState } from "./agentModelPickerHelpers";

interface ModeActiveContext {
  activeBackendId: BackendId | null;
  activeMode: BackendState["mode"];
  activeChatUIState: AgentChatUIState | null;
}

function collectModeActiveContext(manager: AgentSessionManager): ModeActiveContext {
  const activeSession = manager.getActiveSession();
  const activeChatUIState = manager.getActiveChatUIState();
  const activeBackendId = activeSession?.backendId ?? null;
  const activeState = resolveActiveDisplayState(
    activeSession?.getState() ?? null,
    activeBackendId,
    (id) => manager.getCachedBackendState(id)
  );
  return {
    activeBackendId,
    activeMode: activeState?.mode ?? null,
    activeChatUIState,
  };
}

/**
 * Build the mode picker. Returns `null` when the active backend has no
 * mode options. `disabled` mirrors `activeChatUIState.canSwitchMode()` —
 * wire routing (`setMode` vs `setConfigOption`) lives behind that intent
 * method.
 */
export function buildAgentModePicker(args: {
  manager: AgentSessionManager | null;
}): AgentModePickerOverride | null {
  const { manager } = args;
  if (!manager) return null;
  const ctx = collectModeActiveContext(manager);
  const { activeBackendId, activeMode, activeChatUIState } = ctx;
  if (!activeBackendId || !activeMode) return null;
  return {
    options: activeMode.options,
    value: activeMode.current,
    disabled: activeChatUIState?.canSwitchMode() === false,
    onChange: (value) => {
      const spec = activeMode.apply[value];
      if (!spec) return;
      manager.applyMode(activeBackendId, spec).catch((err) => {
        handlePickerSwitchError(err, "mode");
      });
    },
  };
}
