import type { BackendId } from "@/agentMode/session/types";

/** Frozen empty answerer list — referential stability for the "no qualifying mentions" case. */
export const EMPTY_ANSWERERS: ReadonlyArray<BackendId> = Object.freeze([]);

/**
 * Resolve the agents that should ANSWER a turn from the pills the user
 * `@`-mentioned: the deduped, installed mentions ONLY. The session's main agent
 * is NOT auto-included — it is the separate summarizer, and answers only when it
 * is itself explicitly `@`-mentioned. Mentions of agents that aren't installed
 * are dropped. Order is stable, following the order received (the pill sync
 * plugin reports them sorted by backend id). May be empty (no mentions),
 * `[main]` (only the user's own agent), or any larger set.
 *
 * Pure and UI-free so both the composer (which resolves the user's pills) and
 * the session layer (which re-derives fan-out routing from the stored selection)
 * share one source of truth — see {@link isFanout}.
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
 * EXCEPT the degenerate `[main]` (the user `@`-ed only their own agent): that
 * collapses to the normal single-agent path — identical to a plain turn — so
 * the main agent isn't asked to both answer and summarize the same backend. The
 * single-agent path (`[]` or `[main]`) is the existing behavior and must stay
 * byte-for-byte identical, so callers gate the structured `mentionedAgents`
 * emission on this.
 */
export function isFanout(answerers: ReadonlyArray<BackendId>, mainAgentId: BackendId): boolean {
  if (answerers.length === 0) return false;
  if (answerers.length === 1 && answerers[0] === mainAgentId) return false;
  return true;
}
