import { TFile } from "obsidian";
import { z } from "zod";
import { logInfo, logWarn } from "@/logger";
import { Chunk, ChunkManager } from "@/search/v3/chunks";
import { createTool } from "./SimpleTool";

let chunkManagerInstance: ChunkManager | null = null;

interface LinkedNoteCandidate {
  path: string;
  title: string;
}

interface LinkedNoteMetadata {
  linkText: string;
  displayText: string;
  section?: string;
  candidates: LinkedNoteCandidate[];
  unresolved?: boolean;
}

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
  const tryResolve = (path: string) => {
    const maybeFile = app.vault.getAbstractFileByPath(path);
    return maybeFile instanceof TFile ? maybeFile : null;
  };

  const direct = tryResolve(notePath);
  if (direct) {
    return direct;
  }

  const hasExtension = /\.[^/]+$/.test(notePath);
  if (!hasExtension) {
    const fallbackExtensions = [".md", ".canvas"]; // default Obsidian note types
    for (const ext of fallbackExtensions) {
      const resolved = tryResolve(`${notePath}${ext}`);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
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

/**
 * Build an index of markdown files keyed by basename for duplicate detection.
 */
function buildBasenameIndex(): Map<string, TFile[]> {
  const index = new Map<string, TFile[]>();
  const files = app.vault.getMarkdownFiles?.() ?? [];

  for (const file of files) {
    if (!(file instanceof TFile)) {
      continue;
    }
    const list = index.get(file.basename) ?? [];
    list.push(file);
    index.set(file.basename, list);
  }

  return index;
}

/**
 * Resolve a wiki-link target to one or more candidate note files.
 */
function resolveWikiLinkTargets(
  rawTarget: string,
  sourcePath: string,
  basenameIndex: Map<string, TFile[]>
): TFile[] {
  const sanitized = rawTarget.trim();
  if (!sanitized) {
    return [];
  }

  const candidates = new Map<string, TFile>();

  const firstResolved = app.metadataCache.getFirstLinkpathDest?.(sanitized, sourcePath);
  if (firstResolved instanceof TFile) {
    candidates.set(firstResolved.path, firstResolved);
  }

  const hasExtension = /\.[^./]+$/.test(sanitized);

  if (!hasExtension) {
    const basename = sanitized.split("/").pop() ?? sanitized;
    const duplicates = basenameIndex.get(basename) ?? [];
    for (const file of duplicates) {
      candidates.set(file.path, file);
    }
  }

  // Limit to 10 candidates to prevent overly large payloads
  return Array.from(candidates.values()).slice(0, 10);
}

/**
 * Extract linked note metadata from the chunk content.
 */
function extractLinkedNoteMetadata(chunk: Chunk, sourceFile: TFile): LinkedNoteMetadata[] {
  const content = chunk.content;
  if (!content) {
    return [];
  }

  const linkPattern = /\[\[([^\]]+)\]\]/g;
  const matches = new Map<string, LinkedNoteMetadata>();
  let basenameIndex: Map<string, TFile[]> | null = null;

  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(content)) !== null) {
    const inner = match[1]?.trim();
    if (!inner) {
      continue;
    }

    const [targetPart, displayPart] = inner.split("|");
    const [targetWithoutSection, sectionPart] = targetPart.split("#");
    const normalizedTarget = targetWithoutSection?.trim();
    if (!normalizedTarget) {
      continue;
    }

    const key = `${normalizedTarget}|${displayPart ?? ""}|${sectionPart ?? ""}`;
    if (matches.has(key)) {
      continue;
    }

    if (!basenameIndex) {
      basenameIndex = buildBasenameIndex();
    }

    const candidateFiles = resolveWikiLinkTargets(normalizedTarget, sourceFile.path, basenameIndex);

    matches.set(key, {
      linkText: normalizedTarget,
      displayText: displayPart?.trim() || normalizedTarget,
      section: sectionPart?.trim() || undefined,
      candidates: candidateFiles.map((file) => ({
        path: file.path,
        title: file.basename,
      })),
      unresolved: candidateFiles.length === 0 ? true : undefined,
    });
  }

  return Array.from(matches.values());
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

    const canonicalPath = file.path;
    const chunks = await loadOrderedChunks(canonicalPath);

    if (chunks.length === 0) {
      logWarn(`readNote: no chunks generated for ${canonicalPath}`);
      return {
        notePath: canonicalPath,
        status: "empty",
        message: `No readable content was found in "${canonicalPath}".`,
      };
    }

    if (chunkIndex >= chunks.length) {
      return {
        notePath: canonicalPath,
        status: "out_of_range",
        message: `Chunk index ${chunkIndex} exceeds available chunks (last index ${chunks.length - 1}).`,
        totalChunks: chunks.length,
      };
    }

    const chunk = chunks[chunkIndex];
    logInfo(
      `readNote: returning chunk ${chunk.chunkIndex} of ${chunks.length} for ${canonicalPath}`
    );

    const hasMore = chunk.chunkIndex < chunks.length - 1;
    const linkedNotes = extractLinkedNoteMetadata(chunk, file);

    const headerPrefix = `\n\nNOTE TITLE: [[${chunk.title}]]\n\nNOTE BLOCK CONTENT:\n\n`;
    let cleanedContent = chunk.content;
    if (cleanedContent.startsWith(headerPrefix)) {
      cleanedContent = cleanedContent.slice(headerPrefix.length);
    }
    // Trim leading newlines introduced by header removal while preserving intentional spacing
    cleanedContent = cleanedContent.replace(/^\n+/, "");

    return {
      notePath: canonicalPath,
      noteTitle: chunk.title,
      heading: chunk.heading,
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunks.length,
      hasMore,
      nextChunkIndex: hasMore ? chunk.chunkIndex + 1 : null,
      content: cleanedContent,
      mtime: chunk.mtime,
      linkedNotes: linkedNotes.length > 0 ? linkedNotes : undefined,
    };
  },
});

export { readNoteSchema, readNoteTool };
