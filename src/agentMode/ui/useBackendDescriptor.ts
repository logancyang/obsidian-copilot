import {
  installStateSignature,
  useBackendInstallStates as useDescriptorInstallStates,
} from "@/agentMode/session/useBackendInstallStates";
import {
  backendRegistry,
  getActiveBackendDescriptor,
  listBackendDescriptors,
} from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type {
  BackendDescriptor,
  InstallState,
  ManagedInstallActionState,
} from "@/agentMode/session/types";
import { useSettingsValue } from "@/settings/model";
import React from "react";
import type CopilotPlugin from "@/main";

const IDLE_MANAGED_INSTALL_ACTION_STATE = Object.freeze({
  kind: "idle" as const,
}) satisfies ManagedInstallActionState;

function managedInstallActionStateSignature(state: ManagedInstallActionState): string {
  switch (state.kind) {
    case "idle":
      return "idle";
    case "running":
      return JSON.stringify([state.kind, state.label, state.percent]);
    case "error":
      return JSON.stringify([state.kind, state.message]);
  }
}

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
  const subscribe = React.useCallback(
    (listener: () => void) => manager?.subscribe(listener) ?? (() => {}),
    [manager]
  );
  const getSnapshot = React.useCallback(
    () => manager?.getStartingBackendId() ?? manager?.getActiveSession()?.backendId ?? null,
    [manager]
  );
  const sessionBackendId = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (sessionBackendId) {
    const desc = backendRegistry[sessionBackendId];
    if (desc) return desc;
  }
  return getActiveBackendDescriptor(settings);
}

/**
 * Keeps backend readiness UI synchronized with settings and asynchronous runtime checks.
 * A semantic signature is the external-store snapshot because some descriptors allocate
 * a new state object on every read even when its value has not changed.
 * @param descriptor - The backend whose readiness should be observed.
 * @param plugin - The plugin instance used to subscribe to backend-specific readiness changes.
 */
export function useBackendInstallState(
  descriptor: BackendDescriptor,
  plugin: CopilotPlugin
): InstallState {
  const settings = useSettingsValue();
  const subscribe = React.useCallback(
    (listener: () => void) => descriptor.subscribeInstallState(plugin, listener),
    [descriptor, plugin]
  );
  const getSnapshot = React.useCallback(
    () => installStateSignature(descriptor.getInstallState(settings)),
    [descriptor, settings]
  );
  const signature = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void signature;
    return descriptor.getInstallState(settings);
  }, [descriptor, settings, signature]);
}

/** Observe the descriptor's shared managed-install operation, or a stable idle state. */
export function useManagedInstallActionState(
  descriptor: BackendDescriptor,
  plugin: CopilotPlugin
): ManagedInstallActionState {
  const action = descriptor.managedInstall;
  const subscribe = React.useCallback(
    (listener: () => void) => action?.subscribe(plugin, listener) ?? (() => {}),
    [action, plugin]
  );
  const getSnapshot = React.useCallback(
    () =>
      managedInstallActionStateSignature(
        action?.getState(plugin) ?? IDLE_MANAGED_INSTALL_ACTION_STATE
      ),
    [action, plugin]
  );
  const signature = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void signature;
    return action?.getState(plugin) ?? IDLE_MANAGED_INSTALL_ACTION_STATE;
  }, [action, plugin, signature]);
}

/** Observe readiness for every registered agent. */
export function useBackendInstallStates(plugin: CopilotPlugin) {
  const descriptors = React.useMemo(() => listBackendDescriptors(), []);
  return useDescriptorInstallStates(plugin, descriptors);
}
