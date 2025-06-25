import { logError, logInfo } from "@/logger";
import { MD5 } from "crypto-js";
import { TFile } from "obsidian";

export interface FileCacheEntry<T> {
  content: T;
  timestamp: number;
}

export class FileCache<T> {
  private static instance: FileCache<any>;
  private cacheDir: string;
  private memoryCache: Map<string, FileCacheEntry<T>> = new Map();

  private constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  static getInstance<T>(cacheDir: string = ".copilot/file-content-cache"): FileCache<T> {
    if (!FileCache.instance) {
      FileCache.instance = new FileCache<T>(cacheDir);
    }
    return FileCache.instance as FileCache<T>;
  }

  private async ensureCacheDir() {
    if (!(await app.vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating file cache directory:", this.cacheDir);
      await app.vault.adapter.mkdir(this.cacheDir);
    }
  }

  getCacheKey(file: TFile, additionalContext?: string): string {
    // Use file path, size and mtime for a unique but efficient cache key
    const metadata = `${file.path}:${file.stat.size}:${file.stat.mtime}${additionalContext ? `:${additionalContext}` : ""}`;
    return MD5(metadata).toString();
  }

  private getCachePath(cacheKey: string): string {
    return `${this.cacheDir}/${cacheKey}.md`;
  }

  private safeParseJSON(str: string): { success: boolean; data: any } {
    try {
      const parsed = JSON.parse(str);
      return { success: true, data: parsed };
    } catch {
      return { success: false, data: null };
    }
  }

  async get(cacheKey: string): Promise<T | null> {
    try {
      // Check memory cache first
      const memoryResult = this.memoryCache.get(cacheKey);
      if (memoryResult) {
        logInfo("Memory cache hit for file:", cacheKey);
        return memoryResult.content;
      }

      const cachePath = this.getCachePath(cacheKey);
      if (await app.vault.adapter.exists(cachePath)) {
        logInfo("File cache hit:", cacheKey);
        const cacheContent = await app.vault.adapter.read(cachePath);

        // Parse the markdown file format: <!-- CACHE_META:timestamp:contentType --> followed by content
        const lines = cacheContent.split("\n");
        if (lines.length === 0) {
          logError("Empty cache file, removing:", cacheKey);
          await this.remove(cacheKey);
          return null;
        }

        let timestamp = Date.now(); // fallback timestamp
        let contentType = "string"; // default content type
        let contentStartIndex = 0;

        // Check for metadata header
        const firstLine = lines[0];
        const metaMatch = firstLine.match(/^<!-- CACHE_META:(\d+):(string|json) -->$/);
        if (metaMatch) {
          timestamp = parseInt(metaMatch[1], 10);
          contentType = metaMatch[2];
          contentStartIndex = 1;
        }
        // NOTE: Legacy cache files (without metadata header) will use fallback values
        // but won't be automatically migrated to the new format. They will be
        // naturally replaced when the cache entries are updated.

        // Extract content (everything after the metadata line)
        const contentLines = lines.slice(contentStartIndex);
        const rawContent = contentLines.join("\n");

        let parsedContent: T;

        if (contentType === "json") {
          // Content was stored as JSON
          const parseResult = this.safeParseJSON(rawContent);
          if (!parseResult.success) {
            logError("Failed to parse JSON content from cache file, removing:", cacheKey);
            await this.remove(cacheKey);
            return null;
          }
          parsedContent = parseResult.data as T;
        } else {
          // Content is stored as plain text
          parsedContent = rawContent as T;
        }

        // Create cache entry with preserved timestamp
        const cacheEntry: FileCacheEntry<T> = {
          content: parsedContent,
          timestamp: timestamp,
        };

        // Store in memory cache
        this.memoryCache.set(cacheKey, cacheEntry);

        return cacheEntry.content;
      }

      logInfo("Cache miss for file:", cacheKey);
      return null;
    } catch (error) {
      logError("Error reading from file cache:", error);
      return null;
    }
  }

  async set(cacheKey: string, content: T): Promise<void> {
    try {
      await this.ensureCacheDir();
      const cachePath = this.getCachePath(cacheKey);

      const timestamp = Date.now();
      const cacheEntry: FileCacheEntry<T> = {
        content,
        timestamp,
      };

      // Store in memory cache
      this.memoryCache.set(cacheKey, cacheEntry);

      // Determine content type and serialize appropriately
      let serializedContent: string;
      let contentType: string;

      if (typeof content === "string") {
        // String content stored directly
        serializedContent = content;
        contentType = "string";
      } else {
        // Non-string content serialized as JSON
        serializedContent = JSON.stringify(content, null, 2);
        contentType = "json";
      }

      // Create markdown file with metadata header
      const fileContent = `<!-- CACHE_META:${timestamp}:${contentType} -->\n${serializedContent}`;

      await app.vault.adapter.write(cachePath, fileContent);
      logInfo("Cached file content:", cacheKey);
    } catch (error) {
      logError("Error writing to file cache:", error);
    }
  }

  async remove(cacheKey: string): Promise<void> {
    try {
      // Remove from memory cache
      this.memoryCache.delete(cacheKey);

      // Remove from file cache (markdown format)
      const cachePath = this.getCachePath(cacheKey);
      if (await app.vault.adapter.exists(cachePath)) {
        await app.vault.adapter.remove(cachePath);
        logInfo("Removed file from cache:", cacheKey);
      }
    } catch (error) {
      logError("Error removing file from cache:", error);
    }
  }

  async clear(): Promise<void> {
    try {
      // Clear memory cache
      this.memoryCache.clear();

      // Clear file cache
      if (await app.vault.adapter.exists(this.cacheDir)) {
        const files = await app.vault.adapter.list(this.cacheDir);
        logInfo("Clearing file cache, removing files:", files.files.length);

        for (const file of files.files) {
          await app.vault.adapter.remove(file);
        }
      }
    } catch (error) {
      logError("Error clearing file cache:", error);
    }
  }
}
