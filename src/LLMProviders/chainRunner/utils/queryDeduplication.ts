/**
 * Utilities for the ReAct agent loop with small local models.
 * - Query deduplication to prevent near-identical repeated searches
 * - Leaked role token cleanup for models that leak chat template fragments
 */

/**
 * Compute Jaccard similarity between two strings based on lowercased word sets.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Jaccard similarity coefficient (0-1)
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
  return intersection / union;
}

/**
 * Check if a query is a near-duplicate of any previously issued query.
 *
 * @param query - The new query to check
 * @param previousQueries - List of previously issued queries
 * @param threshold - Jaccard similarity threshold above which queries are considered duplicates (default 0.5)
 * @returns The first matching previous query if found, or null
 */
export function findDuplicateQuery(
  query: string,
  previousQueries: string[],
  threshold = 0.5
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
