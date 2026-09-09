import type { BackendDescriptor, BackendId, InstallState } from "@/agentMode/session/types";
import { useSettingsValue } from "@/settings/model";
import type CopilotPlugin from "@/main";
import React from "react";

const EMPTY_BACKEND_INSTALL_STATES = Object.freeze({}) as Record<BackendId, InstallState>;

export function installStateSignature(state: InstallState): string {
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

/**
 * Same contract as `useBackendInstallState`, widened to every registered
 * backend at once, for surfaces that list all agents side by side. One store
 * subscription fans out to every descriptor and the snapshot is the joined
 * signature, so a descriptor that allocates a fresh state object per read still
 * cannot force a rerender — and the returned record keeps its identity until a
 * backend's readiness actually changes.
 * @param plugin - The plugin instance used to subscribe to backend-specific readiness changes.
 * @param descriptors - The registered backends to observe.
 */
export function useBackendInstallStates(
  plugin: CopilotPlugin,
  descriptors: readonly BackendDescriptor[]
): Record<BackendId, InstallState> {
  const settings = useSettingsValue();
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const unsubscribes = descriptors.map((descriptor) =>
        descriptor.subscribeInstallState(plugin, listener)
      );
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    [plugin, descriptors]
  );
  const getSnapshot = React.useCallback(
    () =>
      descriptors
        .map(
          (descriptor) =>
            `${descriptor.id}=${installStateSignature(descriptor.getInstallState(settings))}`
        )
        .join("|"),
    [settings, descriptors]
  );
  const signature = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void signature;
    if (descriptors.length === 0) return EMPTY_BACKEND_INSTALL_STATES;
    const states = {} as Record<BackendId, InstallState>;
    for (const descriptor of descriptors) {
      states[descriptor.id] = descriptor.getInstallState(settings);
    }
    return states;
  }, [settings, signature, descriptors]);
}
