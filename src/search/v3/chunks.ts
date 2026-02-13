import { logInfo, logWarn } from "@/logger";
import { CHUNK_SIZE } from "@/constants";
import { App, TFile } from "obsidian";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/**
 * Chunk interface for unified search system
 */
export interface Chunk {
  id: string; // note_path#chunk_index (0-based, non-padded)
  notePath: string; // original note path
  chunkIndex: number; // 0-based chunk position
  content: string; // chunk text with headers
  contentHash: string; // hash to validate content integrity
  title: string; // note title
  heading: string; // section heading (first-class field)
  mtime: number; // note modification time
}

/**
 * Options for chunking behavior
 */
export interface ChunkOptions {
  maxChars: number; // max chars per chunk, derived from CHUNK_SIZE
  overlap: number; // default: 0 (start simple)
  maxBytesTotal: number; // derived from Lex RAM slider
}

/**
 * Default chunking options using CHUNK_SIZE constant
 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: CHUNK_SIZE,
  overlap: 0,
  maxBytesTotal: 10 * 1024 * 1024, // 10MB default
};

/**
 * Simple chunk manager with Map-based cache (no LRU for day 1)
 * Uses heading-first chunking algorithm as specified in the plan
 */
export class ChunkManager {
  private cache: Map<string, Chunk[]> = new Map();
  private memoryUsage: number = 0;

  constructor(private app: App) {}

  /**
   * Generate a cache key that includes chunking options
   * This ensures different option configurations don't return stale chunks
   */
  private getCacheKey(notePath: string, options: ChunkOptions): string {
    return `${notePath}:${options.maxChars}:${options.overlap}`;
  }

