/**
 * Extract the note path from a chunk ID.
 * Chunk IDs have the format "note.md#0", "folder/note.md#2", etc.
 * If the ID has no "#" suffix, it's already a note path and is returned as-is.
 *
 * @param chunkId - A chunk ID like "folder/note.md#0" or a plain note path
 * @returns The note path without the chunk suffix (e.g., "folder/note.md")
 */
export function extractNotePathFromChunkId(chunkId: string): string {
  const hashIndex = chunkId.lastIndexOf("#");
  if (hashIndex === -1) {
    return chunkId;
  }
  return chunkId.substring(0, hashIndex);
}
