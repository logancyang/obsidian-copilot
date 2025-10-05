import { TFile } from "obsidian";
import { z } from "zod";
import { logInfo, logWarn } from "@/logger";
import { Chunk, ChunkManager } from "@/search/v3/chunks";
import { createTool } from "./SimpleTool";

let chunkManagerInstance: ChunkManager | null = null;

/**
 * Lazily retrieve the shared ChunkManager instance.
 */
function getChunkManager(): ChunkManager {
  if (!chunkManagerInstance) {
    chunkManagerInstance = new ChunkManager(app);
  }
  return chunkManagerInstance;
}

/**
 * Resolve the note path to a TFile if possible.
 */
async function resolveNoteFile(notePath: string): Promise<TFile | null> {
  const file = app.vault.getAbstractFileByPath(notePath);

  if (!file || !(file instanceof TFile)) {
    return null;
  }

  return file;
}

/**
 * Load chunks for the specified note and return them ordered by their index.
 */
async function loadOrderedChunks(notePath: string): Promise<Chunk[]> {
  const chunkManager = getChunkManager();
  const chunks = await chunkManager.getChunks([notePath]);

  return chunks
    .filter((chunk) => chunk.notePath === notePath)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

const readNoteSchema = z.object({
  notePath: z
    .string()
    .min(1)
    .describe(
      "Full path to the note (relative to the vault root) that needs to be read, such as 'Projects/plan.md'."
    ),
  chunkIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("0-based chunk index to read. Omit to read the first chunk."),
});

const readNoteTool = createTool({
  name: "readNote",
  description:
    "Read a single note in search v3 sized chunks. Use only when you already know the exact note path and need its contents.",
  schema: readNoteSchema,
  handler: async ({ notePath, chunkIndex = 0 }) => {
    const sanitizedPath = notePath.trim();

    if (sanitizedPath.startsWith("/")) {
      return {
        notePath: sanitizedPath,
        status: "invalid_path",
        message: "Provide the note path relative to the vault root without a leading slash.",
      };
    }

    const file = await resolveNoteFile(sanitizedPath);
    if (!file) {
      logWarn(`readNote: note not found or not a file (${sanitizedPath})`);
      return {
        notePath: sanitizedPath,
        status: "not_found",
        message: `Note "${sanitizedPath}" was not found or is not a readable file.`,
      };
    }

    const chunks = await loadOrderedChunks(sanitizedPath);

    if (chunks.length === 0) {
      logWarn(`readNote: no chunks generated for ${sanitizedPath}`);
      return {
        notePath: sanitizedPath,
        status: "empty",
        message: `No readable content was found in "${sanitizedPath}".`,
      };
    }

    if (chunkIndex >= chunks.length) {
      return {
        notePath: sanitizedPath,
        status: "out_of_range",
        message: `Chunk index ${chunkIndex} exceeds available chunks (last index ${chunks.length - 1}).`,
        totalChunks: chunks.length,
      };
    }

    const chunk = chunks[chunkIndex];
    logInfo(
      `readNote: returning chunk ${chunk.chunkIndex} of ${chunks.length} for ${sanitizedPath}`
    );

    const hasMore = chunk.chunkIndex < chunks.length - 1;

    return {
      notePath: sanitizedPath,
      noteTitle: chunk.title,
      heading: chunk.heading,
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunks.length,
      hasMore,
      nextChunkIndex: hasMore ? chunk.chunkIndex + 1 : null,
      content: chunk.content,
      mtime: chunk.mtime,
    };
  },
});

export { readNoteSchema, readNoteTool };