  /**
   * Create a text splitter configured for the given options
   */
  private createSplitter(options: ChunkOptions): RecursiveCharacterTextSplitter {
    return RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: options.maxChars,
      chunkOverlap: options.overlap,
      separators: ["\n\n", "\n", ". ", " ", ""], // Explicit separators for determinism
      keepSeparator: false, // Consistent separator handling
    });
  }

  /**
   * Get chunks for multiple note paths with caching
   * Algorithm: heading-first → size-cap sections
   */
  async getChunks(notePaths: string[], opts: Partial<ChunkOptions> = {}): Promise<Chunk[]> {
    try {
      // Input validation
      if (!Array.isArray(notePaths)) {
        logWarn("ChunkManager: Invalid notePaths provided");
        return [];
      }

      if (notePaths.length === 0) {
        return [];
      }

      if (notePaths.length > 1000) {
        logWarn("ChunkManager: Too many note paths, limiting to 1000");
        notePaths = notePaths.slice(0, 1000);
      }

      // Validate note paths
      const validPaths = notePaths.filter((path) => {
        if (!path || typeof path !== "string") {
          return false;
        }
        // Security: prevent path traversal (but allow ".." in filenames like "v1..2.md")
        // Block: "../foo", "foo/../bar", "foo/..", absolute paths
        if (
          path.startsWith("/") ||
          path.startsWith("../") ||
          path.includes("/../") ||
          path.endsWith("/..")
        ) {
          return false;
        }
        return true;
      });

      if (validPaths.length === 0) {
        logWarn("ChunkManager: No valid note paths provided");
        return [];
      }

      const options = { ...DEFAULT_CHUNK_OPTIONS, ...opts };
      const allChunks: Chunk[] = [];

      for (const notePath of validPaths) {
        // Check cache first using composite key (includes options)
        const cacheKey = this.getCacheKey(notePath, options);
        let chunks = this.cache.get(cacheKey);

        // Validate mtime if cached - regenerate if file was modified
        if (chunks && chunks.length > 0) {
          const file = this.app.vault.getAbstractFileByPath(notePath);
          if (file && file instanceof TFile && file.stat.mtime > chunks[0].mtime) {
            // File was modified since chunks were cached - invalidate cache
            const oldBytes = this.calculateChunkBytes(chunks);
            this.cache.delete(cacheKey);
            this.memoryUsage -= oldBytes;
            chunks = undefined;
          }
        }

        if (!chunks) {
          // Generate chunks for this note
          chunks = await this.generateChunksForNote(notePath, options);

          // Simple cache (no LRU eviction for day 1)
          if (chunks.length > 0) {
            const chunkBytes = this.calculateChunkBytes(chunks);
            if (this.memoryUsage + chunkBytes <= options.maxBytesTotal) {
              this.cache.set(cacheKey, chunks);
              this.memoryUsage += chunkBytes;
            } else {
              logWarn(`ChunkManager: Skipping cache for ${notePath}, would exceed memory budget`);
            }
          }
        }

        allChunks.push(...chunks);
      }

      logInfo(
        `ChunkManager: Retrieved ${allChunks.length} chunks from ${validPaths.length} notes (${this.formatMemoryUsage()})`
      );
      return allChunks;
    } catch (error) {
      logWarn("ChunkManager: Failed to get chunks", error);
      return []; // Always return empty array on error
    }
  }

  /**
   * Get chunk text by ID (for LLM context) with automatic cache validation and regeneration
   */
  async getChunkText(id: string): Promise<string> {
    const chunk = await this.ensureChunkExists(id);
    return chunk?.content || "";
  }

  /**
   * Ensure chunk exists in cache with automatic validation and regeneration
   */
  private async ensureChunkExists(id: string): Promise<Chunk | null> {
    const [notePath] = id.split("#");
    const chunks = await this.getValidatedChunks(notePath);

    const chunk = chunks.find((c) => c.id === id);
    if (!chunk) {
      logWarn(`ChunkManager: Chunk ${id} not found after regeneration`);
    }
    return chunk || null;
  }

  /**
   * Get validated chunks for a note path with automatic cache validation and regeneration
   * Searches all cache entries for this notePath (regardless of options used) before regenerating
   */
  private async getValidatedChunks(notePath: string): Promise<Chunk[]> {
    // Search all cache entries for this notePath (regardless of options used)
    // This ensures chunks created with non-default options are still retrievable
    let chunks: Chunk[] | undefined;
    for (const [cacheKey, cachedChunks] of this.cache.entries()) {
      if (cacheKey.startsWith(notePath + ":")) {
        chunks = cachedChunks;
        break;
      }
    }

    if (!chunks) {
      // FALLBACK: Regenerate chunks for this note with default options
      logInfo(`ChunkManager: Cache miss for ${notePath}, regenerating...`);
      chunks = await this.regenerateChunks(notePath);
      if (!chunks || chunks.length === 0) {
        logWarn(`ChunkManager: Failed to regenerate chunks for ${notePath}`);
        return [];
      }
    }

    // VALIDATE: Check if file has been modified since chunks were created
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (file && file instanceof TFile && chunks.length > 0 && file.stat.mtime > chunks[0].mtime) {
      logInfo(`ChunkManager: File ${notePath} modified, regenerating chunks`);
      chunks = await this.regenerateChunks(notePath);
      if (!chunks || chunks.length === 0) {
        logWarn(`ChunkManager: Failed to regenerate chunks after modification for ${notePath}`);
        return [];
      }
    }

    return chunks;
  }

  /**
   * Synchronous version for backward compatibility (with warning)
   * @deprecated Use async getChunkText() instead for proper cache validation
   */
  getChunkTextSync(id: string): string {
    const [notePath] = id.split("#");

    // Search all cache entries for this notePath (regardless of options used)
    // This maintains backward compatibility for the deprecated sync method
    for (const [cacheKey, chunks] of this.cache.entries()) {
      if (cacheKey.startsWith(notePath + ":")) {
        const chunk = chunks.find((c) => c.id === id);
        if (chunk) {
          return chunk.content;
        }
      }
    }

    logWarn(
      `ChunkManager: Chunk not in cache: ${id} (use async getChunkText for auto-regeneration)`
    );
    return "";
  }

  /**
   * Regenerate chunks for a specific note (used for cache misses and file changes)
   * Uses DEFAULT_CHUNK_OPTIONS for consistency with getValidatedChunks
   */
  private async regenerateChunks(notePath: string): Promise<Chunk[]> {
    try {
      const chunks = await this.generateChunksForNote(notePath, DEFAULT_CHUNK_OPTIONS);
      const cacheKey = this.getCacheKey(notePath, DEFAULT_CHUNK_OPTIONS);

      if (chunks.length > 0) {
        // Update cache
        const chunkBytes = this.calculateChunkBytes(chunks);
        if (this.memoryUsage + chunkBytes <= DEFAULT_CHUNK_OPTIONS.maxBytesTotal) {
          // Remove old entry if it exists
          const oldChunks = this.cache.get(cacheKey);
          if (oldChunks) {
            this.memoryUsage -= this.calculateChunkBytes(oldChunks);
          }

          this.cache.set(cacheKey, chunks);
          this.memoryUsage += chunkBytes;
        } else {
          logWarn(
            `ChunkManager: Cannot cache regenerated chunks for ${notePath}, would exceed memory budget`
          );
        }
      }

      return chunks;
    } catch (error) {
      logWarn(`ChunkManager: Failed to regenerate chunks for ${notePath}`, error);
      return [];
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.memoryUsage = 0;
    logInfo("ChunkManager: Cache cleared");
  }

  /**
   * Generate chunks for a single note using deterministic heading-first algorithm
   */
  private async generateChunksForNote(notePath: string, options: ChunkOptions): Promise<Chunk[]> {
    try {
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!file || !(file instanceof TFile)) {
        return [];
      }

      const content = await this.safeReadFile(file);
      if (!content?.trim()) {
        return [];
      }

      // Use metadata cache to get headings and ensure deterministic order
      const cache = this.app.metadataCache.getFileCache(file);
      const headings = (cache?.headings || [])
        .slice() // Don't mutate original array
        .sort((a, b) => a.position.start.offset - b.position.start.offset); // Ensure consistent order

      const chunks: Chunk[] = [];
      let chunkIndex = 0;

      // Calculate content after frontmatter
      const frontmatterEnd = this.findFrontmatterEnd(content, cache?.frontmatter);
      const contentAfterFrontmatter = content.substring(frontmatterEnd);

      // Get first heading text for the chunk heading field (empty if no headings)
      const firstHeading = headings.length > 0 ? headings[0].heading : "";

      // If entire content fits in one chunk, keep it together (don't split by headings)
      // This prevents small notes from being fragmented into tiny pieces
      const header = `\n\nNOTE TITLE: [[${file.basename}]]\n\nNOTE BLOCK CONTENT:\n\n`;
      if (header.length + contentAfterFrontmatter.length <= options.maxChars) {
        const processedChunks = await this.processContentSection(
          contentAfterFrontmatter,
          firstHeading,
          file,
          chunkIndex,
          options
        );
        chunks.push(...processedChunks);
        return chunks;
      }

      // Content too large - need to split
      // If no headings, use text splitter on entire content
      if (headings.length === 0) {
        const processedChunks = await this.processContentSection(
          contentAfterFrontmatter,
          "",
          file,
          chunkIndex,
          options
        );
        chunks.push(...processedChunks);
        return chunks;
      }

      // Split by heading sections
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const nextHeading = headings[i + 1];

        // Extract content for this section
        // For the first section, include preamble content (after frontmatter, before first heading)
        const startPos = i === 0 ? frontmatterEnd : heading.position.start.offset;
        const endPos = nextHeading?.position.start.offset || content.length;
        const sectionContent = content.substring(startPos, endPos);

        const processedChunks = await this.processContentSection(
          sectionContent,
          heading.heading,
          file,
          chunkIndex,
          options
        );

        chunks.push(...processedChunks);
        chunkIndex += processedChunks.length;
      }

      return chunks;
    } catch (error) {
      logWarn(`ChunkManager: Failed to chunk note ${notePath}`, error);
      return [];
    }
  }

  /**
   * Process a content section (heading + content) into chunks
   * If section > maxChars: split by paragraphs
   * Otherwise: return as single chunk
   */
  private async processContentSection(
    content: string,
    heading: string,
    file: TFile,
    startChunkIndex: number,
    options: ChunkOptions
  ): Promise<Chunk[]> {
    const title = file.basename;
    const chunks: Chunk[] = [];

    // Add note title header for context (similar to existing pattern)
    const header = `\n\nNOTE TITLE: [[${title}]]\n\nNOTE BLOCK CONTENT:\n\n`;
    const fullContent = header + content;

    if (fullContent.length <= options.maxChars) {
      // Section fits in one chunk
      const chunkId = this.generateChunkId(file.path, startChunkIndex);
      const contentHash = this.calculateContentHash(fullContent);

      chunks.push({
        id: chunkId,
        notePath: file.path,
        chunkIndex: startChunkIndex,
        content: fullContent,
        contentHash,
        title,
        heading,
        mtime: file.stat.mtime,
      });
    } else {
      // Section too large, split by paragraphs using splitter configured for options
      try {
        const splitter = this.createSplitter(options);
        const docs = await splitter.createDocuments([content], [], {
          chunkHeader: header,
          appendChunkOverlapHeader: options.overlap > 0,
        });
        const coalescedContents = this.coalesceTinySplitChunks(
          docs.map((doc) => doc.pageContent),
          header,
          options.maxChars
        );

        coalescedContents.forEach((chunkContent, index) => {
          const chunkIndex = startChunkIndex + index;
          const chunkId = this.generateChunkId(file.path, chunkIndex);
          const contentHash = this.calculateContentHash(chunkContent);

          chunks.push({
            id: chunkId,
            notePath: file.path,
            chunkIndex,
            content: chunkContent,
            contentHash,
            title,
            heading,
            mtime: file.stat.mtime,
          });
        });
      } catch (error) {
        logWarn(`ChunkManager: Failed to split section in ${file.path}`, error);
        // Fallback to single chunk even if large
        const chunkId = this.generateChunkId(file.path, startChunkIndex);
        const contentHash = this.calculateContentHash(fullContent);

        chunks.push({
          id: chunkId,
          notePath: file.path,
          chunkIndex: startChunkIndex,
          content: fullContent,
          contentHash,
          title,
          heading,
          mtime: file.stat.mtime,
        });
      }
    }

    return chunks;
  }

  /**
   * Merge tiny structural chunks (for example, heading-only splits) into neighbors
   * when the merged content stays within the configured chunk size.
   */
  private coalesceTinySplitChunks(
    chunkContents: string[],
    header: string,
    maxChars: number
  ): string[] {
    if (chunkContents.length <= 1) {
      return chunkContents;
    }

    const merged = [...chunkContents];
    let index = 0;

    // Prefer forward merge so heading-only chunks are attached to subsequent body text.
    while (index < merged.length - 1) {
      if (this.isTinyStructuralChunk(merged[index], header)) {
        const candidate = this.mergeChunkContents(merged[index], merged[index + 1], header);
        if (candidate.length <= maxChars) {
          merged.splice(index, 2, candidate);
          continue;
        }
      }
      index++;
    }

    // Handle rare trailing tiny chunk if it can be merged backward safely.
    if (merged.length > 1) {
      const lastIndex = merged.length - 1;
      if (this.isTinyStructuralChunk(merged[lastIndex], header)) {
        const candidate = this.mergeChunkContents(merged[lastIndex - 1], merged[lastIndex], header);
        if (candidate.length <= maxChars) {
          merged.splice(lastIndex - 1, 2, candidate);
        }
      }
    }

    return merged;
  }

  /**
   * Identify tiny chunks that only carry structure (for example, an isolated heading line).
   */
  private isTinyStructuralChunk(chunkContent: string, header: string): boolean {
    const body = this.stripChunkHeader(chunkContent, header).trim();
    if (!body) {
      return true;
    }

    const nonEmptyLines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return nonEmptyLines.length === 1 && /^#{1,6}\s+\S+/.test(nonEmptyLines[0]);
  }

  /**
   * Merge two split chunks into a single chunk while keeping one chunk header.
   */
  private mergeChunkContents(primaryChunk: string, secondaryChunk: string, header: string): string {
    const primaryBody = this.stripChunkHeader(primaryChunk, header).replace(/\s+$/, "");
    const secondaryBody = this.stripChunkHeader(secondaryChunk, header).replace(/^\s+/, "");
    const joiner = primaryBody && secondaryBody ? "\n\n" : "";

    return `${header}${primaryBody}${joiner}${secondaryBody}`;
  }

  /**
   * Remove the synthetic chunk header that is prepended before indexing split chunks.
   */
  private stripChunkHeader(chunkContent: string, header: string): string {
    if (chunkContent.startsWith(header)) {
      return chunkContent.slice(header.length);
    }
    return chunkContent;
  }

  /**
   * Calculate memory usage for chunks in bytes
   */
  private calculateChunkBytes(chunks: Chunk[]): number {
    return chunks.reduce((total, chunk) => {
      return total + Buffer.byteLength(chunk.content, "utf8");
    }, 0);
  }

  /**
   * Safe file reading with error handling
   */
  private async safeReadFile(file: TFile): Promise<string> {
    try {
      const content = await this.app.vault.cachedRead(file);
      return content?.trim() || "";
    } catch (error) {
      logWarn(`ChunkManager: Failed to read ${file.path}`, error);
      return "";
    }
  }

  /**
   * Generate deterministic chunk ID with numeric index
   * Format: "note_path#chunk_index" (e.g., "note.md#0", "note.md#123")
   * No padding allows unlimited chunks per note
   */
  private generateChunkId(notePath: string, chunkIndex: number): string {
    return `${notePath}#${chunkIndex}`;
  }

  /**
   * Calculate content hash for integrity validation
   */
  private calculateContentHash(content: string): string {
    // Lightweight hash using length + content sample for cache validation
    const lengthHex = content.length.toString(16);
    const contentSample = content.slice(0, 32).replace(/\s/g, "").substring(0, 8);
    return lengthHex + contentSample;
  }

  /**
   * Format memory usage for logging
   */
  private formatMemoryUsage(): string {
    const mb = (this.memoryUsage / 1024 / 1024).toFixed(1);
    return `${mb}MB`;
  }

  /**
   * Find the end position of YAML frontmatter in content
   * Frontmatter starts with "---" on the first line and ends with "---" on its own line
   * @returns Position after frontmatter (including trailing newline), or 0 if no frontmatter
   */
  private findFrontmatterEnd(content: string, frontmatter: unknown): number {
    // No frontmatter parsed by Obsidian, start from beginning
    if (!frontmatter) {
      return 0;
    }

    // Frontmatter must start at the very beginning with "---"
    if (!content.startsWith("---")) {
      return 0;
    }

    // Find the closing "---" (must be on its own line, or at EOF)
    const closingMatch = content.match(/\n---(\r?\n|$)/);
    if (closingMatch && closingMatch.index !== undefined) {
      // Return position after the closing "---" (and newline if present)
      return closingMatch.index + closingMatch[0].length;
    }

    // Fallback: no valid closing found, start from beginning
    return 0;
  }
}

/**
 * Singleton accessor for shared ChunkManager instance.
 * Ensures all systems (semantic indexing, lexical search, etc.) share the same cache.
 */
let sharedInstance: ChunkManager | null = null;

export function getSharedChunkManager(app: App): ChunkManager {
  if (!sharedInstance) {
    sharedInstance = new ChunkManager(app);
  }
  return sharedInstance;
}

/**
 * Reset the shared instance (for testing or plugin reload)
 */
export function resetSharedChunkManager(): void {
  if (sharedInstance) {
    sharedInstance.clearCache();
  }
  sharedInstance = null;
}
