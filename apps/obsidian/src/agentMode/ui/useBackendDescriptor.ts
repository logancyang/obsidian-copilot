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
  ManagedInstallAction,
  ManagedInstallActionState,
} from "@/agentMode/session/types";
import { useSettingsValue } from "@/settings/model";
import React from "react";

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

export function useBackendInstallState(descriptor: BackendDescriptor): InstallState {
  const settings = useSettingsValue();
  const subscribe = React.useCallback(
    (listener: () => void) => descriptor.subscribeInstallState(listener),
    [descriptor]
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
  app: Parameters<ManagedInstallAction["getState"]>[0],
  manifest: Parameters<ManagedInstallAction["getState"]>[1]
): ManagedInstallActionState {
  const action = descriptor.managedInstall;
  const subscribe = React.useCallback(
    (listener: () => void) => action?.subscribe(app, manifest, listener) ?? (() => {}),
    [action, app, manifest]
  );
  const getSnapshot = React.useCallback(
    () =>
      managedInstallActionStateSignature(
        action?.getState(app, manifest) ?? IDLE_MANAGED_INSTALL_ACTION_STATE
      ),
    [action, app, manifest]
  );
  const signature = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void signature;
    return action?.getState(app, manifest) ?? IDLE_MANAGED_INSTALL_ACTION_STATE;
  }, [action, app, manifest, signature]);
}

export function useBackendInstallStates() {
  const descriptors = React.useMemo(() => listBackendDescriptors(), []);
  return useDescriptorInstallStates(descriptors);
}
