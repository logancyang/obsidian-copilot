import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { Change, diffWords } from "diff";
import { Check, X as XIcon } from "lucide-react";
import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React, { useRef, memo } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../ui/button";
import { useState } from "react";
import { getChangeBlocks } from "@/composerUtils";

export const APPLY_VIEW_TYPE = "obsidian-copilot-apply-view";

export interface ApplyViewState {
  changes: Change[];
  path: string;
}

// Extended Change interface to track user decisions
interface ExtendedChange extends Change {
  accepted: boolean | null;
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

    this.root.render(
      <ApplyViewRoot app={this.app} state={this.state} close={() => this.leaf.detach()} />
    );
  }
}

interface ApplyViewRootProps {
  app: App;
  state: ApplyViewState;
  close: () => void;
}

// Convert renderWordDiff to a React component
const WordDiff = memo(({ oldLine, newLine }: { oldLine: string; newLine: string }) => {
  const wordDiff = diffWords(oldLine, newLine);
  return (
    <>
      {wordDiff.map((part, idx) => {
        if (part.added) {
          return (
            <span key={idx} className="tw-text-success">
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span key={idx} className="tw-text-error tw-line-through">
              {part.value}
            </span>
          );
        }
        return <span key={idx}>{part.value}</span>;
      })}
    </>
  );
});

WordDiff.displayName = "WordDiff";

const ApplyViewRoot: React.FC<ApplyViewRootProps> = ({ app, state, close }) => {
  const [diff, setDiff] = useState<ExtendedChange[]>(() => {
    return state.changes.map((change) => ({
      ...change,
      accepted: null, // Start with null (undecided)
    }));
  });

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
        <Button onClick={close} className="tw-mt-4">
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

      await applyDecidedChangesToFile(updatedDiff);
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(`Error applying changes: ${error.message}`);
    }
  };

  // Handle rejecting all changes
  const handleReject = async () => {
    try {
      // Mark all undecided changes as rejected
      const updatedDiff = diff.map((change) =>
        change.accepted === null ? { ...change, accepted: false } : change
      );

      await applyDecidedChangesToFile(updatedDiff);
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(`Error applying changes: ${error.message}`);
    }
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

    const file = app.vault.getAbstractFileByPath(state.path);
    if (!file || !(file instanceof TFile)) {
      new Notice("File not found:" + state.path);
      close();
      return;
    }

    await app.vault.modify(file, newContent);
    new Notice("Changes applied successfully");
    close();
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
      <div className="tw-fixed tw-bottom-2 tw-left-1/2 tw-z-[1] tw-flex tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2">
        <Button variant="destructive" size="sm" onClick={handleReject}>
          <XIcon className="tw-size-4" />
          Reject
        </Button>
        <Button variant="success" size="sm" onClick={handleAccept}>
          <Check className="tw-size-4" />
          Accept
        </Button>
      </div>
      <div className="tw-flex tw-items-center tw-border-b tw-border-solid tw-border-border tw-p-2 tw-text-sm tw-font-medium">
        {state.path}
      </div>

      <div className="tw-flex-1 tw-overflow-auto tw-p-2">
        {changeBlocks?.map((block, blockIndex) => {
          // Check if this block contains any changes (added or removed)
          const hasChanges = block.some((change) => change.added || change.removed);

          // Get the decision status for this block
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
              ) : (
                // Render the block
                block.map((change, changeIndex) => {
                  // Try to find a corresponding added/removed pair for word-level diff
                  if (change.added) {
                    const removedIdx = block.findIndex((c, i) => c.removed && i !== changeIndex);
                    if (removedIdx !== -1) {
                      const removedLine = block[removedIdx].value;
                      return (
                        <div key={`${blockIndex}-${changeIndex}`} className="tw-relative">
                          <div className="tw-flex-1 tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm">
                            <WordDiff oldLine={removedLine} newLine={change.value} />
                          </div>
                        </div>
                      );
                    }
                  }
                  // Skip rendering removed line if it is already paired with an added line.
                  if (change.removed) {
                    const addedIdx = block.findIndex((c, i) => c.added && i !== changeIndex);
                    if (addedIdx !== -1) {
                      // Skip rendering removed line, since it's shown in the added line
                      return null;
                    }
                  }
                  // No pair found, render the line as is.
                  return (
                    <div key={`${blockIndex}-${changeIndex}`} className="tw-relative">
                      <div
                        className={cn(
                          "tw-flex-1 tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm",
                          {
                            "tw-text-success": change.added,
                            "tw-text-error": change.removed,
                            "tw-text-normal": !change.added && !change.removed,
                            "tw-line-through": change.removed,
                          }
                        )}
                      >
                        {change.value}
                      </div>
                    </div>
                  );
                })
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
