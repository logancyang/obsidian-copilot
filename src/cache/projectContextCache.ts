import { ProjectConfig } from "@/aiParams";
import { logError, logInfo } from "@/logger";
import { MD5 } from "crypto-js";

export class ProjectContextCache {
  private static instance: ProjectContextCache;
  private cacheDir: string = ".copilot/project-context-cache";
  private memoryCache: Map<string, string> = new Map();

  private constructor() {}

  static getInstance(): ProjectContextCache {
    if (!ProjectContextCache.instance) {
      ProjectContextCache.instance = new ProjectContextCache();
    }
    return ProjectContextCache.instance;
  }

  private async ensureCacheDir() {
    if (!(await app.vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating project context cache directory:", this.cacheDir);
      await app.vault.adapter.mkdir(this.cacheDir);
    }
  }

  private getCacheKey(project: ProjectConfig): string {
    // Use project ID, system prompt, and context sources for a unique cache key
    logInfo("Generating cache key for project context:", project.contextSource);
    const metadata = JSON.stringify({
      id: project.id,
      contextSource: project.contextSource,
      systemPrompt: project.systemPrompt,
    });
    const key = MD5(metadata).toString();
    logInfo("Generated cache key for project:", { name: project.name, key });
    return key;
  }

  private getCachePath(cacheKey: string): string {
    return `${this.cacheDir}/${cacheKey}.json`;
  }

  async get(project: ProjectConfig): Promise<string | null> {
    try {
      const cacheKey = this.getCacheKey(project);

      // Check memory cache first
      const memoryResult = this.memoryCache.get(cacheKey);
      if (memoryResult) {
        logInfo("Memory cache hit for project:", project.name);
        return memoryResult;
      }

      const cachePath = this.getCachePath(cacheKey);
      if (await app.vault.adapter.exists(cachePath)) {
        logInfo("File cache hit for project:", project.name);
        const cacheContent = await app.vault.adapter.read(cachePath);
        const context = JSON.parse(cacheContent).context;
        // Store in memory cache
        this.memoryCache.set(cacheKey, context);
        return context;
      }
      logInfo("Cache miss for project:", project.name);
      return null;
    } catch (error) {
      logError("Error reading from project context cache:", error);
      return null;
    }
  }

  getSync(project: ProjectConfig): string | null {
    try {
      const cacheKey = this.getCacheKey(project);
      const memoryResult = this.memoryCache.get(cacheKey);
      if (memoryResult) {
        logInfo("Memory cache hit for project:", project.name);
        return memoryResult;
      }
      logInfo("Memory cache miss for project:", project.name);
      return null;
    } catch (error) {
      logError("Error reading from project context memory cache:", error);
      return null;
    }
  }

  async set(project: ProjectConfig, context: string): Promise<void> {
    try {
      await this.ensureCacheDir();
      const cacheKey = this.getCacheKey(project);
      const cachePath = this.getCachePath(cacheKey);
      logInfo("Caching context for project:", project.name);
      // Store in memory cache
      this.memoryCache.set(cacheKey, context);
      // Store in file cache
      await app.vault.adapter.write(
        cachePath,
        JSON.stringify({
          context,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      logError("Error writing to project context cache:", error);
    }
  }

  async clear(): Promise<void> {
    try {
      // Clear memory cache
      this.memoryCache.clear();
      // Clear file cache
      if (await app.vault.adapter.exists(this.cacheDir)) {
        const files = await app.vault.adapter.list(this.cacheDir);
        logInfo("Clearing project context cache, removing files:", files.files.length);
        for (const file of files.files) {
          await app.vault.adapter.remove(file);
        }
      }
    } catch (error) {
      logError("Error clearing project context cache:", error);
    }
  }

  async clearForProject(project: ProjectConfig): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(project);
      // Clear from memory cache
      this.memoryCache.delete(cacheKey);
      // Clear from file cache
      const cachePath = this.getCachePath(cacheKey);
      if (await app.vault.adapter.exists(cachePath)) {
        logInfo("Clearing cache for project:", project.name);
        await app.vault.adapter.remove(cachePath);
      }
    } catch (error) {
      logError("Error clearing cache for project:", error);
    }
  }
}
