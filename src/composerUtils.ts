import { Change } from "diff";

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
