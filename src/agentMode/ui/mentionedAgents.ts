import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";

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

/**
 * Resolve the structured set of agents that should answer a turn from the
 * pills the user `@`-mentioned. The session's main agent is always the first
 * answer (baseline), even when unmentioned; an explicit `@`-mention of the
 * main agent is deduped rather than doubled. Mentions of agents that aren't
 * installed are dropped. Order is stable: main first, then mentions in the
 * order the user added them.
 */
export function resolveMentionedAgents(args: {
  mainAgentId: BackendId;
  mentionedAgentIds: ReadonlyArray<BackendId>;
  installedAgentIds: ReadonlySet<BackendId>;
}): ReadonlyArray<BackendId> {
  const { mainAgentId, mentionedAgentIds, installedAgentIds } = args;
  const resolved: BackendId[] = [mainAgentId];
  const seen = new Set<BackendId>([mainAgentId]);
  for (const id of mentionedAgentIds) {
    if (seen.has(id)) continue;
    if (!installedAgentIds.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  return resolved;
}

/**
 * Whether a resolved selection actually fans out (more than just the main
 * agent). The single-agent path (`[main]`) is the existing behavior and must
 * stay identical, so callers gate the structured `mentionedAgents` emission on
 * this.
 */
export function isFanout(resolved: ReadonlyArray<BackendId>): boolean {
  return resolved.length > 1;
}
