import type { MarkdownBlock } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { diffArrays } from "diff";

/** How one element of the before sequence relates to the after sequence. */
export type Pairing<T> =
  | { kind: "unchanged"; before: T; after: T }
  | { kind: "deleted"; before: T }
  | { kind: "inserted"; after: T }
  | { kind: "modified"; before: T; after: T };

/**
 * Minimum Dice similarity for two removed/added neighbours to be treated as one
 * edited element rather than an unrelated deletion and insertion. Below it the
 * inline diff degenerates into noise, so a clean block-level replacement reads better.
 */
export const PAIR_SIMILARITY_THRESHOLD = 0.5;

/**
 * Dice coefficient over character bigrams — the similarity measure used to decide
 * whether a removed element and an added one are the same element edited.
 * @param before - Source text of the removed element.
 * @param after - Source text of the added element.
 */
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

/** How a sequence alignment decides identity and edit-likeness of its elements. */
export interface AlignmentRules<T> {
  isEqual: (before: T, after: T) => boolean;
  /** Edit-likeness in 0..1; anything below {@link PAIR_SIMILARITY_THRESHOLD} stays unpaired. */
  similarity: (before: T, after: T) => number;
}

/**
 * Pairs one run of removed elements against the run of added elements that
 * follows it, so an edited element surfaces as a single modification instead of
 * an unrelated delete/insert couple.
 * @param removed - Elements the before side lost, in document order.
 * @param added - Elements the after side gained, in document order.
 * @param similarity - Edit-likeness between a removed and an added element.
 */
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

/**
 * Aligns two sequences by exact identity first, then pairs the leftovers of each
 * adjacent removed/added run by similarity.
 * @param before - Elements of the original document.
 * @param after - Elements of the edited document.
 * @param rules - Identity and edit-likeness predicates for the element type.
 */
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

/**
 * Aligns the top-level blocks of two documents. Only blocks of the same kind are
 * ever paired, so a heading is never diffed inline against a table.
 * @param before - Blocks of the original document.
 * @param after - Blocks of the edited document.
 */
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
