import { Pdf4llmResponse } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo } from "@/logger";
import { md5 } from "@/utils/hash";
import { TFile, Vault } from "obsidian";

export class PDFCache {
  private static instance: PDFCache;
  private cacheDir: string = ".copilot/pdf-cache";

  private constructor() {}

  static getInstance(): PDFCache {
    if (!PDFCache.instance) {
      PDFCache.instance = new PDFCache();
    }
    return PDFCache.instance;
  }

  private async ensureCacheDir(vault: Vault) {
    if (!(await vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating PDF cache directory:", this.cacheDir);
      await vault.adapter.mkdir(this.cacheDir);
    }
  }

  private getCacheKey(file: TFile): string {
    // Use file path, size and mtime for a unique but efficient cache key
    const metadata = `${file.path}:${file.stat.size}:${file.stat.mtime}`;
    const key = md5(metadata);
    logInfo("Generated cache key for PDF:", { path: file.path, key });
    return key;
  }

  private getCachePath(cacheKey: string): string {
    return `${this.cacheDir}/${cacheKey}.json`;
  }

  async get(vault: Vault, file: TFile): Promise<Pdf4llmResponse | null> {
    try {
      const cacheKey = this.getCacheKey(file);
      const cachePath = this.getCachePath(cacheKey);

      if (await vault.adapter.exists(cachePath)) {
        logInfo("Cache hit for PDF:", file.path);
        const cacheContent = await vault.adapter.read(cachePath);
        return JSON.parse(cacheContent) as Pdf4llmResponse;
      }
      logInfo("Cache miss for PDF:", file.path);
      return null;
    } catch (error) {
      logError("Error reading from PDF cache:", error);
      return null;
    }
  }

  async set(vault: Vault, file: TFile, response: Pdf4llmResponse): Promise<void> {
    try {
      await this.ensureCacheDir(vault);
      const cacheKey = this.getCacheKey(file);
      const cachePath = this.getCachePath(cacheKey);
      logInfo("Caching PDF response for:", file.path);
      await vault.adapter.write(cachePath, JSON.stringify(response));
    } catch (error) {
      logError("Error writing to PDF cache:", error);
    }
  }

  async clear(vault: Vault): Promise<void> {
    try {
      if (await vault.adapter.exists(this.cacheDir)) {
        const files = await vault.adapter.list(this.cacheDir);
        logInfo("Clearing PDF cache, removing files:", files.files.length);
        for (const file of files.files) {
          await vault.adapter.remove(file);
        }
      }
    } catch (error) {
      logError("Error clearing PDF cache:", error);
    }
  }
}
