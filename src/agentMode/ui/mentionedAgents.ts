import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentBrand } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";

// Fan-out routing lives in session/fanout so the session layer can share it
// without depending on the UI. Re-exported here for the composer.
export { EMPTY_ANSWERERS, isFanout, resolveAnswerers } from "@/agentMode/session/fanout/answerers";

/** Frozen empty brand list — referential stability for the "no installed agents" case. */
export const EMPTY_AGENT_BRANDS: ReadonlyArray<AgentBrand> = Object.freeze([]);

/**
 * Brand projections of every installed (`ready`) backend, mentionable in the
 * composer. Registry-driven, so a new backend becomes mentionable automatically.
 */
export function listInstalledAgentBrands(settings: CopilotSettings): ReadonlyArray<AgentBrand> {
  const brands = listBackendDescriptors()
    .filter((descriptor) => descriptor.getInstallState(settings).kind === "ready")
    .map(({ id, displayName, Icon }) => ({ id, displayName, Icon }) satisfies AgentBrand);
  return brands.length > 0 ? brands : EMPTY_AGENT_BRANDS;
}
