import type { MarkdownBlock } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { diffArrays } from "diff";

export type Pairing<T> =
  | { kind: "unchanged"; before: T; after: T }
  | { kind: "deleted"; before: T }
  | { kind: "inserted"; after: T }
  | { kind: "modified"; before: T; after: T };

export const PAIR_SIMILARITY_THRESHOLD = 0.5;

export function diceSimilarity(before: string, after: string): number {
  if (before === after) return 1;
  if (before.length < 2 || after.length < 2) return 0;
  const counts = bigramCounts(before);
  let overlap = 0;
  for (let index = 0; index < after.length - 1; index++) {
    const bigram = after.slice(index, index + 2);
    const remaining = counts.get(bigram) ?? 0;
    if (remaining === 0) continue;
    counts.set(bigram, remaining - 1);
    overlap++;
  }
  return (2 * overlap) / (before.length - 1 + (after.length - 1));
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index++) {
    const bigram = value.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
}

export interface AlignmentRules<T> {
  isEqual: (before: T, after: T) => boolean;
  similarity: (before: T, after: T) => number;
}

export function pairRuns<T>(
  removed: readonly T[],
  added: readonly T[],
  similarity: (before: T, after: T) => number
): Pairing<T>[] {
  const pairings: Pairing<T>[] = [];
  let next = 0;
  for (const before of removed) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let candidate = next; candidate < added.length; candidate++) {
      const score = similarity(before, added[candidate]);
      if (score < PAIR_SIMILARITY_THRESHOLD || score <= bestScore) continue;
      bestScore = score;
      bestIndex = candidate;
    }
    if (bestIndex === -1) {
      pairings.push({ kind: "deleted", before });
      continue;
    }
    for (; next < bestIndex; next++) pairings.push({ kind: "inserted", after: added[next] });
    pairings.push({ kind: "modified", before, after: added[bestIndex] });
    next = bestIndex + 1;
  }
  for (; next < added.length; next++) pairings.push({ kind: "inserted", after: added[next] });
  return pairings;
}

export function alignSequences<T>(
  before: readonly T[],
  after: readonly T[],
  rules: AlignmentRules<T>
): Pairing<T>[] {
  const parts = diffArrays([...before], [...after], {
    comparator: (left, right) => rules.isEqual(left, right),
  });
  const pairings: Pairing<T>[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part.added && !part.removed) {
      for (const value of part.value)
        pairings.push({ kind: "unchanged", before: value, after: value });
      continue;
    }
    const next = parts[index + 1];
    if (part.removed && next?.added) {
      pairings.push(...pairRuns(part.value, next.value, rules.similarity));
      index++;
      continue;
    }
    if (part.added && next?.removed) {
      pairings.push(...pairRuns(next.value, part.value, rules.similarity));
      index++;
      continue;
    }
    for (const value of part.value) {
      pairings.push(
        part.removed ? { kind: "deleted", before: value } : { kind: "inserted", after: value }
      );
    }
  }
  return pairings;
}

export function alignBlocks(
  before: readonly MarkdownBlock[],
  after: readonly MarkdownBlock[]
): Pairing<MarkdownBlock>[] {
  return alignSequences(before, after, {
    isEqual: (left, right) => left.type === right.type && left.text === right.text,
    similarity: (left, right) =>
      left.type === right.type ? diceSimilarity(left.text, right.text) : 0,
  });
}
