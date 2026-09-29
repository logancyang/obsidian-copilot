import { logError, logInfo } from "@/logger";
import { md5 } from "@/utils/hash";
import { TFile, Vault } from "obsidian";

export interface FileCacheEntry<T> {
  content: T;
  timestamp: number;
}

export class FileCache<T> {
  private static instance: FileCache<unknown>;
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

  private async ensureCacheDir(vault: Vault) {
    if (!(await vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating file cache directory:", this.cacheDir);
      await vault.adapter.mkdir(this.cacheDir);
    }
  }

  getCacheKey(file: TFile, additionalContext?: string): string {
    const metadata = `${file.path}:${file.stat.size}:${file.stat.mtime}${additionalContext ? `:${additionalContext}` : ""}`;
    return md5(metadata);
  }

  private getCachePath(cacheKey: string): string {
    return `${this.cacheDir}/${cacheKey}.md`;
  }

  async get(vault: Vault, cacheKey: string): Promise<T | null> {
    try {
      const memoryResult = this.memoryCache.get(cacheKey);
      if (memoryResult) {
        logInfo("Memory cache hit for file:", cacheKey);
        return memoryResult.content;
      }

      const cachePath = this.getCachePath(cacheKey);
      if (await vault.adapter.exists(cachePath)) {
        logInfo("File cache hit:", cacheKey);
        const cacheContent = await vault.adapter.read(cachePath);

        let parsedContent: T;

        const trimmedContent = cacheContent.trim();
        if (
          (trimmedContent.startsWith("{") && trimmedContent.endsWith("}")) ||
          (trimmedContent.startsWith("[") && trimmedContent.endsWith("]"))
        ) {
          try {
            parsedContent = JSON.parse(cacheContent);
          } catch {
            parsedContent = cacheContent as T;
          }
        } else {
          parsedContent = cacheContent as T;
        }

        const cacheEntry: FileCacheEntry<T> = {
          content: parsedContent,
          timestamp: Date.now(),
        };

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

  async set(vault: Vault, cacheKey: string, content: T): Promise<void> {
    try {
      await this.ensureCacheDir(vault);
      const cachePath = this.getCachePath(cacheKey);

      const timestamp = Date.now();
      const cacheEntry: FileCacheEntry<T> = {
        content,
        timestamp,
      };

      this.memoryCache.set(cacheKey, cacheEntry);

      let serializedContent: string;
      if (typeof content === "string") {
        serializedContent = content;
      } else {
        serializedContent = JSON.stringify(content, null, 2);
      }

      await vault.adapter.write(cachePath, serializedContent);
      logInfo("Cached file content:", cacheKey);
    } catch (error) {
      logError("Error writing to file cache:", error);
    }
  }

  async clear(vault: Vault): Promise<void> {
    try {
      this.memoryCache.clear();

      if (await vault.adapter.exists(this.cacheDir)) {
        const files = await vault.adapter.list(this.cacheDir);
        logInfo("Clearing file cache, removing files:", files.files.length);

        for (const file of files.files) {
          await vault.adapter.remove(file);
        }
      }
    } catch (error) {
      logError("Error clearing file cache:", error);
    }
  }
}
