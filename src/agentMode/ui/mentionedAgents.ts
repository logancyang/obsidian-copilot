import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentBrand } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";

// Fan-out routing (answerer resolution + the fan-out predicate) lives in the
// session/fanout domain so the session layer can share it without depending on
// the UI. Re-exported here for the composer, which imports the routing helpers
// alongside the UI-only `listInstalledAgentBrands` below.
export { EMPTY_ANSWERERS, isFanout, resolveAnswerers } from "@/agentMode/session/fanout/answerers";

/** Frozen empty brand list — referential stability for the "no installed agents" case. */
export const EMPTY_AGENT_BRANDS: ReadonlyArray<AgentBrand> = Object.freeze([]);

/**
 * Brand projections of every *installed* backend, mentionable in the composer.
 * Open-ended: driven entirely by the registry, so a newly registered backend
 * becomes mentionable automatically with no edits here. Only backends whose
 * install state is `ready` are offered — an absent/erroring backend can never
 * be selected.
 */
export function listInstalledAgentBrands(settings: CopilotSettings): ReadonlyArray<AgentBrand> {
  const brands = listBackendDescriptors()
    .filter((descriptor) => descriptor.getInstallState(settings).kind === "ready")
    .map(({ id, displayName, Icon }) => ({ id, displayName, Icon }) satisfies AgentBrand);
  return brands.length > 0 ? brands : EMPTY_AGENT_BRANDS;
}
