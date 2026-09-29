import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { Change, diffArrays } from "diff";
import { Check, X as XIcon } from "lucide-react";
import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React, { memo, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { getChangeBlocks } from "@/composerUtils";
import { ApplyViewResult } from "@/types";
import { ensureFolderExists } from "@/utils";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface DiffRow {
  original: string | null;
  modified: string | null;
  isUnchanged: boolean;
}

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

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

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
  resultCallback?: (result: ApplyViewResult) => void;
  simple?: boolean;
}

interface ExtendedChange extends Change {
  accepted: boolean | null;
}

export class ApplyView extends ItemView {
  private root: ReturnType<typeof createPluginRoot> | null = null;
  private state: ApplyViewState | null = null;
  private result: ApplyViewResult | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return APPLY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Preview Changes";
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

    this.state?.resultCallback?.(this.result ? this.result : "aborted");
  }

  private render() {
    if (!this.state) return;

    const contentEl = this.containerEl.children[1];
    contentEl.empty();

    const rootEl = contentEl.createDiv();
    if (!this.root) {
      this.root = createPluginRoot(rootEl, this.app);
    }

    this.root.render(
      <ApplyViewRoot
        app={this.app}
        state={this.state}
        close={(result) => {
          this.result = result;
          this.leaf.detach();
        }}
      />
    );
  }
}

interface ApplyViewRootProps {
  app: App;
  state: ApplyViewState;
  close: (result: ApplyViewResult) => void;
}

interface SideBySideBlockProps {
  block: Change[];
}

const SideBySideBlock = memo(({ block }: SideBySideBlockProps) => {
  const rows = useMemo(() => buildDiffRows(block), [block]);

  return (
    <div className="tw-grid tw-grid-cols-2 tw-gap-2">
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, idx) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- diff rows are computed once per block and not reordered
          <div key={idx} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            <DiffCell row={row} side="original" />
          </div>
        ))}
      </div>

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

interface SplitBlockProps {
  block: Change[];
}

