import { backendRegistry, getActiveBackendDescriptor } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import { useSettingsValue } from "@/settings/model";
import React from "react";

/** Resolve the active (default) backend descriptor from settings. */
export function useActiveBackendDescriptor(): BackendDescriptor {
  return getActiveBackendDescriptor(useSettingsValue());
}

/**
 * Resolve the descriptor for the currently active *session*'s backend.
 * Falls back to the default backend descriptor when there is no active
 * session (e.g. the no-session fallback view, or before auto-spawn lands).
 *
 * Status pills, install CTAs, and other session-scoped UI should prefer
 * this over `useActiveBackendDescriptor` so the displayed display name /
 * version / install handler matches the running session — which can be on
 * a non-default backend after a cross-backend model pick + new tab.
 */
export function useSessionBackendDescriptor(
  manager: AgentSessionManager | null | undefined
): BackendDescriptor {
  const settings = useSettingsValue();
  const [, forceRender] = React.useState(0);
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => forceRender((n) => n + 1));
  }, [manager]);
  const sessionBackendId =
    manager?.getStartingBackendId() ?? manager?.getActiveSession()?.backendId;
  if (sessionBackendId) {
    const desc = backendRegistry[sessionBackendId];
    if (desc) return desc;
  }
  return getActiveBackendDescriptor(settings);
}

/** Compute the descriptor's current install state. Recomputes each render. */
export function useBackendInstallState(descriptor: BackendDescriptor): InstallState {
  return descriptor.getInstallState(useSettingsValue());
}
