import { ProjectConfig } from "@/aiParams";
import { logError, logInfo } from "@/logger";
import { MD5 } from "crypto-js";
import { App, TAbstractFile, TFile, Vault } from "obsidian";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";

const DEBOUNCE_DELAY = 5000; // 5 seconds

export class ProjectContextCache {
  private static instance: ProjectContextCache;
  private cacheDir: string = ".copilot/project-context-cache";
  private memoryCache: Map<string, string> = new Map();
  private vault: Vault;
  private debounceTimer: number | null = null;

  private constructor(private app: App) {
    this.vault = app.vault;
    this.initializeEventListeners();
  }

  static getInstance(app: App): ProjectContextCache {
    if (!ProjectContextCache.instance) {
      ProjectContextCache.instance = new ProjectContextCache(app);
    }
    return ProjectContextCache.instance;
  }

  private handleFileEvent = (file: TAbstractFile) => {
    if (file instanceof TFile) {
      this.debouncedHandleFileChange(file);
    }
  };

  private initializeEventListeners() {
    // Monitor file events
    this.vault.on("create", this.handleFileEvent);
    this.vault.on("modify", this.handleFileEvent);
    this.vault.on("delete", this.handleFileEvent);
    this.vault.on("rename", this.handleFileEvent);
  }

  private debouncedHandleFileChange = (file: TFile) => {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.handleFileChange(file);
      this.debounceTimer = null;
    }, DEBOUNCE_DELAY);
  };

  private async handleFileChange(file: TFile) {
    try {
      // enable markdown file
      if (file.extension !== "md") {
        return;
      }

      const settings = getSettings();
      const projects = settings.projectList || [];

      // check if the project needs to clear cache
      await Promise.all([
        projects.map(async (project) => {
          const { inclusions, exclusions } = getMatchingPatterns({
            inclusions: project.contextSource.inclusions,
            exclusions: project.contextSource.exclusions,
            isProject: true,
          });

          if (shouldIndexFile(file, inclusions, exclusions)) {
            // clear cache
            await this.clearForProject(project);
            logInfo(
              `Cleared context cache for project ${project.name} due to file change: ${file.path}`
            );
          }
        }),
      ]);
    } catch (error) {
      logError("Error handling file change for project context cache:", error);
    }
  }

  private async ensureCacheDir() {
    if (!(await this.vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating project context cache directory:", this.cacheDir);
      await this.vault.adapter.mkdir(this.cacheDir);
    }
  }

  private getCacheKey(project: ProjectConfig): string {
    // Use project ID, system prompt, and context sources for a unique cache key
    const metadata = JSON.stringify({
      id: project.id,
      contextSource: project.contextSource,
      systemPrompt: project.systemPrompt,
    });
    const key = MD5(metadata).toString();
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
      if (await this.vault.adapter.exists(cachePath)) {
        logInfo("File cache hit for project:", project.name);
        const cacheContent = await this.vault.adapter.read(cachePath);
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
      await this.vault.adapter.write(
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

  async clearAllCache(): Promise<void> {
    try {
      // Clear memory cache
      this.memoryCache.clear();
      // Clear file cache
      if (await this.vault.adapter.exists(this.cacheDir)) {
        const files = await this.vault.adapter.list(this.cacheDir);
        logInfo("Clearing project context cache, removing files:", files.files.length);
        await Promise.all([files.files.map((file) => this.vault.adapter.remove(file))]);
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
      if (await this.vault.adapter.exists(cachePath)) {
        logInfo("Clearing cache for project:", project.name);
        await this.vault.adapter.remove(cachePath);
      }
    } catch (error) {
      logError("Error clearing cache for project:", error);
    }
  }

  public cleanup() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.vault.off("create", this.handleFileEvent);
    this.vault.off("modify", this.handleFileEvent);
    this.vault.off("delete", this.handleFileEvent);
    this.vault.off("rename", this.handleFileEvent);
  }
}
