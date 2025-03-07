import { ApplyChangesConfirmModal } from "@/components/modals/ApplyChangesConfirmModal";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { Change, diffLines } from "diff";
import { Check, X as XIcon } from "lucide-react";
import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../ui/button";

export const APPLY_VIEW_TYPE = "obsidian-copilot-apply-view";

export interface ApplyViewState {
  file: TFile;
  originalContent: string;
  newContent: string;
  path?: string;
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
    return "Apply Changes";
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

const ApplyViewRoot: React.FC<ApplyViewRootProps> = ({ app, state, close }) => {
  // Initialize diff with extended properties - moved before conditional
  const [diff, setDiff] = useState<ExtendedChange[]>(() => {
    if (!state?.originalContent || !state?.newContent) {
      return [];
    }
    const initialDiff = diffLines(state.originalContent, state.newContent);
    return initialDiff.map((change) => ({
      ...change,
      accepted: null, // Start with null (undecided)
    }));
  });

  const undecidedChanges = diff.filter(
    (change) => (change.added || change.removed) && change.accepted === null
  );
  const hasAnyDecidedChanges = diff.some((change) => change.accepted !== null);

  // Group changes into blocks for better UI presentation
  const changeBlocks = useMemo(() => {
    if (!diff.length) return;

    const blocks: ExtendedChange[][] = [];
    let currentBlock: ExtendedChange[] = [];
    let inChangeBlock = false;

    diff.forEach((change) => {
      if (change.added || change.removed) {
        if (!inChangeBlock) {
          inChangeBlock = true;
          currentBlock = [];
        }
        currentBlock.push(change);
      } else {
        if (inChangeBlock) {
          blocks.push([...currentBlock]);
          currentBlock = [];
          inChangeBlock = false;
        }
        blocks.push([change]);
      }
    });

    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    return blocks;
  }, [diff]);

  // Add refs to track change blocks
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Add defensive check for state after hooks
  if (!state || !state.originalContent || !state.newContent) {
    logError("Invalid state:", state);
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="text-error">Error: Invalid state - missing content</div>
        <Button onClick={close} className="mt-4">
          Close
        </Button>
      </div>
    );
  }

  // Handle applying changes that have been marked as accepted
  const handleApply = async () => {
    try {
      const applyChanges = async () => {
        const newContent = diff
          .filter((change) => {
            if (change.added) return change.accepted === true;
            else if (change.removed) return change.accepted === false;
            return true; // Unchanged lines are always included
          })
          .map((change) => change.value)
          .join("");

        await app.vault.modify(state.file, newContent);
        new Notice("Changes applied successfully");
        close();
      };

      if (undecidedChanges.length > 0) {
        // Divide by 2 because each change has a pair of added and removed lines
        const modal = new ApplyChangesConfirmModal(app, undecidedChanges.length / 2, () => {
          applyChanges();
        });
        modal.open();
        return;
      }

      applyChanges();
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(`Error applying changes: ${error.message}`);
    }
  };

  // Apply all changes regardless of whether they have been marked as accepted
  const handleAcceptAll = async () => {
    try {
      const newContent = diff
        .filter((change) => {
          return change.added || !change.removed;
        })
        .map((change) => change.value)
        .join("");
      await app.vault.modify(state.file, newContent);
      new Notice("Changes applied successfully");
      close();
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(`Error applying changes: ${error.message}`);
    }
  };

  // Handle rejecting all changes
  const handleReject = () => {
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
        (change) => (change.added || change.removed) && change.accepted === null
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
    <div className="flex flex-col h-full relative">
      <div className="flex z-[1] gap-2 fixed bottom-2 left-1/2 -translate-x-1/2 p-2 border border-solid border-border rounded-md bg-secondary">
        <Button variant="destructive" size="sm" onClick={handleReject}>
          <XIcon className="size-4" />
          Reject All
        </Button>
        <Button variant="success" size="sm" onClick={handleAcceptAll}>
          <Check className="size-4" />
          Accept All
        </Button>
        <Button
          disabled={!hasAnyDecidedChanges}
          variant="secondary"
          size="sm"
          onClick={handleApply}
        >
          Apply Changes
        </Button>
      </div>
      <div className="flex items-center p-2 border-[0px] border-solid border-b border-border text-sm font-medium">
        {state.path || state.file.path}
      </div>

      <div className="flex-1 overflow-auto p-2">
        {changeBlocks?.map((block, blockIndex) => {
          // Check if this block contains any changes (added or removed)
          const hasChanges = block.some((change) => change.added || change.removed);

          // Get the decision status for this block
          const blockStatus = hasChanges
            ? block.every(
                (change) => (!change.added && !change.removed) || change.accepted === true
              )
              ? "accepted"
              : block.every(
                    (change) => (!change.added && !change.removed) || change.accepted === false
                  )
                ? "rejected"
                : "undecided"
            : "unchanged";

          return (
            <div
              key={blockIndex}
              ref={(el) => (blockRefs.current[blockIndex] = el)}
              className={cn("mb-4 border rounded-md overflow-hidden border-border", {
                "border-solid": blockStatus !== "unchanged",
              })}
            >
              {blockStatus === "accepted" ? (
                // Show only the accepted version
                <div className="flex-1 font-mono text-sm whitespace-pre-wrap py-1 px-2 text-text-normal">
                  {block
                    .filter((change) => !change.removed)
                    .map((change, idx) => (
                      <div key={idx}>{change.value}</div>
                    ))}
                </div>
              ) : blockStatus === "rejected" ? (
                // Show only the original version
                <div className="flex-1 font-mono text-sm whitespace-pre-wrap py-1 px-2 text-text-normal">
                  {block
                    .filter((change) => !change.added)
                    .map((change, idx) => (
                      <div key={idx}>{change.value}</div>
                    ))}
                </div>
              ) : (
                // Show the diff view for undecided blocks
                block.map((change, changeIndex) => (
                  <div
                    key={`${blockIndex}-${changeIndex}`}
                    className={cn("flex relative border-l-3", {
                      "bg-success border-l-green": change.added,
                      "bg-error border-l-red": change.removed,
                    })}
                  >
                    <div className="flex-1 font-mono text-sm whitespace-pre-wrap py-1 px-2 text-text-normal">
                      {change.value}
                    </div>
                  </div>
                ))
              )}

              {/* Only show accept/reject buttons for blocks with changes that are undecided */}
              {hasChanges && blockStatus === "undecided" && (
                <div className="flex items-center justify-end p-2 border-[0px] border-solid border-t border-border">
                  <div className="flex items-center gap-2">
                    <Button variant="destructive" size="sm" onClick={() => rejectBlock(blockIndex)}>
                      <XIcon className="size-4" />
                      Reject
                    </Button>
                    <Button variant="success" size="sm" onClick={() => acceptBlock(blockIndex)}>
                      <Check className="size-4" />
                      Accept
                    </Button>
                  </div>
                </div>
              )}

              {/* Show status for decided blocks with revert option */}
              {hasChanges && (blockStatus === "accepted" || blockStatus === "rejected") && (
                <div className="flex items-center justify-end p-2 border-[0px] border-solid border-t border-border">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium mr-2">
                      {blockStatus === "accepted" ? (
                        <div className="flex items-center gap-1 text-success">
                          <Check className="size-4" />
                          <div>Accepted</div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-error">
                          <XIcon className="size-4" />
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
