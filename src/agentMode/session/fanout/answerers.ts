export const EMPTY_ANSWERERS: ReadonlyArray<string> = Object.freeze([]);

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

export function isFanout(answerers: ReadonlyArray<string>, ownAgentSlug: string | null): boolean {
  if (answerers.length === 0) return false;
  if (answerers.length === 1 && ownAgentSlug !== null && answerers[0] === ownAgentSlug)
    return false;
  return true;
}
