import {
  backendRegistry,
  getActiveBackendDescriptor,
  listBackendDescriptors,
} from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, BackendId, InstallState } from "@/agentMode/session/types";
import { useSettingsValue } from "@/settings/model";
import React from "react";
import type CopilotPlugin from "@/main";

const EMPTY_BACKEND_INSTALL_STATES = Object.freeze({}) as Record<BackendId, InstallState>;

function installStateSignature(state: InstallState): string {
  switch (state.kind) {
    case "absent":
      return "absent";
    case "checking":
    case "ready":
      return `${state.kind}:${state.source}`;
    case "incompatible":
      return JSON.stringify([
        state.kind,
        state.source,
        state.currentVersion,
        state.minVersion,
        state.message,
      ]);
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

/**
 * Same contract as `useBackendInstallState`, widened to every registered
 * backend at once, for surfaces that list all agents side by side. One store
 * subscription fans out to every descriptor and the snapshot is the joined
 * signature, so a descriptor that allocates a fresh state object per read still
 * cannot force a rerender — and the returned record keeps its identity until a
 * backend's readiness actually changes.
 * @param plugin - The plugin instance used to subscribe to backend-specific readiness changes.
 */
export function useBackendInstallStates(plugin: CopilotPlugin): Record<BackendId, InstallState> {
  const settings = useSettingsValue();
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const unsubscribes = listBackendDescriptors().map((descriptor) =>
        descriptor.subscribeInstallState(plugin, listener)
      );
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    [plugin]
  );
  const getSnapshot = React.useCallback(
    () =>
      listBackendDescriptors()
        .map(
          (descriptor) =>
            `${descriptor.id}=${installStateSignature(descriptor.getInstallState(settings))}`
        )
        .join("|"),
    [settings]
  );
  const signature = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void signature;
    const descriptors = listBackendDescriptors();
    if (descriptors.length === 0) return EMPTY_BACKEND_INSTALL_STATES;
    const states = {} as Record<BackendId, InstallState>;
    for (const descriptor of descriptors) {
      states[descriptor.id] = descriptor.getInstallState(settings);
    }
    return states;
  }, [settings, signature]);
}
