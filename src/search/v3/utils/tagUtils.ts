/**
 * Extracts hash-prefixed tags (and hierarchical variants) from a query string.
 * Normalizes results to lowercase while preserving the hash prefix.
 *
 * @param query - The user-supplied query
 * @returns Array of normalized tag tokens (e.g., ['#project', '#project/alpha'])
 */
export function extractTagsFromQuery(query: string): string[] {
  if (!query) {
    return [];
  }

  let matches: RegExpMatchArray | null = null;
  try {
    matches = query.match(/#[\p{L}\p{N}_/-]+/gu);
  } catch {
    matches = query.match(/#[a-zA-Z0-9_/-]+/g);
  }

  if (!matches) {
    return [];
  }

  const normalized = new Set<string>();
  for (const raw of matches) {
    const trimmed = raw.trim();
    if (trimmed.length <= 1) {
      continue;
    }
    normalized.add(trimmed.toLowerCase());
  }

  return Array.from(normalized);
}
