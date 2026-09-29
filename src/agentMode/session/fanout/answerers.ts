import type { BackendId } from "@/agentMode/session/types";

export const EMPTY_ANSWERERS: ReadonlyArray<BackendId> = Object.freeze([]);

export function resolveAnswerers(args: {
  mentionedAgentIds: ReadonlyArray<BackendId>;
  installedAgentIds: ReadonlySet<BackendId>;
}): ReadonlyArray<BackendId> {
  const { mentionedAgentIds, installedAgentIds } = args;
  const answerers: BackendId[] = [];
  const seen = new Set<BackendId>();
  for (const id of mentionedAgentIds) {
    if (seen.has(id)) continue;
    if (!installedAgentIds.has(id)) continue;
    seen.add(id);
    answerers.push(id);
  }
  return answerers.length > 0 ? answerers : EMPTY_ANSWERERS;
}

export function isFanout(answerers: ReadonlyArray<BackendId>, mainAgentId: BackendId): boolean {
  if (answerers.length === 0) return false;
  if (answerers.length === 1 && answerers[0] === mainAgentId) return false;
  return true;
}
