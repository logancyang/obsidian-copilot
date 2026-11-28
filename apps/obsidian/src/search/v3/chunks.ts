import { logInfo, logWarn } from "@/logger";
import { CHUNK_SIZE } from "@/constants";
import { App, TFile } from "obsidian";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryManager } from "./utils/MemoryManager";

export interface Chunk {
  id: string;
  notePath: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  title: string;
  heading: string;
  mtime: number;
}

export interface ChunkOptions {
  maxChars: number;
  overlap: number;
  maxBytesTotal: number;
}

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: CHUNK_SIZE,
  overlap: 0,
  maxBytesTotal: 10 * 1024 * 1024,
};

export class ChunkManager {
  private cache: Map<string, Chunk[]> = new Map();
  private memoryUsage: number = 0;

  constructor(private app: App) {}

  private getCacheKey(notePath: string, options: ChunkOptions): string {
    return `${notePath}:${options.maxChars}:${options.overlap}`;
  }

  private createSplitter(options: ChunkOptions): RecursiveCharacterTextSplitter {
    return RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: options.maxChars,
      chunkOverlap: options.overlap,
      separators: ["\n\n", "\n", ". ", " ", ""],
      keepSeparator: false,
    });
  }

  async getChunks(notePaths: string[], opts: Partial<ChunkOptions> = {}): Promise<Chunk[]> {
    try {
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

      const validPaths = notePaths.filter((path) => {
        if (!path || typeof path !== "string") {
          return false;
        }
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
      let skippedCacheCount = 0;
      let skippedCacheBytes = 0;

      for (const notePath of validPaths) {
        const cacheKey = this.getCacheKey(notePath, options);
        let chunks = this.cache.get(cacheKey);

        if (chunks && chunks.length > 0) {
          const file = this.app.vault.getAbstractFileByPath(notePath);
          if (file && file instanceof TFile && file.stat.mtime > chunks[0].mtime) {
            const oldBytes = this.calculateChunkBytes(chunks);
            this.cache.delete(cacheKey);
            this.memoryUsage -= oldBytes;
            chunks = undefined;
          }
        }

        if (!chunks) {
          chunks = await this.generateChunksForNote(notePath, options);

          if (chunks.length > 0) {
            const chunkBytes = this.calculateChunkBytes(chunks);
            if (this.memoryUsage + chunkBytes <= options.maxBytesTotal) {
              this.cache.set(cacheKey, chunks);
              this.memoryUsage += chunkBytes;
            } else {
              skippedCacheCount += 1;
              skippedCacheBytes += chunkBytes;
            }
          }
        }

        allChunks.push(...chunks);
      }

      if (skippedCacheCount > 0) {
        const skippedMb = (skippedCacheBytes / 1024 / 1024).toFixed(1);
        logInfo(
          `ChunkManager: Cache budget reached, skipped caching ${skippedCacheCount} notes (${skippedMb}MB total)`
        );
      }

      logInfo(
        `ChunkManager: Retrieved ${allChunks.length} chunks from ${validPaths.length} notes (${this.formatMemoryUsage()})`
      );
      return allChunks;
    } catch (error) {
      logWarn("ChunkManager: Failed to get chunks", error);
      return [];
    }
  }

  async getChunkText(id: string): Promise<string> {
    const chunk = await this.ensureChunkExists(id);
    return chunk?.content || "";
  }

  private async ensureChunkExists(id: string): Promise<Chunk | null> {
    const [notePath] = id.split("#");
    const chunks = await this.getValidatedChunks(notePath);

    const chunk = chunks.find((c) => c.id === id);
    if (!chunk) {
      logWarn(`ChunkManager: Chunk ${id} not found after regeneration`);
    }
    return chunk || null;
  }

  private async getValidatedChunks(notePath: string): Promise<Chunk[]> {
    let chunks: Chunk[] | undefined;
    for (const [cacheKey, cachedChunks] of this.cache.entries()) {
      if (cacheKey.startsWith(notePath + ":")) {
        chunks = cachedChunks;
        break;
      }
    }

    if (!chunks) {
      logInfo(`ChunkManager: Cache miss for ${notePath}, regenerating...`);
      chunks = await this.regenerateChunks(notePath);
      if (!chunks || chunks.length === 0) {
        logWarn(`ChunkManager: Failed to regenerate chunks for ${notePath}`);
        return [];
      }
    }

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

  getChunkTextSync(id: string): string {
    const [notePath] = id.split("#");

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

  private async regenerateChunks(notePath: string): Promise<Chunk[]> {
    try {
      const chunks = await this.generateChunksForNote(notePath, DEFAULT_CHUNK_OPTIONS);
      const cacheKey = this.getCacheKey(notePath, DEFAULT_CHUNK_OPTIONS);

      if (chunks.length > 0) {
        const chunkBytes = this.calculateChunkBytes(chunks);
        if (this.memoryUsage + chunkBytes <= DEFAULT_CHUNK_OPTIONS.maxBytesTotal) {
          const oldChunks = this.cache.get(cacheKey);
          if (oldChunks) {
            this.memoryUsage -= this.calculateChunkBytes(oldChunks);
          }

          this.cache.set(cacheKey, chunks);
          this.memoryUsage += chunkBytes;
        } else {
          logInfo(
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

      const cache = this.app.metadataCache.getFileCache(file);
      const headings = (cache?.headings || [])
        .slice()
        .sort((a, b) => a.position.start.offset - b.position.start.offset);

      const chunks: Chunk[] = [];
      let chunkIndex = 0;

      const frontmatterEnd = this.findFrontmatterEnd(content, cache?.frontmatter);
      const contentAfterFrontmatter = content.substring(frontmatterEnd);

      const firstHeading = headings.length > 0 ? headings[0].heading : "";

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

      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const nextHeading = headings[i + 1];

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

  private async processContentSection(
    content: string,
    heading: string,
    file: TFile,
    startChunkIndex: number,
    options: ChunkOptions
  ): Promise<Chunk[]> {
    const title = file.basename;
    const chunks: Chunk[] = [];

    const header = `\n\nNOTE TITLE: [[${title}]]\n\nNOTE BLOCK CONTENT:\n\n`;
    const fullContent = header + content;

    if (fullContent.length <= options.maxChars) {
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

  private mergeChunkContents(primaryChunk: string, secondaryChunk: string, header: string): string {
    const primaryBody = this.stripChunkHeader(primaryChunk, header).replace(/\s+$/, "");
    const secondaryBody = this.stripChunkHeader(secondaryChunk, header).replace(/^\s+/, "");
    const joiner = primaryBody && secondaryBody ? "\n\n" : "";

    return `${header}${primaryBody}${joiner}${secondaryBody}`;
  }

  private stripChunkHeader(chunkContent: string, header: string): string {
    if (chunkContent.startsWith(header)) {
      return chunkContent.slice(header.length);
    }
    return chunkContent;
  }

  private calculateChunkBytes(chunks: Chunk[]): number {
    return chunks.reduce((total, chunk) => {
      return total + MemoryManager.getByteSize(chunk.content);
    }, 0);
  }

  private async safeReadFile(file: TFile): Promise<string> {
    try {
      const content = await this.app.vault.cachedRead(file);
      return content?.trim() || "";
    } catch (error) {
      logWarn(`ChunkManager: Failed to read ${file.path}`, error);
      return "";
    }
  }

  private generateChunkId(notePath: string, chunkIndex: number): string {
    return `${notePath}#${chunkIndex}`;
  }

  private calculateContentHash(content: string): string {
    const lengthHex = content.length.toString(16);
    const contentSample = content.slice(0, 32).replace(/\s/g, "").substring(0, 8);
    return lengthHex + contentSample;
  }

  private formatMemoryUsage(): string {
    const mb = (this.memoryUsage / 1024 / 1024).toFixed(1);
    return `${mb}MB`;
  }

  private findFrontmatterEnd(content: string, frontmatter: unknown): number {
    if (!frontmatter) {
      return 0;
    }

    if (!content.startsWith("---")) {
      return 0;
    }

    const closingMatch = content.match(/\n---(\r?\n|$)/);
    if (closingMatch && closingMatch.index !== undefined) {
      return closingMatch.index + closingMatch[0].length;
    }

    return 0;
  }
}

let sharedInstance: ChunkManager | null = null;

export function getSharedChunkManager(app: App): ChunkManager {
  if (!sharedInstance) {
    sharedInstance = new ChunkManager(app);
  }
  return sharedInstance;
}
