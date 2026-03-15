/**
 * Utilities for the ReAct agent loop with small local models.
 * - Query deduplication to prevent near-identical repeated searches
 * - Leaked role token cleanup for models that leak chat template fragments
 */

/**
 * Compute similarity between two strings using the maximum of Jaccard
 * similarity and containment coefficient on lowercased word sets.
 *
 * Jaccard = |A ∩ B| / |A ∪ B| -- good for symmetric overlap.
 * Containment = |A ∩ B| / min(|A|, |B|) -- catches when one query is
 * a refinement of another (e.g. "Paul Graham getting rich" vs
 * "Paul Graham essay how to get rich").
 *
 * @param a - First string
 * @param b - Second string
 * @returns max(jaccard, containment) similarity (0-1)
 */
export function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(wordsA.size, wordsB.size);

  return Math.max(jaccard, containment);
}

/**
 * Check if a query is a near-duplicate of any previously issued query.
 *
 * @param query - The new query to check
 * @param previousQueries - List of previously issued queries
 * @param threshold - Similarity threshold above which queries are considered duplicates (default 0.6)
 * @returns The first matching previous query if found, or null
 */
export function findDuplicateQuery(
  query: string,
  previousQueries: string[],
  threshold = 0.6
): string | null {
  for (const prev of previousQueries) {
    if (computeWordOverlap(query, prev) >= threshold) {
      return prev;
    }
  }
  return null;
}

/**
 * Regex matching lines that contain ONLY a leaked chat template role identifier
 * starting at column 0. After stripSpecialTokens removes markers like `<|im_start|>`,
 * the bare role name (e.g. "user", "assistant") can remain. These pollute conversation
 * history and confuse small models on subsequent iterations.
 * No leading \s* -- preserves indented code lines like "    system".
 */
const LEAKED_ROLE_LINE = /^(user|assistant|system)\s*$/;

/**
 * Strip lines that are only leaked chat template role identifiers.
 * Applied to intermediate model output (when tool calls are present) to prevent
 * leaked tokens like "user" from polluting the conversation history.
 *
 * @param text - Model output text after special token stripping
 * @returns Cleaned text with role-only lines removed
 */
export function stripLeakedRoleLines(text: string): string {
  if (!text) return text;
  return text
    .split("\n")
    .filter((line) => !LEAKED_ROLE_LINE.test(line))
    .join("\n");
}
