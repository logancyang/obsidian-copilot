import React, { useState, useEffect } from "react";
import { App, ItemView, TFile, WorkspaceLeaf, Notice } from "obsidian";
import { createRoot } from "react-dom/client";
import { diffLines, Change } from "diff";
import { Button } from "../ui/button";
import { Check, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const APPLY_VIEW_TYPE = "obsidian-copilot-apply-view";

export interface ApplyViewState {
  file: TFile;
  originalContent: string;
  newContent: string;
  path?: string;
}

// Extended Change interface to track user decisions
interface ExtendedChange extends Change {
  accepted?: boolean;
  rejected?: boolean;
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
      accepted: true,
      rejected: false,
    }));
  });

  // Group changes into blocks for better UI presentation
  const [changeBlocks, setChangeBlocks] = useState<ExtendedChange[][]>([]);

  // Process diff into blocks of related changes
  useEffect(() => {
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

    setChangeBlocks(blocks);
  }, [diff]);

  // Add defensive check for state after hooks
  if (!state || !state.originalContent || !state.newContent) {
    console.error("Invalid state:", state);
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="text-error">Error: Invalid state - missing content</div>
        <Button onClick={close} className="mt-4">
          Close
        </Button>
      </div>
    );
  }

  // Handle accepting all changes that have been marked as accepted
  const handleAccept = async () => {
    try {
      const newContent = diff
        .filter((change) => {
          if (change.added) return change.accepted;
          else if (change.removed) return !change.accepted;
          return true; // Unchanged lines are always included
        })
        .map((change) => change.value)
        .join("");

      await app.vault.modify(state.file, newContent);
      new Notice("Changes applied successfully");
      close();
    } catch (error) {
      console.error("Error applying changes:", error);
      new Notice(`Error applying changes: ${error.message}`);
    }
  };

  // Handle rejecting all changes
  const handleReject = () => {
    close();
  };

  // Accept a block of changes
  const acceptBlock = (blockIndex: number) => {
    setDiff((prevDiff) => {
      const newDiff = [...prevDiff];
      const block = changeBlocks[blockIndex];

      // Find the indices of the changes in this block
      block.forEach((blockChange) => {
        const index = newDiff.findIndex((change) => change === blockChange);
        if (index !== -1) {
          newDiff[index] = {
            ...newDiff[index],
            accepted: true,
            rejected: false,
          };
        }
      });

      return newDiff;
    });
  };

  // Reject a block of changes
  const rejectBlock = (blockIndex: number) => {
    setDiff((prevDiff) => {
      const newDiff = [...prevDiff];
      const block = changeBlocks[blockIndex];

      // Find the indices of the changes in this block
      block.forEach((blockChange) => {
        const index = newDiff.findIndex((change) => change === blockChange);
        if (index !== -1) {
          newDiff[index] = {
            ...newDiff[index],
            accepted: false,
            rejected: true,
          };
        }
      });

      return newDiff;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center p-2 border-b border-border">
        <div className="flex items-center">
          <h3 className="m-0 text-sm font-medium">
            Apply Changes to {state.path || state.file.path}
          </h3>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleReject}>
            <XIcon className="mr-1 h-3 w-3" />
            Reject All
          </Button>
          <Button size="sm" onClick={handleAccept}>
            <Check className="mr-1 h-3 w-3" />
            Apply Changes
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {changeBlocks.map((block, blockIndex) => {
          // Check if this block contains any changes (added or removed)
          const hasChanges = block.some((change) => change.added || change.removed);

          // Check if all changes in this block are accepted or rejected
          const isAccepted = hasChanges && block.every((change) => change.accepted);
          const isRejected = hasChanges && block.every((change) => change.rejected);

          return (
            <div
              key={blockIndex}
              className={cn(
                "mb-4 border rounded-md overflow-hidden transition-colors duration-200",
                {
                  "border-green shadow-[0_0_5px_rgba(var(--color-green-rgb),0.2)]": isAccepted,
                  "border-red shadow-[0_0_5px_rgba(var(--color-red-rgb),0.2)]": isRejected,
                }
              )}
            >
              {block.map((change, changeIndex) => (
                <div
                  key={`${blockIndex}-${changeIndex}`}
                  className={cn("flex relative border-l-3", {
                    "bg-modifier-success border-l-green": change.added,
                    "bg-modifier-error border-l-red": change.removed,
                    "opacity-50": !change.accepted,
                  })}
                >
                  <div className="w-6 flex-shrink-0 flex items-center justify-center text-sm font-bold bg-background-secondary-alt">
                    {change.added && "+"}
                    {change.removed && "-"}
                  </div>
                  <div className="flex-1 font-mono text-sm whitespace-pre-wrap py-1 px-2 text-text-normal">
                    {change.value}
                  </div>
                </div>
              ))}

              {/* Only show accept/reject buttons for blocks with changes */}
              {hasChanges && (
                <div className="flex justify-end p-2 bg-background-secondary-alt border-t border-border gap-2">
                  <Button variant="secondary" size="sm" onClick={() => rejectBlock(blockIndex)}>
                    <XIcon className="h-4 w-4" />
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => acceptBlock(blockIndex)}>
                    <Check className="h-4 w-4" />
                    Accept
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
