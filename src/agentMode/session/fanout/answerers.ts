/** Frozen empty answerer list — referential stability for the "no qualifying mentions" case. */
export const EMPTY_ANSWERERS: ReadonlyArray<string> = Object.freeze([]);

/**
 * Resolve the agents that should ANSWER a turn from the user's `@`-mentions: the
 * deduped slugs that still name an agent on disk. The chat's own agent is NOT
 * auto-included — it summarizes multiple answerers and answers only when itself
 * mentioned. Order is stable (the pill sync plugin reports them in editor
 * order). Pure and UI-free so the composer and session layer share one source of
 * truth — see {@link isFanout}. See `designdocs/CUSTOM_AGENTS.md` §6.
 *
 * @param mentionedSlugs - Slugs of the agent pills in the composer, in editor order.
 * @param knownSlugs - Slugs that currently resolve to an agent folder; a mention
 *   of a deleted agent is dropped rather than sent to nobody.
 */
export function resolveAnswerers(args: {
  mentionedSlugs: ReadonlyArray<string>;
  knownSlugs: ReadonlySet<string>;
}): ReadonlyArray<string> {
  const { mentionedSlugs, knownSlugs } = args;
  const answerers: string[] = [];
  const seen = new Set<string>();
  for (const slug of mentionedSlugs) {
    if (seen.has(slug)) continue;
    if (!knownSlugs.has(slug)) continue;
    seen.add(slug);
    answerers.push(slug);
  }
  return answerers.length > 0 ? answerers : EMPTY_ANSWERERS;
}

/**
 * Whether a resolved answerer set actually fans out. True for any non-empty set
 * EXCEPT the degenerate "only the chat's own persona", which collapses to the
 * normal single-agent path so the chat's own agent isn't routed through an
 * ephemeral sub-session. Callers gate the `mentionedAgents` emission on this.
 *
 * @param answerers - Slugs resolved by {@link resolveAnswerers}.
 * @param ownAgentSlug - Slug of the agent this chat is held with, or null for
 *   the built-in Copilot, which has no slug and so can never be mentioned.
 */
export function isFanout(answerers: ReadonlyArray<string>, ownAgentSlug: string | null): boolean {
  if (answerers.length === 0) return false;
  if (answerers.length === 1 && ownAgentSlug !== null && answerers[0] === ownAgentSlug)
    return false;
  return true;
}
