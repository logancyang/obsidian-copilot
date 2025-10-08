import { TFile } from "obsidian";
import { z } from "zod";
import { logInfo, logWarn } from "@/logger";
import { createTool } from "./SimpleTool";

const LINES_PER_CHUNK = 200;

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

interface NoteChunk {
  id: string;
  notePath: string;
  chunkIndex: number;
  content: string;
  heading: string;
}

/**
 * Normalizes a path fragment to support case-insensitive comparisons with forward slashes.
 *
 * @param value - Path or fragment supplied by the caller or taken from vault files.
 * @returns Lowercase path string with forward slashes as separators.
 */
function normalizePathFragment(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

/**
 * Determines whether the provided path already contains a file extension.
 *
 * @param value - Path or fragment to inspect.
 * @returns True if the input ends with an extension segment.
 */
function pathHasExtension(value: string): boolean {
  return /\.[^/]+$/.test(value);
}

async function resolveNoteFile(notePath: string): Promise<TFile | null> {
  const tryResolve = (path: string) => {
    const maybeFile = app.vault.getAbstractFileByPath(path);
    return maybeFile instanceof TFile ? maybeFile : null;
  };

  const trimmedInput = notePath.trim();
  const wikiMatch = trimmedInput.match(/^\s*\[\[([\s\S]+?)\]\]\s*$/);
  const innerTarget = wikiMatch ? wikiMatch[1] : trimmedInput;
  const [targetPart] = innerTarget.split("|");
  const [targetWithoutSection] = (targetPart ?? innerTarget).split("#");
  const canonicalTarget = targetWithoutSection?.trim() || trimmedInput;

  const attemptedPaths = Array.from(
    new Set<string>(
      [trimmedInput, innerTarget, canonicalTarget].map((value) => value.trim()).filter(Boolean)
    )
  );

  for (const candidate of attemptedPaths) {
    const direct = tryResolve(candidate);
    if (direct) {
      return direct;
    }

    if (!pathHasExtension(candidate)) {
      for (const ext of [".md", ".canvas"]) {
        const resolved = tryResolve(`${candidate}${ext}`);
        if (resolved) {
          return resolved;
        }
      }
    }
  }

  const metadataCache = app.metadataCache;
  const resolutionTarget = canonicalTarget;

  if (metadataCache && resolutionTarget) {
    const linkTargets = new Set<string>([resolutionTarget]);

    if (!pathHasExtension(resolutionTarget)) {
      for (const ext of [".md", ".canvas"]) {
        linkTargets.add(`${resolutionTarget}${ext}`);
      }
    }

    for (const target of linkTargets) {
      const resolved = metadataCache.getFirstLinkpathDest?.(target, "");
      if (resolved instanceof TFile) {
        return resolved;
      }
    }
  }

  if (!resolutionTarget) {
    return null;
  }

  const markdownFiles = app.vault.getMarkdownFiles?.() ?? [];
  if (markdownFiles.length === 0) {
    return null;
  }

  const normalizedTarget = normalizePathFragment(resolutionTarget);
  const candidatePathForms = new Set<string>([normalizedTarget]);

  if (!pathHasExtension(resolutionTarget)) {
    for (const ext of [".md", ".canvas"]) {
      candidatePathForms.add(normalizePathFragment(`${resolutionTarget}${ext}`));
    }
  }

  for (const file of markdownFiles) {
    const normalizedFilePath = normalizePathFragment(file.path);
    if (candidatePathForms.has(normalizedFilePath)) {
      return file;
    }
  }

  const basename = resolutionTarget.split("/").pop();
  if (basename) {
    const normalizedBasename = basename.toLowerCase();
    const basenameMatches = markdownFiles.filter(
      (file) => file.basename.toLowerCase() === normalizedBasename
    );

    if (basenameMatches.length === 1) {
      return basenameMatches[0];
    }
  }

  const partialMatches = markdownFiles.filter((file) =>
    normalizePathFragment(file.path).includes(normalizedTarget)
  );

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  return null;
}

async function readNoteText(file: TFile): Promise<string> {
  try {
    return await app.vault.cachedRead(file);
  } catch (error) {
    logWarn(`readNote: failed to read ${file.path}`, error);
    return "";
  }
}

function buildBasenameIndex(): Map<string, TFile[]> {
  const index = new Map<string, TFile[]>();
  const files = app.vault.getMarkdownFiles?.() ?? [];

  for (const file of files) {
    if (file instanceof TFile) {
      const entries = index.get(file.basename) ?? [];
      entries.push(file);
      index.set(file.basename, entries);
    }
  }

  return index;
}

function resolveWikiLinkTargets(
  rawTarget: string,
  sourcePath: string,
  basenameIndex: Map<string, TFile[]>
): TFile[] {
  const target = rawTarget.trim();
  if (!target) {
    return [];
  }

  const results = new Map<string, TFile>();
  const resolved = app.metadataCache.getFirstLinkpathDest?.(target, sourcePath);
  if (resolved instanceof TFile) {
    results.set(resolved.path, resolved);
  }

  if (!/\.[^./]+$/.test(target)) {
    const basename = target.split("/").pop() ?? target;
    const duplicates = basenameIndex.get(basename) ?? [];
    for (const file of duplicates) {
      results.set(file.path, file);
    }
  }

  return Array.from(results.values());
}

function extractLinkedNoteMetadata(content: string, sourceFile: TFile): LinkedNoteMetadata[] {
  if (!content) {
    return [];
  }

  const linkPattern = /\[\[([^\]]+)\]\]/g;
  const matches = new Map<string, LinkedNoteMetadata>();
  let basenameIndex: Map<string, TFile[]> | null = null;

  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(content)) !== null) {
    if (match.index > 0 && content[match.index - 1] === "!") {
      continue;
    }

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

function chunkContentByLines(file: TFile, content: string): NoteChunk[] {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length === 1 && lines[0] === "" ? 0 : lines.length;

  if (totalLines === 0) {
    return [
      {
        id: `${file.path}#L1-1`,
        notePath: file.path,
        chunkIndex: 0,
        content: "",
        heading: "",
      },
    ];
  }

  const totalChunks = Math.ceil(totalLines / LINES_PER_CHUNK);
  const chunks: NoteChunk[] = [];

  for (let index = 0; index < totalChunks; index++) {
    const start = index * LINES_PER_CHUNK;
    const end = Math.min((index + 1) * LINES_PER_CHUNK, totalLines);
    const chunkLines = lines.slice(start, end);
    const headingLine = chunkLines.find((line) => /^#+\s+/.test(line.trim()));
    const heading = headingLine ? headingLine.trim().replace(/^#+\s+/, "") : "";

    chunks.push({
      id: `${file.path}#L${start + 1}-${end}`,
      notePath: file.path,
      chunkIndex: index,
      content: chunkLines.join("\n").trimEnd(),
      heading,
    });
  }

  return chunks;
}

const readNoteSchema = z.object({
  notePath: z
    .string()
    .min(1)
    .describe(
      "Full path to the note (relative to the vault root) that needs to be read, such as 'Projects/plan.md'."
    ),
  chunkIndex: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          return undefined;
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : value;
      }
      return value;
    }, z.number().int().min(0))
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
    const text = await readNoteText(file);
    const chunks = chunkContentByLines(file, text);
    const totalChunks = chunks.length;

    if (totalChunks === 0) {
      return {
        notePath: canonicalPath,
        status: "empty",
        message: `No readable content was found in "${canonicalPath}".`,
      };
    }

    if (chunkIndex >= totalChunks) {
      return {
        notePath: canonicalPath,
        status: "out_of_range",
        message: `Chunk index ${chunkIndex} exceeds available chunks (last index ${totalChunks - 1}).`,
        totalChunks,
      };
    }

    const chunk = chunks[chunkIndex];
    logInfo(`readNote: returning chunk ${chunk.chunkIndex} of ${totalChunks} for ${canonicalPath}`);

    const hasMore = chunk.chunkIndex < totalChunks - 1;
    const linkedNotes = extractLinkedNoteMetadata(chunk.content, file);

    return {
      notePath: canonicalPath,
      noteTitle: file.basename,
      heading: chunk.heading,
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      totalChunks,
      hasMore,
      nextChunkIndex: hasMore ? chunk.chunkIndex + 1 : null,
      content: chunk.content,
      mtime: file.stat.mtime,
      linkedNotes: linkedNotes.length > 0 ? linkedNotes : undefined,
    };
  },
});

export { readNoteSchema, readNoteTool };
