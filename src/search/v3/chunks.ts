import { logInfo, logWarn } from "@/logger";
import { CHUNK_SIZE } from "@/constants";
import { App, TFile } from "obsidian";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

/**
 * Chunk interface for unified search system
 */
export interface Chunk {
  id: string; // note_path#chunk_index
  notePath: string; // original note path
  chunkIndex: number; // 0-based chunk position
  content: string; // chunk text with headers
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
    // Create splitter for fallback paragraph splitting
    this.splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: CHUNK_SIZE,
    });
  }

  /**
   * Get chunks for multiple note paths with caching
   * Algorithm: heading-first → size-cap sections
   */
  async getChunks(notePaths: string[], opts: Partial<ChunkOptions> = {}): Promise<Chunk[]> {
    const options = { ...DEFAULT_CHUNK_OPTIONS, ...opts };
    const allChunks: Chunk[] = [];

    for (const notePath of notePaths) {
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
      `ChunkManager: Retrieved ${allChunks.length} chunks from ${notePaths.length} notes (${this.formatMemoryUsage()})`
    );
    return allChunks;
  }

  /**
   * Get chunk text by ID (for LLM context)
   */
  getChunkText(id: string): string {
    const [notePath] = id.split("#");
    const chunks = this.cache.get(notePath);

    if (!chunks) {
      logWarn(`ChunkManager: Chunk not in cache: ${id}`);
      return "";
    }

    const chunk = chunks.find((c) => c.id === id);
    return chunk?.content || "";
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
   * Generate chunks for a single note using heading-first algorithm
   */
  private async generateChunksForNote(notePath: string, options: ChunkOptions): Promise<Chunk[]> {
    try {
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!file || !(file instanceof TFile)) {
        return [];
      }

      const content = await this.app.vault.cachedRead(file);
      if (!content?.trim()) {
        return [];
      }

      // Use metadata cache to get headings
      const cache = this.app.metadataCache.getFileCache(file);
      const headings = cache?.headings || [];

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
      chunks.push({
        id: `${file.path}#${startChunkIndex}`,
        notePath: file.path,
        chunkIndex: startChunkIndex,
        content: fullContent,
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
          chunks.push({
            id: `${file.path}#${startChunkIndex + index}`,
            notePath: file.path,
            chunkIndex: startChunkIndex + index,
            content: doc.pageContent,
            title,
            heading,
            mtime: file.stat.mtime,
          });
        });
      } catch (error) {
        logWarn(`ChunkManager: Failed to split section in ${file.path}`, error);
        // Fallback to single chunk even if large
        chunks.push({
          id: `${file.path}#${startChunkIndex}`,
          notePath: file.path,
          chunkIndex: startChunkIndex,
          content: fullContent,
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
   * Format memory usage for logging
   */
  private formatMemoryUsage(): string {
    const mb = (this.memoryUsage / 1024 / 1024).toFixed(1);
    return `${mb}MB`;
  }
}
