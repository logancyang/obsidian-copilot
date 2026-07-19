import React from "react";
import { backendNeedsSelfHostWarning, listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentBrand } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { useSettingsValue, type CopilotSettings } from "@/settings/model";

// Fan-out routing lives in session/fanout so the session layer can share it
// without depending on the UI. Re-exported here for the composer.
export { EMPTY_ANSWERERS, isFanout, resolveAnswerers } from "@/agentMode/session/fanout/answerers";

/** Frozen empty brand list — referential stability for the "no installed agents" case. */
export const EMPTY_AGENT_BRANDS: ReadonlyArray<AgentBrand> = Object.freeze([]);

/**
 * Brand projections of every installed (`ready`) backend, mentionable in the
 * composer. Registry-driven, so a new backend becomes mentionable automatically.
 * Self-Host Mode marks cloud agents but keeps them mentionable — the user
 * decides whether to fan out to one.
 */
export function listInstalledAgentBrands(settings: CopilotSettings): ReadonlyArray<AgentBrand> {
  const brands = listBackendDescriptors()
    .filter((descriptor) => descriptor.getInstallState(settings).kind === "ready")
    .map(
      (descriptor) =>
        ({
          id: descriptor.id,
          displayName: descriptor.displayName,
          Icon: descriptor.Icon,
          needsSelfHostWarning: backendNeedsSelfHostWarning(descriptor, settings),
        }) satisfies AgentBrand
    );
  return brands.length > 0 ? brands : EMPTY_AGENT_BRANDS;
}

/**
 * Keeps the composer's mentionable-agent set current as backend readiness
 * settles. Readiness can change without a settings write (compatibility
 * probes publish asynchronously), so a settings-keyed memo alone would leave
 * a just-verified backend missing from `@agent` suggestions and the send-time
 * allowlist until an unrelated settings edit.
 * @param plugin - The plugin instance descriptors need to observe readiness changes.
 */
export function useInstalledAgentBrands(plugin: CopilotPlugin): ReadonlyArray<AgentBrand> {
  const settings = useSettingsValue();
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const unsubs = listBackendDescriptors().map((descriptor) =>
        descriptor.subscribeInstallState(plugin, listener)
      );
      return () => unsubs.forEach((unsub) => unsub());
    },
    [plugin]
  );
  // Snapshot exactly what the brand list consumes — ready-backend membership —
  // so probe-settled transitions re-render and everything else is ignored.
  const getSnapshot = React.useCallback(
    () =>
      listBackendDescriptors()
        .filter((descriptor) => descriptor.getInstallState(settings).kind === "ready")
        .map((descriptor) => descriptor.id)
        .join(","),
    [settings]
  );
  const readyIds = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void readyIds;
    return listInstalledAgentBrands(settings);
  }, [settings, readyIds]);
}
