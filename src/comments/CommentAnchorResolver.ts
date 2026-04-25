/**
 * CommentAnchorResolver - pure functions for capturing and resolving inline
 * comment anchors.
 *
 * Strategy (in order):
 *   1. Exact "prefix + exactText + suffix" in a window around the saved line
 *   2. Exact "exactText" in the same window
 *   3. Fuzzy match via normalization
 *   4. Give up → orphaned
 *
 * The resolver is intentionally view-agnostic: it operates on a plain string
 * document so it can run without a live EditorView (e.g., when loading from
 * disk while the note isn't open).
 */

import type { CommentAnchor } from "./types";

/** ±2000 chars around the expected offset. */
const SEARCH_WINDOW_CHARS = 2000;

export interface ResolvedAnchorRange {
  from: number;
  to: number;
}

export interface CaptureInput {
  doc: string;
  from: number;
  to: number;
  contextLen?: number;
}

export function captureAnchor(input: CaptureInput): CommentAnchor {
  const { doc, from, to } = input;
  const contextLen = input.contextLen ?? 40;
  const exactText = doc.slice(from, to);
  const prefixStart = Math.max(0, from - contextLen);
  const suffixEnd = Math.min(doc.length, to + contextLen);
  const prefix = doc.slice(prefixStart, from);
  const suffix = doc.slice(to, suffixEnd);
  const startLineInfo = computeLinePos(doc, from);
  const endLineInfo = computeLinePos(doc, to);
  return {
    exactText,
    prefix,
    suffix,
    startLine: startLineInfo.line,
    startCh: startLineInfo.ch,
    endLine: endLineInfo.line,
    endCh: endLineInfo.ch,
    docLengthAtCapture: doc.length,
  };
}

/**
 * Resolve an anchor to a current document range.
 *
 * @returns `{from, to}` if resolvable, `null` if orphaned.
 */
export function resolveAnchor(doc: string, anchor: CommentAnchor): ResolvedAnchorRange | null {
  const expectedOffset = estimateOffsetForAnchor(doc, anchor);
  const windowStart = Math.max(0, expectedOffset - SEARCH_WINDOW_CHARS);
  const windowEnd = Math.min(doc.length, expectedOffset + SEARCH_WINDOW_CHARS);
  const window = doc.slice(windowStart, windowEnd);

  // Tier 1: prefix + exactText + suffix.
  const contextKey = anchor.prefix + anchor.exactText + anchor.suffix;
  const tier1 = findClosest(window, contextKey, expectedOffset - windowStart);
  if (tier1 !== -1) {
    const from = windowStart + tier1 + anchor.prefix.length;
    const to = from + anchor.exactText.length;
    return { from, to };
  }

  // Tier 2: exactText only (closest to expected offset).
  const tier2 = findClosest(window, anchor.exactText, expectedOffset - windowStart);
  if (tier2 !== -1) {
    const from = windowStart + tier2;
    const to = from + anchor.exactText.length;
    return { from, to };
  }

  // Tier 3: fuzzy match within the window.
  const fuzzyDoc = fuzzyNormalize(window);
  const fuzzyNeedle = fuzzyNormalize(anchor.exactText);
  if (fuzzyNeedle.length >= 4) {
    const tier3 = findClosest(fuzzyDoc, fuzzyNeedle, expectedOffset - windowStart);
    if (tier3 !== -1) {
      // Map fuzzy-index back to original doc. Our fuzzyNormalize preserves
      // string length (it only substitutes chars, no deletions), so indices
      // align 1:1.
      const from = windowStart + tier3;
      const to = from + anchor.exactText.length;
      if (to <= doc.length) return { from, to };
    }
  }

  return null;
}

/**
 * Finds all occurrences of `needle` in `haystack` and returns the one whose
 * start index is closest to `expected`. Returns -1 if none.
 */
function findClosest(haystack: string, needle: string, expected: number): number {
  if (!needle) return -1;
  let best = -1;
  let bestDist = Infinity;
  let from = 0;
  let idx = haystack.indexOf(needle, from);
  while (idx !== -1) {
    const dist = Math.abs(idx - expected);
    if (dist < bestDist) {
      best = idx;
      bestDist = dist;
    }
    from = idx + 1;
    idx = haystack.indexOf(needle, from);
  }
  return best;
}

/**
 * Estimate the current offset of the anchor by scaling the capture-time line
 * position into the current doc. If the doc hasn't grown or shrunk much, this
 * reduces to near-identity.
 */
function estimateOffsetForAnchor(doc: string, anchor: CommentAnchor): number {
  const ratio = anchor.docLengthAtCapture > 0 ? doc.length / anchor.docLengthAtCapture : 1;
  const lineOffset = resolveLineStart(doc, anchor.startLine);
  if (lineOffset !== -1) return Math.min(doc.length, lineOffset + anchor.startCh);
  return Math.floor(anchor.startLine * ratio * 80); // fallback heuristic
}

function resolveLineStart(doc: string, line: number): number {
  if (line <= 0) return 0;
  let found = 0;
  let idx = 0;
  for (let i = 0; i < doc.length; i++) {
    if (doc.charCodeAt(i) === 10) {
      found++;
      if (found === line) return i + 1;
    }
    idx++;
  }
  return line === found ? idx : -1;
}

function computeLinePos(doc: string, offset: number): { line: number; ch: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < doc.length; i++) {
    if (doc.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, ch: offset - lineStart };
}

/**
 * Length-preserving normalization: substitutes LLM-style unicode punctuation
 * for ASCII equivalents so fuzzy lookup survives smart-quote rewrites etc.
 * Do NOT remove or insert characters — we rely on 1:1 offset mapping.
 */
function fuzzyNormalize(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}
