import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { Change, diffArrays } from "diff";

/**
 * Performs word-level diff between two strings, ensuring only complete words are matched.
 * Tokenizes input strings by splitting on whitespace while preserving whitespace as separate tokens,
 * then uses diffArrays to compare the token arrays.
 * @param original - The original string to compare
 * @param modified - The modified string to compare against
 * @returns Array of diff parts with value, added, and removed flags
 */
function wordLevelDiff(
  original: string,
  modified: string
): { value: string; added?: boolean; removed?: boolean }[] {
  // Split into words while preserving whitespace as separate tokens
  const tokenize = (str: string): string[] => {
    const tokens: string[] = [];
    let current = "";
    for (const char of str) {
      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        tokens.push(char);
      } else {
        current += char;
      }
    }
    if (current) {
      tokens.push(current);
    }
    return tokens;
  };

  const originalTokens = tokenize(original);
  const modifiedTokens = tokenize(modified);

  const diff = diffArrays(originalTokens, modifiedTokens);

  // Convert back to string-based diff result
  return diff.map((part) => ({
    value: part.value.join(""),
    added: part.added,
    removed: part.removed,
  }));
}
import { Check, X as XIcon } from "lucide-react";
import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React, { useRef, memo } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../ui/button";
import { SettingSwitch } from "../ui/setting-switch";
import { useState } from "react";
import { getChangeBlocks } from "@/composerUtils";
import { ApplyViewResult } from "@/types";
import { ensureFolderExists } from "@/utils";

export const APPLY_VIEW_TYPE = "obsidian-copilot-apply-view";

export interface ApplyViewState {
  changes: Change[];
  path: string;
  resultCallback?: (result: ApplyViewResult) => void;
}

// Extended Change interface to track user acceptance
interface ExtendedChange extends Change {
  accepted: boolean | null;
}

export class ApplyView extends ItemView {
  private root: ReturnType<typeof createRoot> | null = null;
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

    // The second child is the actual content of the view, and the first child is the title of the view
    // NOTE: While no official documentation is found, this seems like a standard pattern across community plugins.
    const contentEl = this.containerEl.children[1];
    contentEl.empty();

    const rootEl = contentEl.createDiv();
    if (!this.root) {
      this.root = createRoot(rootEl);
    }

