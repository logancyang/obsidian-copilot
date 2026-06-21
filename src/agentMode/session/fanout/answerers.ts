import type { BackendId } from "@/agentMode/session/types";

/** Frozen empty answerer list — referential stability for the "no qualifying mentions" case. */
export const EMPTY_ANSWERERS: ReadonlyArray<BackendId> = Object.freeze([]);

/**
 * Resolve the agents that should ANSWER a turn from the user's `@`-mentions: the
 * deduped, installed mentions ONLY. The main agent is NOT auto-included — it is
 * the separate summarizer, answering only when itself mentioned. Order is stable
 * (the pill sync plugin reports them sorted by backend id). Pure and UI-free so
 * the composer and the session layer share one source of truth — see {@link isFanout}.
 */
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

/**
 * Whether a resolved answerer set actually fans out. True for any non-empty set
 * EXCEPT the degenerate `[main]` (only the user's own agent), which collapses to
 * the normal single-agent path so the main agent isn't asked to both answer and
 * summarize the same backend. Callers gate the `mentionedAgents` emission on this.
 */
export function isFanout(answerers: ReadonlyArray<BackendId>, mainAgentId: BackendId): boolean {
  if (answerers.length === 0) return false;
  if (answerers.length === 1 && answerers[0] === mainAgentId) return false;
  return true;
}
