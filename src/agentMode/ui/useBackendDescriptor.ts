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

export function useActiveBackendDescriptor(): BackendDescriptor {
  return getActiveBackendDescriptor(useSettingsValue());
}

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

export function useBackendInstallStates(plugin: CopilotPlugin) {
  const descriptors = React.useMemo(() => listBackendDescriptors(), []);
  return useDescriptorInstallStates(plugin, descriptors);
}
