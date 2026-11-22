export function extractNotePathFromChunkId(chunkId: string): string {
  const hashIndex = chunkId.lastIndexOf("#");
  if (hashIndex === -1) {
    return chunkId;
  }
  return chunkId.substring(0, hashIndex);
}
