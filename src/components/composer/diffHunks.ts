import { applyPatch, structuredPatch, type Hunk, type ParsedDiff } from "diff";

/**
 * Pure utilities for per-hunk and per-line accept/reject in the Apply view.
 *
 * The diff package's {@link structuredPatch} parses (oldText, newText) into a
 * list of hunks; {@link applyPatch} then re-runs each hunk against a source
 * string, locating it by `oldStart`. Because each hunk carries its own
 * coordinates, we can drop or rewrite hunks selectively and re-apply the
 * survivors — the diff package handles line bookkeeping for us.
 *
 * Granularity:
 *  - "hunk" mode → user accepts or rejects whole hunks; we filter the hunks
 *    array and feed the surviving subset to applyPatch.
 *  - "line"  mode → user accepts or rejects individual added/removed lines;
 *    we rewrite each hunk's `lines` to keep only the accepted changes, then
 *    let applyPatch run the rewritten hunks.
 */

/** A decision made on a unit of change. */
export type Decision = "accept" | "reject";

/** Information about a single changed line inside a hunk. */
export interface LineChange {
  /** Index of the hunk this line belongs to. */
  hunkIndex: number;
  /** Index of the line within `hunk.lines`. */
  lineIndex: number;
  /** Either "+" (added) or "-" (removed). Context lines aren't tracked. */
  kind: "+" | "-";
  /** The raw line content, without the prefix character. */
  content: string;
}

/** Result of parsing a patch into hunks + extracted change lines. */
export interface PatchAnalysis {
  parsed: ParsedDiff;
  /** Flat list of every added/removed line across all hunks. */
  changes: LineChange[];
}

/**
 * Parse (oldText, newText) into a {@link ParsedDiff} and extract every
 * added/removed line for downstream UI rendering.
 *
 * @param path - Used as both old/new filename in the patch header.
 * @param oldText - Original file content.
 * @param newText - Proposed file content.
 * @param context - Number of unchanged context lines around each hunk.
 */
export function analyzePatch(
  path: string,
  oldText: string,
  newText: string,
  context = 3
): PatchAnalysis {
  const parsed = structuredPatch(path, path, oldText, newText, "", "", {
    context,
  });

  const changes: LineChange[] = [];
  parsed.hunks.forEach((hunk, hunkIndex) => {
    hunk.lines.forEach((line, lineIndex) => {
      const prefix = line[0];
      if (prefix === "+" || prefix === "-") {
        changes.push({
          hunkIndex,
          lineIndex,
          kind: prefix,
          content: line.slice(1),
        });
      }
    });
  });

  return { parsed, changes };
}

/**
 * Serialize a single {@link Hunk} into a self-contained unified-diff string
 * that {@link import("@pierre/diffs/react").PatchDiff} can render. Used by the
 * hunk-level renderer to render one PatchDiff per hunk.
 *
 * @param path - Filename used in the patch header.
 * @param hunk - Hunk to serialize.
 */
export function hunkToPatchString(path: string, hunk: Hunk): string {
  // Pierre's PatchDiff expects standard unified-diff format: file headers,
  // a hunk header (@@ -X,Y +A,B @@), then the lines verbatim. Each line
  // already carries its prefix; we just join with newlines.
  const header =
    `--- ${path}\n` +
    `+++ ${path}\n` +
    `@@ -${hunk.oldStart},${hunk.oldLines} ` +
    `+${hunk.newStart},${hunk.newLines} @@\n`;
  return header + hunk.lines.join("\n") + "\n";
}

/**
 * Reconstruct the final file text given per-hunk decisions.
 *
 * Rejected hunks are simply omitted from the patch we apply — applyPatch
 * leaves their source lines untouched. Accepted hunks are passed through
 * verbatim.
 *
 * @param oldText - Original file content (must match what was diffed).
 * @param parsed - Parsed patch from {@link analyzePatch}.
 * @param decisions - Decision per hunk index. Hunks without an entry are
 *   treated as accepted (the default-accept UX).
 * @returns The reconstructed text, or `null` if patch application fails
 *   (which shouldn't happen unless oldText has drifted from the diff input).
 */
export function reconstructFromHunkDecisions(
  oldText: string,
  parsed: ParsedDiff,
  decisions: Map<number, Decision>
): string | null {
  const acceptedHunks = parsed.hunks.filter(
    (_, idx) => (decisions.get(idx) ?? "accept") === "accept"
  );

  // Short-circuit: nothing accepted means the file is unchanged.
  if (acceptedHunks.length === 0) return oldText;

  const filteredPatch: ParsedDiff = { ...parsed, hunks: acceptedHunks };
  const result = applyPatch(oldText, filteredPatch);
  return result === false ? null : result;
}

/**
 * Reconstruct the final file text given per-line decisions.
 *
 * For each hunk:
 *  - Context lines (' ') are always kept.
 *  - Removed lines ('-'): kept (un-removed) when **rejected**, dropped when
 *    accepted. A decision of "accept" means "yes, apply this removal."
 *  - Added lines ('+'): kept when accepted, dropped when rejected.
 *
 * After rewriting, `oldLines` and `newLines` counts are recomputed to keep
 * the hunk header consistent. Hunks that end up empty (all + and - lines
 * rejected and no remaining changes) are skipped — applying an empty hunk is
 * a no-op but safer to omit.
 *
 * @param oldText - Original file content.
 * @param parsed - Parsed patch from {@link analyzePatch}.
 * @param decisions - Decision per LineChange, keyed by `${hunkIndex}:${lineIndex}`.
 *   Lines without an entry are treated as accepted.
 */
export function reconstructFromLineDecisions(
  oldText: string,
  parsed: ParsedDiff,
  decisions: Map<string, Decision>
): string | null {
  const rewrittenHunks: Hunk[] = [];

  for (let hunkIndex = 0; hunkIndex < parsed.hunks.length; hunkIndex++) {
    const hunk = parsed.hunks[hunkIndex];
    const keptLines: string[] = [];
    let oldLines = 0;
    let newLines = 0;
    let hasRealChange = false;

    hunk.lines.forEach((line, lineIndex) => {
      const prefix = line[0];
      if (prefix !== "+" && prefix !== "-") {
        // Context line — always keep.
        keptLines.push(line);
        oldLines++;
        newLines++;
        return;
      }
      const key = `${hunkIndex}:${lineIndex}`;
      const decision = decisions.get(key) ?? "accept";
      if (prefix === "+") {
        // Added line: keep only if accepted.
        if (decision === "accept") {
          keptLines.push(line);
          newLines++;
          hasRealChange = true;
        }
      } else {
        // Removed line: keep (as removal) if accepted, demote to context if rejected.
        if (decision === "accept") {
          keptLines.push(line);
          oldLines++;
          hasRealChange = true;
        } else {
          // Demote to context so applyPatch leaves the line in place.
          keptLines.push(" " + line.slice(1));
          oldLines++;
          newLines++;
        }
      }
    });

    if (!hasRealChange) continue;

    rewrittenHunks.push({
      oldStart: hunk.oldStart,
      oldLines,
      newStart: hunk.newStart,
      newLines,
      lines: keptLines,
    });
  }

  if (rewrittenHunks.length === 0) return oldText;

  const filteredPatch: ParsedDiff = { ...parsed, hunks: rewrittenHunks };
  const result = applyPatch(oldText, filteredPatch);
  return result === false ? null : result;
}
