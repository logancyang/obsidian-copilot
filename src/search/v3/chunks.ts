import { logInfo, logWarn } from "@/logger";
import { CHUNK_SIZE } from "@/constants";
import { App, TFile } from "obsidian";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

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
  private splitter: RecursiveCharacterTextSplitter;

  constructor(private app: App) {
    // Create splitter for deterministic paragraph splitting
    this.splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: CHUNK_SIZE,
      chunkOverlap: 0, // Explicit overlap for determinism
      separators: ["\n\n", "\n", ". ", " ", ""], // Explicit separators
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
        // Basic security: prevent path traversal
        if (path.includes("..") || path.startsWith("/")) {
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
        // Check cache first
        let chunks = this.cache.get(notePath);

        if (!chunks) {
          // Generate chunks for this note
          chunks = await this.generateChunksForNote(notePath, options);

          // Simple cache (no LRU eviction for day 1)
          if (chunks.length > 0) {
            const chunkBytes = this.calculateChunkBytes(chunks);
            if (this.memoryUsage + chunkBytes <= options.maxBytesTotal) {
              this.cache.set(notePath, chunks);
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
   */
  private async getValidatedChunks(notePath: string): Promise<Chunk[]> {
    let chunks = this.cache.get(notePath);

    if (!chunks) {
      // FALLBACK: Regenerate chunks for this note
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
    const chunks = this.cache.get(notePath);

    if (!chunks) {
      logWarn(
        `ChunkManager: Chunk not in cache: ${id} (use async getChunkText for auto-regeneration)`
      );
      return "";
    }

    const chunk = chunks.find((c) => c.id === id);
    return chunk?.content || "";
  }

  /**
   * Regenerate chunks for a specific note (used for cache misses and file changes)
   */
  private async regenerateChunks(notePath: string): Promise<Chunk[]> {
    try {
      const chunks = await this.generateChunksForNote(notePath, DEFAULT_CHUNK_OPTIONS);

      if (chunks.length > 0) {
        // Update cache
        const chunkBytes = this.calculateChunkBytes(chunks);
        if (this.memoryUsage + chunkBytes <= DEFAULT_CHUNK_OPTIONS.maxBytesTotal) {
          // Remove old entry if it exists
          const oldChunks = this.cache.get(notePath);
          if (oldChunks) {
            this.memoryUsage -= this.calculateChunkBytes(oldChunks);
          }

          this.cache.set(notePath, chunks);
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

      // If no headings, treat entire content as one chunk
      if (headings.length === 0) {
        const processedChunks = await this.processContentSection(
          content,
          "",
          file,
          chunkIndex,
          options
        );
        chunks.push(...processedChunks);
        return chunks;
      }

      // Process content by heading sections
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const nextHeading = headings[i + 1];

        // Extract content for this section
        const startPos = heading.position.start.offset;
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
      // Section too large, split by paragraphs using existing splitter
      try {
        const docs = await this.splitter.createDocuments([content], [], {
          chunkHeader: header,
          appendChunkOverlapHeader: options.overlap > 0,
        });

        docs.forEach((doc, index) => {
          const chunkIndex = startChunkIndex + index;
          const chunkId = this.generateChunkId(file.path, chunkIndex);
          const contentHash = this.calculateContentHash(doc.pageContent);

          chunks.push({
            id: chunkId,
            notePath: file.path,
            chunkIndex,
            content: doc.pageContent,
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
}
