import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { Change } from "diff";
import { Check, X as XIcon } from "lucide-react";
import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React, { useRef } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../ui/button";
import { Composer } from "@/LLMProviders/composer";
import { useState } from "react";

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
  const [diff, setDiff] = useState<ExtendedChange[]>(() => {
    return state.changes.map((change) => ({
      ...change,
      accepted: null, // Start with null (undecided)
    }));
  });

  // Group changes into blocks for better UI presentation
  const changeBlocks = Composer.getChangeBlocks(diff);

  // Add refs to track change blocks
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Add defensive check for state after hooks
  if (!state || !state.changes) {
    logError("Invalid state:", state);
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="text-error">Error: Invalid state - missing changes</div>
        <Button onClick={close} className="mt-4">
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
    <div className="flex flex-col h-full relative">
      <div className="flex z-[1] gap-2 fixed bottom-2 left-1/2 -translate-x-1/2 p-2 border border-solid border-border rounded-md bg-secondary">
        <Button variant="destructive" size="sm" onClick={handleReject}>
          <XIcon className="size-4" />
          Reject
        </Button>
        <Button variant="success" size="sm" onClick={handleAccept}>
          <Check className="size-4" />
          Accept
        </Button>
      </div>
      <div className="flex items-center p-2 border-[0px] border-solid border-b border-border text-sm font-medium">
        {state.path}
      </div>

      <div className="flex-1 overflow-auto p-2">
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
