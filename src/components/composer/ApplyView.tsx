import { logError } from "@/logger";
import { Change, diffArrays } from "diff";
import { ItemView, WorkspaceLeaf } from "obsidian";
import React, { memo, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { getChangeBlocks } from "@/composerUtils";

/** Represents a row in the diff view with original and modified content */
interface DiffRow {
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
function wordLevelDiff(
  original: string,
  modified: string
): { value: string; added?: boolean; removed?: boolean }[] {
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
function splitLines(value: string): string[] {
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
function buildDiffRows(block: Change[]): DiffRow[] {
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

/**
 * Renders word-level diff highlighting for a single side of the comparison.
 */
interface WordDiffSpanProps {
  original: string;
  modified: string;
  side: "original" | "modified";
}

const WordDiffSpan: React.FC<WordDiffSpanProps> = memo(({ original, modified, side }) => {
  const diff = wordLevelDiff(original, modified);

  return (
    <span>
      {diff.map((part, idx) => {
        if (side === "original") {
          if (part.removed)
            return (
              <span key={idx} className="tw-bg-error tw-text-error">
                {part.value}
              </span>
            );
          if (part.added) return null;
        } else {
          if (part.added)
            return (
              <span key={idx} className="tw-bg-success tw-text-success">
                {part.value}
              </span>
            );
          if (part.removed) return null;
        }
        return <span key={idx}>{part.value}</span>;
      })}
    </span>
  );
});

WordDiffSpan.displayName = "WordDiffSpan";

/**
 * Renders a single cell in the diff view with appropriate highlighting.
 */
interface DiffCellProps {
  row: DiffRow;
  side: "original" | "modified";
}

const DiffCell: React.FC<DiffCellProps> = memo(({ row, side }) => {
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

export const APPLY_VIEW_TYPE = "obsidian-copilot-apply-view";

export interface ApplyViewState {
  changes: Change[];
  path: string;
}

export class ApplyView extends ItemView {
  private root: ReturnType<typeof createRoot> | null = null;
  private state: ApplyViewState | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return APPLY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "View Diff";
  }

  async setState(state: ApplyViewState) {
    this.state = state;
    this.render();
  }

  async onOpen() {
    this.render();
  }

  async onClose() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  private render() {
    if (!this.state) return;

    const contentEl = this.containerEl.children[1];
    contentEl.empty();

    const rootEl = contentEl.createDiv();
    if (!this.root) {
      this.root = createRoot(rootEl);
    }

    this.root.render(<ApplyViewRoot state={this.state} />);
  }
}

interface ApplyViewRootProps {
  state: ApplyViewState;
}

/**
 * Side-by-side diff block showing original (left, red) and modified (right, green) content.
 */
interface SideBySideBlockProps {
  block: Change[];
}

const SideBySideBlock = memo(({ block }: SideBySideBlockProps) => {
  const rows = useMemo(() => buildDiffRows(block), [block]);
  const hasChanges = block.some((c) => c.added || c.removed);

  if (!hasChanges) {
    return (
      <div className="tw-whitespace-pre-wrap tw-px-2 tw-py-0.5 tw-font-mono tw-text-sm tw-text-normal">
        {block.map((change, idx) => (
          <span key={idx}>{change.value}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="tw-mb-2 tw-grid tw-grid-cols-2 tw-gap-2">
      {/* Original (left) column */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, idx) => (
          <div key={idx} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            <DiffCell row={row} side="original" />
          </div>
        ))}
      </div>

      {/* Modified (right) column */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, idx) => (
          <div key={idx} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            <DiffCell row={row} side="modified" />
          </div>
        ))}
      </div>
    </div>
  );
});

SideBySideBlock.displayName = "SideBySideBlock";

const ApplyViewRoot: React.FC<ApplyViewRootProps> = ({ state }) => {
  const changeBlocks = useMemo(() => getChangeBlocks(state.changes), [state.changes]);

  if (!state?.changes) {
    logError("ApplyView: invalid state — missing changes");
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-text-error">
        Error: missing diff data
      </div>
    );
  }

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      {/* Header */}
      <div className="tw-flex tw-items-center tw-border-b tw-border-solid tw-border-border tw-p-2">
        <div className="tw-truncate tw-text-sm tw-font-medium tw-text-muted">{state.path}</div>
      </div>

      {/* Diff blocks */}
      <div className="tw-flex-1 tw-overflow-auto tw-p-2">
        {changeBlocks.map((block, idx) => (
          <SideBySideBlock key={idx} block={block} />
        ))}
      </div>
    </div>
  );
};