const SplitBlock = memo(({ block }: SplitBlockProps) => {
  const hasChanges = block.some((c) => c.added || c.removed);
  const rows = useMemo(() => buildDiffRows(block), [block]);

  if (!hasChanges) {
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

const ApplyViewRoot: React.FC<ApplyViewRootProps> = ({ app, state, close }) => {
  const simple = state.simple ?? false;
  const [diff, setDiff] = useState<ExtendedChange[]>(() => {
    return state.changes.map((change) => ({
      ...change,
      accepted: null,
    }));
  });

  const [viewMode, setViewMode] = useState<"side-by-side" | "split">(
    () => getSettings().diffViewMode ?? "split"
  );

  const handleViewModeChange = (mode: "side-by-side" | "split") => {
    setViewMode(mode);
    updateSetting("diffViewMode", mode);
  };

  const changeBlocks = getChangeBlocks(diff);

  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);

  if (!state || !state.changes) {
    logError("Invalid state:", state);
    return (
      <div className="tw-flex tw-h-full tw-flex-col tw-items-center tw-justify-center">
        <div className="tw-text-error">Error: Invalid state - missing changes</div>
        <Button onClick={() => close("failed")} className="tw-mt-4">
          Close
        </Button>
      </div>
    );
  }

  const handleAccept = async () => {
    try {
      const updatedDiff = diff.map((change) =>
        change.accepted === null ? { ...change, accepted: true } : change
      );

      const result = await applyDecidedChangesToFile(updatedDiff);
      close(result ? "accepted" : "failed");
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(
        `Error applying changes: ${error instanceof Error ? error.message : String(error)}`
      );
      close("failed");
    }
  };

  const handleReject = async () => {
    try {
      const updatedDiff = diff.map((change) =>
        change.accepted === null ? { ...change, accepted: false } : change
      );

      const result = await applyDecidedChangesToFile(updatedDiff, false);
      close(result ? "rejected" : "failed");
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(
        `Error applying changes: ${error instanceof Error ? error.message : String(error)}`
      );
      close("failed");
    }
  };

  const getFile = async (file_path: string) => {
    const file = app.vault.getAbstractFileByPath(file_path);
    if (file) {
      return file;
    }
    if (file_path.includes("/")) {
      const folderPath = file_path.split("/").slice(0, -1).join("/");
      await ensureFolderExists(app.vault, folderPath);
    }
    return await app.vault.create(file_path, "");
  };

  const applyDecidedChangesToFile = async (
    updatedDiff: ExtendedChange[],
    showSuccessNotice = true
  ) => {
    const newContent = updatedDiff
      .filter((change) => {
        if (change.added) return change.accepted === true;
        if (change.removed) return change.accepted === false;
        return true;
      })
      .map((change) => change.value)
      .join("");

    const file = await getFile(state.path);
    if (!file || !(file instanceof TFile)) {
      logError("Error in getting file", state.path);
      new Notice("Failed to create file");
      return false;
    }

    await app.vault.modify(file, newContent);
    if (showSuccessNotice) {
      new Notice("Changes applied successfully");
    }
    return true;
  };

  const focusNextChangeBlock = (currentBlockIndex: number) => {
    if (!changeBlocks) return;

    let nextBlockIndex = -1;
    for (let i = currentBlockIndex + 1; i < changeBlocks.length; i++) {
      const block = changeBlocks[i];
      const hasChanges = block.some((change) => change.added || change.removed);
      const isUndecided = block.some(
        (change) => (change.added || change.removed) && (change as ExtendedChange).accepted === null
      );

      if (hasChanges && isUndecided) {
        nextBlockIndex = i;
        break;
      }
    }

    if (nextBlockIndex !== -1 && blockRefs.current[nextBlockIndex]) {
      blockRefs.current[nextBlockIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const acceptBlock = (blockIndex: number) => {
    setDiff((prevDiff) => {
      const newDiff = [...prevDiff];
      const block = changeBlocks?.[blockIndex];

      if (!block) return newDiff;

      block.forEach((blockChange) => {
        const index = newDiff.findIndex((change) => change === blockChange);
        if (index !== -1) {
          newDiff[index] = {
            ...newDiff[index],
            accepted: true,
          };
        }
      });

      return newDiff;
    });

    window.setTimeout(() => focusNextChangeBlock(blockIndex), 0);
  };

  const rejectBlock = (blockIndex: number) => {
    setDiff((prevDiff) => {
      const newDiff = [...prevDiff];
      const block = changeBlocks?.[blockIndex];

      if (!block) return newDiff;

      block.forEach((blockChange) => {
        const index = newDiff.findIndex((change) => change === blockChange);
        if (index !== -1) {
          newDiff[index] = {
            ...newDiff[index],
            accepted: false,
          };
        }
      });

      return newDiff;
    });

    window.setTimeout(() => focusNextChangeBlock(blockIndex), 0);
  };

  return (
    <div className="tw-relative tw-flex tw-h-full tw-flex-col">
      <div className="tw-fixed tw-bottom-4 tw-left-1/2 tw-z-[9999] tw-flex tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2 tw-shadow-lg">
        <Button variant="destructive" size="sm" onClick={safeAsyncHandler(handleReject)}>
          <XIcon className="tw-size-4" />
          Reject
        </Button>
        <Button variant="success" size="sm" onClick={safeAsyncHandler(handleAccept)}>
          <Check className="tw-size-4" />
          Accept
        </Button>
      </div>
      <div className="tw-flex tw-items-center tw-justify-between tw-border-b tw-border-solid tw-border-border tw-p-2">
        <div className="tw-text-sm tw-font-medium">{state.path}</div>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span
            className={cn(
              "tw-text-xs",
              viewMode === "split" ? "tw-font-medium tw-text-normal" : "tw-text-muted"
            )}
          >
            Split
          </span>
          <SettingSwitch
            checked={viewMode === "side-by-side"}
            onCheckedChange={(checked) => handleViewModeChange(checked ? "side-by-side" : "split")}
          />
          <span
            className={cn(
              "tw-text-xs",
              viewMode === "side-by-side" ? "tw-font-medium tw-text-normal" : "tw-text-muted"
            )}
          >
            Side-by-side
          </span>
        </div>
      </div>

      <div className="tw-flex-1 tw-overflow-auto tw-p-2">
        {changeBlocks?.map((block, blockIndex) => {
          const hasChanges = block.some((change) => change.added || change.removed);

          const blockStatus = hasChanges
            ? block.every(
                (change) =>
                  (!change.added && !change.removed) || (change as ExtendedChange).accepted === true
              )
              ? "accepted"
              : block.every(
                    (change) =>
                      (!change.added && !change.removed) ||
                      (change as ExtendedChange).accepted === false
                  )
                ? "rejected"
                : "undecided"
            : "unchanged";

          return (
            <div
              // eslint-disable-next-line @eslint-react/no-array-index-key -- changeBlocks is computed once from the diff and not reordered; blockIndex also keys blockRefs
              key={blockIndex}
              ref={(el) => (blockRefs.current[blockIndex] = el)}
              className={cn("tw-mb-4 tw-overflow-hidden tw-rounded-md")}
            >
              {blockStatus === "accepted" ? (
                <div className="tw-flex-1 tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
                  {block
                    .filter((change) => !change.removed)
                    .map((change, idx) => (
                      // eslint-disable-next-line @eslint-react/no-array-index-key -- block changes are computed once per render and not reordered
                      <div key={idx}>{change.value}</div>
                    ))}
                </div>
              ) : blockStatus === "rejected" ? (
                <div className="tw-flex-1 tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
                  {block
                    .filter((change) => !change.added)
                    .map((change, idx) => (
                      // eslint-disable-next-line @eslint-react/no-array-index-key -- block changes are computed once per render and not reordered
                      <div key={idx}>{change.value}</div>
                    ))}
                </div>
              ) : viewMode === "side-by-side" ? (
                <SideBySideBlock block={block} />
              ) : (
                <SplitBlock block={block} />
              )}

              {!simple && hasChanges && blockStatus === "undecided" && (
                <div className="tw-flex tw-items-center tw-justify-end tw-border-0 tw-border-t tw-border-solid tw-border-border tw-p-2">
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Button variant="destructive" size="sm" onClick={() => rejectBlock(blockIndex)}>
                      <XIcon className="tw-size-4" />
                      Reject
                    </Button>
                    <Button variant="success" size="sm" onClick={() => acceptBlock(blockIndex)}>
                      <Check className="tw-size-4" />
                      Accept
                    </Button>
                  </div>
                </div>
              )}

              {!simple &&
                hasChanges &&
                (blockStatus === "accepted" || blockStatus === "rejected") && (
                  <div className="tw-flex tw-items-center tw-justify-end tw-border-0 tw-border-t tw-border-solid tw-border-border tw-p-2">
                    <div className="tw-flex tw-items-center tw-gap-2">
                      <div className="tw-mr-2 tw-text-sm tw-font-medium">
                        {blockStatus === "accepted" ? (
                          <div className="tw-flex tw-items-center tw-gap-1 tw-text-success">
                            <Check className="tw-size-4" />
                            <div>Accepted</div>
                          </div>
                        ) : (
                          <div className="tw-flex tw-items-center tw-gap-1 tw-text-error">
                            <XIcon className="tw-size-4" />
                            <div>Rejected</div>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDiff((prevDiff) => {
                            const newDiff = [...prevDiff];
                            const block = changeBlocks?.[blockIndex];

                            if (!block) return newDiff;

                            block.forEach((blockChange) => {
                              const index = newDiff.findIndex((change) => change === blockChange);
                              if (index !== -1) {
                                newDiff[index] = {
                                  ...newDiff[index],
                                  accepted: null,
                                };
                              }
                            });

                            return newDiff;
                          });
                        }}
                      >
                        Revert
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
