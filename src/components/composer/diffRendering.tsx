/**
 * diffRendering.tsx - shared word/line-level diff primitives.
 *
 * Extracted from `ApplyView.tsx` so `InlineDiffCard` (for inline comment edits)
 * and `ApplyView` (for composer edits) can share the same rendering logic.
 *
 * Pure presentation — no external state or Obsidian dependencies.
 */

import { Change, diffArrays } from "diff";
import React, { memo } from "react";

export interface DiffRow {
  original: string | null;
  modified: string | null;
  isUnchanged: boolean;
}

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/**
 * Performs word-level diff between two strings. Tokenizes on whitespace to
 * avoid matching fragments of words.
 */
export function wordLevelDiff(original: string, modified: string): DiffPart[] {
  const tokenize = (str: string): string[] => str.split(/(\s+)/).filter(Boolean);
  const diff = diffArrays(tokenize(original), tokenize(modified));
  return diff.map((part) => ({
    value: part.value.join(""),
    added: part.added,
    removed: part.removed,
  }));
}

/**
 * Splits a string into lines, discarding the trailing empty entry produced by
 * a terminal newline.
 */
export function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Converts a block of `Change` objects into paired rows for line-by-line
 * comparison. Pairs adjacent `removed`/`added` chunks so replacements show
 * side-by-side.
 */
export function buildDiffRows(block: Change[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < block.length) {
    const current = block[i];

    if (!current.added && !current.removed) {
      splitLines(current.value).forEach((line) => {
        rows.push({ original: line, modified: line, isUnchanged: true });
      });
      i++;
    } else if (current.removed) {
      const next = block[i + 1];
      if (next?.added) {
        const originalLines = splitLines(current.value);
        const modifiedLines = splitLines(next.value);
        const maxLines = Math.max(originalLines.length, modifiedLines.length);
        for (let j = 0; j < maxLines; j++) {
          rows.push({
            original: originalLines[j] ?? null,
            modified: modifiedLines[j] ?? null,
            isUnchanged: false,
          });
        }
        i += 2;
      } else {
        splitLines(current.value).forEach((line) => {
          rows.push({ original: line, modified: null, isUnchanged: false });
        });
        i++;
      }
    } else if (current.added) {
      splitLines(current.value).forEach((line) => {
        rows.push({ original: null, modified: line, isUnchanged: false });
      });
      i++;
    } else {
      i++;
    }
  }
  return rows;
}

interface WordDiffSpanProps {
  original: string;
  modified: string;
  side: "original" | "modified";
}

export const WordDiffSpan: React.FC<WordDiffSpanProps> = memo(({ original, modified, side }) => {
  const diff = wordLevelDiff(original, modified);
  return (
    <span>
      {diff.map((part, idx) => {
        if (side === "original") {
          if (part.removed) {
            return (
              <span key={idx} className="tw-bg-error tw-text-error">
                {part.value}
              </span>
            );
          }
          if (part.added) return null;
        } else {
          if (part.added) {
            return (
              <span key={idx} className="tw-bg-success tw-text-success">
                {part.value}
              </span>
            );
          }
          if (part.removed) return null;
        }
        return <span key={idx}>{part.value}</span>;
      })}
    </span>
  );
});
WordDiffSpan.displayName = "WordDiffSpan";

interface DiffCellProps {
  row: DiffRow;
  side: "original" | "modified";
}

export const DiffCell: React.FC<DiffCellProps> = memo(({ row, side }) => {
  const text = side === "original" ? row.original : row.modified;
  const paired = side === "original" ? row.modified : row.original;

  if (text === null) {
    return <span className="tw-text-muted">&nbsp;</span>;
  }
  if (row.isUnchanged) {
    return <span className="tw-text-normal">{text || "\u00A0"}</span>;
  }
  if (paired !== null) {
    return <WordDiffSpan original={row.original!} modified={row.modified!} side={side} />;
  }
  const highlightClass =
    side === "original" ? "tw-bg-error tw-text-error" : "tw-bg-success tw-text-success";
  return <span className={highlightClass}>{text || "\u00A0"}</span>;
});
DiffCell.displayName = "DiffCell";
