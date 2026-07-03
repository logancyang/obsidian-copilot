import { Change, diffArrays } from "diff";
import React, { memo, useMemo } from "react";

/** Represents a row in the diff view with original and modified content */
export interface DiffRow {
  original: string | null;
  modified: string | null;
  isUnchanged: boolean;
}

/**
 * Performs word-level diff between two strings, ensuring only complete words are matched.
 * Uses regex-based tokenization for better performance.
 * @param original - The original string to compare
 * @param modified - The modified string to compare against
 * @returns Array of diff parts with value, added, and removed flags
 */
export function wordLevelDiff(
  original: string,
  modified: string
): { value: string; added?: boolean; removed?: boolean }[] {
  // Split on whitespace boundaries while preserving delimiters
  const tokenize = (str: string): string[] => str.split(/(\s+)/).filter(Boolean);

  const diff = diffArrays(tokenize(original), tokenize(modified));

  return diff.map((part) => ({
    value: part.value.join(""),
    added: part.added,
    removed: part.removed,
  }));
}

/**
 * Splits a string into lines, removing trailing empty line from split.
 * @param value - The string to split
 * @returns Array of lines
 */
export function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Converts a block of changes into row pairs for line-by-line comparison.
 * Handles multi-line chunks and pairs removed/added changes intelligently.
 * @param block - Array of Change objects from the diff library
 * @returns Array of DiffRow objects for rendering
 */
export function buildDiffRows(block: Change[]): DiffRow[] {
  const rows: DiffRow[] = [];

  let i = 0;
  while (i < block.length) {
    const current = block[i];

    if (!current.added && !current.removed) {
      // Unchanged chunk - split into lines and show on both sides
      splitLines(current.value).forEach((line) => {
        rows.push({ original: line, modified: line, isUnchanged: true });
      });
      i++;
    } else if (current.removed) {
      // Check if next item is an added chunk (replacement pair)
      const next = block[i + 1];
      if (next?.added) {
        // Split both chunks into lines and pair by index
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
        // Standalone removal - split into lines
        splitLines(current.value).forEach((line) => {
          rows.push({ original: line, modified: null, isUnchanged: false });
        });
        i++;
      }
    } else if (current.added) {
      // Standalone addition - split into lines
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

/**
 * Renders word-level diff highlighting for a single side of the comparison.
 * Shows only the relevant changes (removed for original, added for modified).
 */
export interface WordDiffSpanProps {
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
              // eslint-disable-next-line @eslint-react/no-array-index-key -- diff parts are computed once per render and not reordered
              <span key={idx} className="tw-bg-error tw-text-error">
                {part.value}
              </span>
            );
          }
          if (part.added) return null;
        } else {
          if (part.added) {
            return (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- diff parts are computed once per render and not reordered
              <span key={idx} className="tw-bg-success tw-text-success">
                {part.value}
              </span>
            );
          }
          if (part.removed) return null;
        }
        // eslint-disable-next-line @eslint-react/no-array-index-key -- diff parts are computed once per render and not reordered
        return <span key={idx}>{part.value}</span>;
      })}
    </span>
  );
});

WordDiffSpan.displayName = "WordDiffSpan";

/**
 * Renders a single cell in the diff view with appropriate highlighting.
 */
export interface DiffCellProps {
  row: DiffRow;
  side: "original" | "modified";
}

export const DiffCell: React.FC<DiffCellProps> = memo(({ row, side }) => {
  const text = side === "original" ? row.original : row.modified;
  const paired = side === "original" ? row.modified : row.original;

  if (text === null) {
    // Empty placeholder for alignment
    return <span className="tw-text-muted">&nbsp;</span>;
  }

  if (row.isUnchanged) {
    return <span className="tw-text-normal">{text || "\u00A0"}</span>;
  }

  if (paired !== null) {
    // Paired change - show word-level diff
    return <WordDiffSpan original={row.original!} modified={row.modified!} side={side} />;
  }

  // Standalone change - highlight entire line
  const highlightClass =
    side === "original" ? "tw-bg-error tw-text-error" : "tw-bg-success tw-text-success";
  return <span className={highlightClass}>{text || "\u00A0"}</span>;
});

DiffCell.displayName = "DiffCell";

/** Side-by-side block component for comparing original and modified content */
export interface SideBySideBlockProps {
  block: Change[];
}

export const SideBySideBlock = memo(({ block }: SideBySideBlockProps) => {
  const rows = useMemo(() => buildDiffRows(block), [block]);

  return (
    <div className="tw-grid tw-grid-cols-2 tw-gap-2">
      {/* Original (left) column */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, idx) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- diff rows are computed once per block and not reordered
          <div key={idx} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            <DiffCell row={row} side="original" />
          </div>
        ))}
      </div>

      {/* Modified (right) column */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, idx) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- diff rows are computed once per block and not reordered
          <div key={idx} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            <DiffCell row={row} side="modified" />
          </div>
        ))}
      </div>
    </div>
  );
});

SideBySideBlock.displayName = "SideBySideBlock";

/** Split block component - shows old and new content separately with highlighting */
export interface SplitBlockProps {
  block: Change[];
}

export const SplitBlock = memo(({ block }: SplitBlockProps) => {
  const hasChanges = block.some((c) => c.added || c.removed);
  const rows = useMemo(() => buildDiffRows(block), [block]);

  if (!hasChanges) {
    // No changes - just show the content once
    return (
      <div className="tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
        {block.map((change, idx) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- block changes are computed once per render and not reordered
          <span key={idx}>{change.value}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {/* Original version with word-level removed parts highlighted */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        <div className="tw-mb-1 tw-text-xs tw-font-medium tw-text-muted">Original</div>
        <div className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
          {rows.map((row, idx) =>
            row.original !== null ? (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- diff rows are computed once per block and not reordered
              <div key={idx}>
                <DiffCell row={row} side="original" />
              </div>
            ) : null
          )}
        </div>
      </div>

      {/* Modified version with word-level added parts highlighted */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        <div className="tw-mb-1 tw-text-xs tw-font-medium tw-text-muted">Modified</div>
        <div className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
          {rows.map((row, idx) =>
            row.modified !== null ? (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- diff rows are computed once per block and not reordered
              <div key={idx}>
                <DiffCell row={row} side="modified" />
              </div>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
});

SplitBlock.displayName = "SplitBlock";
