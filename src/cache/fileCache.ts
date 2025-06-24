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

        // Since we're using .md extension, content is primarily string-based
        // Only attempt JSON parsing if content was originally serialized as JSON
        let parsedContent: T;

        // Check if content starts with JSON markers (object/array)
        const trimmedContent = cacheContent.trim();
        if (
          (trimmedContent.startsWith("{") && trimmedContent.endsWith("}")) ||
          (trimmedContent.startsWith("[") && trimmedContent.endsWith("]"))
        ) {
          try {
            // Only parse as JSON if it looks like serialized JSON
            parsedContent = JSON.parse(cacheContent);
          } catch {
            // If JSON parsing fails, treat as string content
            parsedContent = cacheContent as T;
          }
        } else {
          // For non-JSON-like content, treat as string
          parsedContent = cacheContent as T;
        }

        // Create cache entry for memory storage with proper timestamp handling
        const cacheEntry: FileCacheEntry<T> = {
          content: parsedContent,
          timestamp: Date.now(), // Note: file-based cache doesn't preserve original timestamp
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

      const cacheEntry: FileCacheEntry<T> = {
        content,
        timestamp: Date.now(),
      };

      // Store in memory cache
      this.memoryCache.set(cacheKey, cacheEntry);

      // Serialize content properly for file storage
      let serializedContent: string;
      if (typeof content === "string") {
        // If content is already a string, use it directly
        serializedContent = content;
      } else {
        // For non-string content, serialize as JSON
        serializedContent = JSON.stringify(content, null, 2);
      }

      await app.vault.adapter.write(cachePath, serializedContent);
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
