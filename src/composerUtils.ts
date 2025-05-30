import { Change } from "diff";

function strikeThrough(content: string): string {
  const lines = content.trim().split("\n");
  return lines.map((line) => "- " + line).join("\n");
}

// Get relevant changes only and combine them into a single markdown block
export function getRelevantChangesMarkdown(blocks: Change[][]): string {
  const renderedChanges = blocks
    .map((block) => {
      const hasAddedChanges = block.some((change) => change.added);
      const hasRemovedChanges = block.some((change) => change.removed);
      let blockChange = "";
      if (hasAddedChanges) {
        blockChange = block.map((change) => (change.added ? change.value : "")).join("\n");
      } else if (hasRemovedChanges) {
        blockChange = block
          .map((change) => (change.removed ? strikeThrough(change.value) : ""))
          .join("\n");
      } else {
        const content = block.map((change) => change.value).join("\n");
        // Skip blocks with only whitespace.
        if (content.trim().length > 0) {
          blockChange = "...";
        }
      }
      return blockChange;
    })
    .join("\n");
  return renderedChanges;
}

// Group changes into blocks for better UI presentation
export function getChangeBlocks(changes: Change[]): Change[][] {
  const blocks: Change[][] = [];
  let currentBlock: Change[] = [];

  changes.forEach((change) => {
    if (change.added || change.removed) {
      currentBlock.push(change);
    } else {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
      blocks.push([change]);
    }
  });
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }
  return blocks;
}
