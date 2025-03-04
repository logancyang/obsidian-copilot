import React, { useState, useEffect } from "react";
import { App, ItemView, TFile, WorkspaceLeaf, Notice } from "obsidian";
import { createRoot } from "react-dom/client";
import { diffLines, Change } from "diff";
import { Button } from "./ui/button";
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

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("apply-view-container");

    const rootEl = container.createDiv();
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
      accepted: false,
      rejected: false,
    }));
  });

  // Group changes into blocks for better UI presentation
  const [changeBlocks, setChangeBlocks] = useState<ExtendedChange[][]>([]);

  // Calculate summary statistics
  const [summary, setSummary] = useState({
    totalChanges: 0,
    additions: 0,
    deletions: 0,
    accepted: 0,
    rejected: 0,
  });

  // Update summary when diff changes
  useEffect(() => {
    if (!diff.length) return;

    const additions = diff.filter((change) => change.added).length;
    const deletions = diff.filter((change) => change.removed).length;
    const accepted = diff.filter((change) => change.accepted).length;
    const rejected = diff.filter((change) => change.rejected).length;

    setSummary({
      totalChanges: additions + deletions,
      additions,
      deletions,
      accepted,
      rejected,
    });
  }, [diff]);

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
      // Filter out rejected changes and properly handle accepted removals
      const newContent = diff
        .filter((change) => {
          // Keep changes that are not rejected
          if (change.rejected) return false;

          // For removed changes, we want to exclude them when accepted
          // (since accepting a removal means we want to remove that content)
          if (change.removed) return !change.accepted;

          // For added changes, we want to include them when accepted
          if (change.added) return change.accepted;

          // Keep unchanged content
          return true;
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
          <h3 className="m-0 text-lg font-medium">
            Apply Changes to {state.path || state.file.path}
          </h3>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleReject}>
            <XIcon className="mr-1 h-4 w-4" />
            Reject All
          </Button>
          <Button onClick={handleAccept}>
            <Check className="mr-1 h-4 w-4" />
            Apply Accepted Changes
          </Button>
        </div>
      </div>

      {/* Summary section */}
      <div className="p-2 border-b border-border bg-background-secondary-alt">
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center">
            <span className="font-medium mr-1">Changes:</span> {summary.totalChanges}
          </div>
          <div className="flex items-center">
            <span className="text-green-600 mr-1">+{summary.additions}</span> additions
          </div>
          <div className="flex items-center">
            <span className="text-red-600 mr-1">-{summary.deletions}</span> deletions
          </div>
          <div className="flex items-center">
            <span className="font-medium mr-1">Status:</span>
            <span className="text-green-600 mr-1">{summary.accepted}</span> accepted,
            <span className="text-red-600 ml-1 mr-1">{summary.rejected}</span> rejected
          </div>
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
                  "border-green-500 shadow-[0_0_5px_rgba(0,128,0,0.2)]": isAccepted,
                  "border-red-500 shadow-[0_0_5px_rgba(255,0,0,0.2)]": isRejected,
                  "border-gray-300": !isAccepted && !isRejected,
                }
              )}
            >
              {block.map((change, changeIndex) => (
                <div
                  key={`${blockIndex}-${changeIndex}`}
                  className={cn("flex relative border-l-3", {
                    "bg-green-500/20 border-l-green-500": change.added,
                    "bg-red-500/20 border-l-red-500": change.removed,
                    "opacity-50":
                      (change.added && change.rejected) || (change.removed && !change.accepted),
                  })}
                >
                  <div className="w-6 flex-shrink-0 flex items-center justify-center text-sm font-bold bg-black/5">
                    {change.added && "+"}
                    {change.removed && "-"}
                  </div>
                  <div className="flex-1 font-mono text-sm whitespace-pre-wrap py-1 px-2">
                    {change.value}
                  </div>
                </div>
              ))}

              {/* Only show accept/reject buttons for blocks with changes */}
              {hasChanges && (
                <div className="flex justify-end p-2 bg-background-secondary-alt border-t border-border gap-2">
                  <button
                    onClick={() => rejectBlock(blockIndex)}
                    className={cn(
                      "flex items-center px-2 py-1 rounded text-white transition-colors duration-200",
                      isRejected
                        ? "bg-red-800 border-2 border-red-500"
                        : "bg-red-700 hover:bg-red-800"
                    )}
                  >
                    <XIcon className="mr-1 h-4 w-4" />
                    Reject
                  </button>
                  <button
                    onClick={() => acceptBlock(blockIndex)}
                    className={cn(
                      "flex items-center px-2 py-1 rounded text-white transition-colors duration-200",
                      isAccepted
                        ? "bg-green-800 border-2 border-green-500"
                        : "bg-green-700 hover:bg-green-800"
                    )}
                  >
                    <Check className="mr-1 h-4 w-4" />
                    Accept
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
