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

export function findDuplicateQuery(query: string, previousQueries: string[]): string | null {
  for (const prev of previousQueries) {
    if (computeWordOverlap(query, prev) >= 0.6) {
      return prev;
    }
  }
  return null;
}

const LEAKED_ROLE_LINE = /^(user|assistant|system)\s*$/;

export function stripLeakedRoleLines(text: string): string {
  if (!text) return text;
  return text
    .split("\n")
    .filter((line) => !LEAKED_ROLE_LINE.test(line))
    .join("\n");
}