    // Pass a close function that takes a result
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

// Side-by-side block component for comparing original and modified content
interface SideBySideBlockProps {
  block: Change[];
}

const SideBySideBlock = memo(({ block }: SideBySideBlockProps) => {
  // Split multi-line chunks into individual lines and pair them for line-by-line comparison
  // This enables proper word-level diffing within each line
  const rows: { original: string | null; modified: string | null; isUnchanged: boolean }[] = [];

  let i = 0;
  while (i < block.length) {
    const current = block[i];

    if (!current.added && !current.removed) {
      // Unchanged chunk - split into lines and show on both sides
      const lines = current.value
        .split("\n")
        .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
      lines.forEach((line) => {
        rows.push({ original: line, modified: line, isUnchanged: true });
      });
      i++;
    } else if (current.removed) {
      // Check if next item is an added chunk (replacement pair)
      const next = block[i + 1];
      if (next?.added) {
        // Split both chunks into lines and pair by index
        const originalLines = current.value
          .split("\n")
          .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
        const modifiedLines = next.value
          .split("\n")
          .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
        const maxLines = Math.max(originalLines.length, modifiedLines.length);

        for (let j = 0; j < maxLines; j++) {
          rows.push({
            original: j < originalLines.length ? originalLines[j] : null,
            modified: j < modifiedLines.length ? modifiedLines[j] : null,
            isUnchanged: false,
          });
        }
        i += 2;
      } else {
        // Standalone removal - split into lines
        const lines = current.value
          .split("\n")
          .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
        lines.forEach((line) => {
          rows.push({ original: line, modified: null, isUnchanged: false });
        });
        i++;
      }
    } else if (current.added) {
      // Standalone addition - split into lines
      const lines = current.value
        .split("\n")
        .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
      lines.forEach((line) => {
        rows.push({ original: null, modified: line, isUnchanged: false });
      });
      i++;
    } else {
      i++;
    }
  }

  return (
    <div className="tw-grid tw-grid-cols-2 tw-gap-2">
      {/* Original (left) column */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, idx) => (
          <div key={idx} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            {row.original !== null ? (
              row.isUnchanged ? (
                // Unchanged line
                <span className="tw-text-normal">{row.original || "\u00A0"}</span>
              ) : row.modified !== null ? (
                // Show word-level diff - only changed words are highlighted
                <span>
                  {wordLevelDiff(row.original, row.modified).map((part, partIdx) => {
                    if (part.removed) {
                      return (
                        <span key={partIdx} className="tw-bg-error tw-text-error">
                          {part.value}
                        </span>
                      );
                    }
                    if (part.added) {
                      return null; // Don't show added parts in original column
                    }
                    return <span key={partIdx}>{part.value}</span>;
                  })}
                </span>
              ) : (
                // Only removed, no pair - highlight entire line
                <span className="tw-bg-error tw-text-error">{row.original || "\u00A0"}</span>
              )
            ) : (
              // Empty placeholder for alignment
              <span className="tw-text-muted">&nbsp;</span>
            )}
          </div>
        ))}
      </div>

      {/* Modified (right) column */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        {rows.map((row, idx) => (
          <div key={idx} className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">
            {row.modified !== null ? (
              row.isUnchanged ? (
                // Unchanged line
                <span className="tw-text-normal">{row.modified || "\u00A0"}</span>
              ) : row.original !== null ? (
                // Show word-level diff - only changed words are highlighted
                <span>
                  {wordLevelDiff(row.original, row.modified).map((part, partIdx) => {
                    if (part.added) {
                      return (
                        <span key={partIdx} className="tw-bg-success tw-text-success">
                          {part.value}
                        </span>
                      );
                    }
                    if (part.removed) {
                      return null; // Don't show removed parts in modified column
                    }
                    return <span key={partIdx}>{part.value}</span>;
                  })}
                </span>
              ) : (
                // Only added, no pair - highlight entire line
                <span className="tw-bg-success tw-text-success">{row.modified || "\u00A0"}</span>
              )
            ) : (
              // Empty placeholder for alignment
              <span className="tw-text-muted">&nbsp;</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

SideBySideBlock.displayName = "SideBySideBlock";

// Split block component - shows old and new content separately with highlighting
interface SplitBlockProps {
  block: Change[];
}

const SplitBlock = memo(({ block }: SplitBlockProps) => {
  // Check if there are any changes
  const hasChanges = block.some((c) => c.added || c.removed);

  if (!hasChanges) {
    // No changes - just show the content once
    return (
      <div className="tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
        {block.map((change, idx) => (
          <span key={idx}>{change.value}</span>
        ))}
      </div>
    );
  }

  // Split multi-line chunks into individual lines and pair them for line-by-line comparison
  const rows: { original: string | null; modified: string | null; isUnchanged: boolean }[] = [];
  let i = 0;
  while (i < block.length) {
    const current = block[i];
    if (!current.added && !current.removed) {
      // Unchanged chunk - split into lines
      const lines = current.value
        .split("\n")
        .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
      lines.forEach((line) => {
        rows.push({ original: line, modified: line, isUnchanged: true });
      });
      i++;
    } else if (current.removed) {
      const next = block[i + 1];
      if (next?.added) {
        // Split both chunks into lines and pair by index
        const originalLines = current.value
          .split("\n")
          .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
        const modifiedLines = next.value
          .split("\n")
          .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
        const maxLines = Math.max(originalLines.length, modifiedLines.length);

        for (let j = 0; j < maxLines; j++) {
          rows.push({
            original: j < originalLines.length ? originalLines[j] : null,
            modified: j < modifiedLines.length ? modifiedLines[j] : null,
            isUnchanged: false,
          });
        }
        i += 2;
      } else {
        // Standalone removal - split into lines
        const lines = current.value
          .split("\n")
          .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
        lines.forEach((line) => {
          rows.push({ original: line, modified: null, isUnchanged: false });
        });
        i++;
      }
    } else if (current.added) {
      // Standalone addition - split into lines
      const lines = current.value
        .split("\n")
        .filter((_, idx, arr) => idx < arr.length - 1 || _ !== "");
      lines.forEach((line) => {
        rows.push({ original: null, modified: line, isUnchanged: false });
      });
      i++;
    } else {
      i++;
    }
  }

  // Render original section with word-level highlighting
  const renderOriginal = () => {
    return rows.map((row, idx) => {
      if (row.original === null) return null; // Skip if no original (pure addition)

      // Unchanged line
      if (row.isUnchanged) {
        return (
          <div key={idx} className="tw-text-normal">
            {row.original || "\u00A0"}
          </div>
        );
      }

      // Paired with modified - do word-level diff
      if (row.modified !== null) {
        const wordDiff = wordLevelDiff(row.original, row.modified);
        return (
          <div key={idx}>
            {wordDiff.map((part, partIdx) => {
              if (part.added) return null; // Skip added parts in original
              if (part.removed) {
                return (
                  <span key={partIdx} className="tw-bg-error tw-text-error">
                    {part.value}
                  </span>
                );
              }
              return <span key={partIdx}>{part.value}</span>;
            })}
          </div>
        );
      }

      // Standalone removal - highlight entire line
      return (
        <div key={idx} className="tw-bg-error tw-text-error">
          {row.original || "\u00A0"}
        </div>
      );
    });
  };

  // Render modified section with word-level highlighting
  const renderModified = () => {
    return rows.map((row, idx) => {
      if (row.modified === null) return null; // Skip if no modified (pure removal)

      // Unchanged line
      if (row.isUnchanged) {
        return (
          <div key={idx} className="tw-text-normal">
            {row.modified || "\u00A0"}
          </div>
        );
      }

      // Paired with original - do word-level diff
      if (row.original !== null) {
        const wordDiff = wordLevelDiff(row.original, row.modified);
        return (
          <div key={idx}>
            {wordDiff.map((part, partIdx) => {
              if (part.removed) return null; // Skip removed parts in modified
              if (part.added) {
                return (
                  <span key={partIdx} className="tw-bg-success tw-text-success">
                    {part.value}
                  </span>
                );
              }
              return <span key={partIdx}>{part.value}</span>;
            })}
          </div>
        );
      }

      // Standalone addition - highlight entire line
      return (
        <div key={idx} className="tw-bg-success tw-text-success">
          {row.modified || "\u00A0"}
        </div>
      );
    });
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {/* Original version with word-level removed parts highlighted */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        <div className="tw-mb-1 tw-text-xs tw-font-medium tw-text-muted">Original</div>
        <div className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">{renderOriginal()}</div>
      </div>

      {/* Modified version with word-level added parts highlighted */}
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2">
        <div className="tw-mb-1 tw-text-xs tw-font-medium tw-text-muted">Modified</div>
        <div className="tw-whitespace-pre-wrap tw-font-mono tw-text-sm">{renderModified()}</div>
      </div>
    </div>
  );
});

SplitBlock.displayName = "SplitBlock";

const ApplyViewRoot: React.FC<ApplyViewRootProps> = ({ app, state, close }) => {
  const [diff, setDiff] = useState<ExtendedChange[]>(() => {
    return state.changes.map((change) => ({
      ...change,
      accepted: null, // Start with null (undecided)
    }));
  });

  // View mode state with settings persistence (fallback to "split" for users with old settings)
  const [viewMode, setViewMode] = useState<"side-by-side" | "split">(
    () => getSettings().diffViewMode ?? "split"
  );

  const handleViewModeChange = (mode: "side-by-side" | "split") => {
    setViewMode(mode);
    updateSetting("diffViewMode", mode);
  };

  // Group changes into blocks for better UI presentation
  const changeBlocks = getChangeBlocks(diff);

  // Add refs to track change blocks
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Add defensive check for state after hooks
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

  // Apply all changes regardless of whether they have been marked as accepted
  const handleAccept = async () => {
    try {
      // Mark all undecided changes as accepted
      const updatedDiff = diff.map((change) =>
        change.accepted === null ? { ...change, accepted: true } : change
      );

      const result = await applyDecidedChangesToFile(updatedDiff);
      close(result ? "accepted" : "failed"); // Pass result
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(`Error applying changes: ${error.message}`);
      close("failed"); // fallback, but you may want to handle this differently
    }
  };

  // Handle rejecting all changes
  const handleReject = async () => {
    try {
      // Mark all undecided changes as rejected
      const updatedDiff = diff.map((change) =>
        change.accepted === null ? { ...change, accepted: false } : change
      );

      const result = await applyDecidedChangesToFile(updatedDiff);
      close(result ? "rejected" : "failed"); // Pass result
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(`Error applying changes: ${error.message}`);
      close("failed");
    }
  };

  const getFile = async (file_path: string) => {
    const file = app.vault.getAbstractFileByPath(file_path);
    if (file) {
      return file;
    }
    // Create the folder if it doesn't exist (supports nested paths)
    if (file_path.includes("/")) {
      const folderPath = file_path.split("/").slice(0, -1).join("/");
      await ensureFolderExists(folderPath);
    }
    return await app.vault.create(file_path, "");
  };

  // Shared function to apply changes to file
  const applyDecidedChangesToFile = async (updatedDiff: ExtendedChange[]) => {
    // Apply changes based on their accepted status
    const newContent = updatedDiff
      .filter((change) => {
        if (change.added) return change.accepted === true; // Include if accepted
        if (change.removed) return change.accepted === false; // Include if rejected
        return true; // Keep unchanged lines
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
    new Notice("Changes applied successfully");
    return true;
  };

  // Function to focus on the next change block or scroll to top if it's the last block
  const focusNextChangeBlock = (currentBlockIndex: number) => {
    if (!changeBlocks) return;

    // Find the next block with changes that is undecided
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

    // If there's a next block, scroll to it
    if (nextBlockIndex !== -1 && blockRefs.current[nextBlockIndex]) {
      blockRefs.current[nextBlockIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // Accept a block of changes
  const acceptBlock = (blockIndex: number) => {
    setDiff((prevDiff) => {
      const newDiff = [...prevDiff];
      const block = changeBlocks?.[blockIndex];

      if (!block) return newDiff;

      // Find the indices of the changes in this block
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

    // Focus on the next change block after state update
    setTimeout(() => focusNextChangeBlock(blockIndex), 0);
  };

  // Reject a block of changes
  const rejectBlock = (blockIndex: number) => {
    setDiff((prevDiff) => {
      const newDiff = [...prevDiff];
      const block = changeBlocks?.[blockIndex];

      if (!block) return newDiff;

      // Find the indices of the changes in this block
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

    // Focus on the next change block after state update
    setTimeout(() => focusNextChangeBlock(blockIndex), 0);
  };

  return (
    <div className="tw-relative tw-flex tw-h-full tw-flex-col">
      <div className="tw-fixed tw-bottom-4 tw-left-1/2 tw-z-[9999] tw-flex tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2 tw-shadow-lg">
        <Button variant="destructive" size="sm" onClick={handleReject}>
          <XIcon className="tw-size-4" />
          Reject
        </Button>
        <Button variant="success" size="sm" onClick={handleAccept}>
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
          // Check if this block contains any changes (added or removed)
          const hasChanges = block.some((change) => change.added || change.removed);

          // Get the result status for this block
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
              key={blockIndex}
              ref={(el) => (blockRefs.current[blockIndex] = el)}
              className={cn("tw-mb-4 tw-overflow-hidden tw-rounded-md")}
            >
              {blockStatus === "accepted" ? (
                // Show only the accepted version
                <div className="tw-flex-1 tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
                  {block
                    .filter((change) => !change.removed)
                    .map((change, idx) => (
                      <div key={idx}>{change.value}</div>
                    ))}
                </div>
              ) : blockStatus === "rejected" ? (
                // Show only the original version
                <div className="tw-flex-1 tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
                  {block
                    .filter((change) => !change.added)
                    .map((change, idx) => (
                      <div key={idx}>{change.value}</div>
                    ))}
                </div>
              ) : viewMode === "side-by-side" ? (
                // Side-by-side view
                <SideBySideBlock block={block} />
              ) : (
                // Split view (default) - old and new shown separately
                <SplitBlock block={block} />
              )}

              {/* Only show accept/reject buttons for blocks with changes that are undecided */}
              {hasChanges && blockStatus === "undecided" && (
                <div className="tw-flex tw-items-center tw-justify-end tw-border-[0px] tw-border-t tw-border-solid tw-border-border tw-p-2">
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

              {/* Show status for decided blocks with revert option */}
              {hasChanges && (blockStatus === "accepted" || blockStatus === "rejected") && (
                <div className="tw-flex tw-items-center tw-justify-end tw-border-[0px] tw-border-t tw-border-solid tw-border-border tw-p-2">
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
                        // Reset the block to undecided state
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
