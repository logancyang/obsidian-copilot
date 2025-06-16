import { ProjectConfig } from "@/aiParams";
import { FileCache } from "@/cache/fileCache";
import { logError, logInfo, logWarn } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { MD5 } from "crypto-js";
import { TAbstractFile, TFile, Vault } from "obsidian";
import debounce from "lodash.debounce";

export interface ContextCache {
  // Markdown context
  markdownContext: string;
  markdownNeedsReload: boolean;

  // External content contexts
  webContexts: { [url: string]: string };
  youtubeContexts: { [url: string]: string };

  // File references (not the actual content)
  fileContexts: { [filePath: string]: { timestamp: number; cacheKey: string } };

  // Cache metadata
  timestamp: number;
}

/**
 * ProjectContextCache manages context for projects, including markdown files,
 * external web content, and other file types.
 *
 * The cache uses a two-level approach:
 * 1. Project-level context stored in .copilot/project-context-cache
 * 2. Individual file content stored in .copilot/file-content-cache
 */
export class ProjectContextCache {
  private static instance: ProjectContextCache;
  private cacheDir: string = ".copilot/project-context-cache";
  private memoryCache: Map<string, ContextCache> = new Map();
  private vault: Vault;
  private fileCache: FileCache<string>;
  private static readonly DEBOUNCE_DELAY = 5000; // 5 seconds

  private constructor() {
    this.vault = app.vault;
    this.fileCache = FileCache.getInstance<string>();
    this.initializeEventListeners();
  }

  static getInstance(): ProjectContextCache {
    if (!ProjectContextCache.instance) {
      ProjectContextCache.instance = new ProjectContextCache();
    }
    return ProjectContextCache.instance;
  }

  //===========================================================================
  // LIFECYCLE AND EVENT HANDLING
  //===========================================================================

  /**
   * Clean up resources used by the cache
   */
  public cleanup() {
    this.debouncedHandleFileChange.cancel();
    this.vault.off("create", this.handleFileEvent);
    this.vault.off("modify", this.handleFileEvent);
    this.vault.off("delete", this.handleFileEvent);
    this.vault.off("rename", this.handleFileEvent);
  }

  private initializeEventListeners() {
    // Monitor file events
    this.vault.on("create", this.handleFileEvent);
    this.vault.on("modify", this.handleFileEvent);
    this.vault.on("delete", this.handleFileEvent);
    this.vault.on("rename", this.handleFileEvent);
  }

  private handleFileEvent = (file: TAbstractFile) => {
    if (file instanceof TFile) {
      this.debouncedHandleFileChange(file);
    }
  };

  private handleFileChange = async (file: TFile) => {
    try {
      // Only process markdown files
      if (file.extension !== "md") {
        return;
      }

      const settings = getSettings();
      const projects = settings.projectList || [];

      // Check each project to see if the file matches its patterns
      for (const project of projects) {
        const { inclusions, exclusions } = getMatchingPatterns({
          inclusions: project.contextSource.inclusions,
          exclusions: project.contextSource.exclusions,
          isProject: true,
        });

        if (shouldIndexFile(file, inclusions, exclusions)) {
          // Only invalidate markdown context, keep other contexts
          await this.invalidateMarkdownContext(project);
          logInfo(
            `Invalidated markdown context for project ${project.name} due to file change: ${file.path}`
          );
        }
      }
    } catch (error) {
      logError("Error handling file change for project context cache:", error);
    }
  };

  private debouncedHandleFileChange = debounce(
    (file: TFile) => {
      void this.handleFileChange(file);
    },
    ProjectContextCache.DEBOUNCE_DELAY,
    {
      leading: true,
      trailing: true,
    }
  );

  //===========================================================================
  // BASE CACHE OPERATIONS
  //===========================================================================

  private async ensureCacheDir() {
    if (!(await this.vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating project context cache directory:", this.cacheDir);
      await this.vault.adapter.mkdir(this.cacheDir);
    }
  }

  private getCacheKey(project: ProjectConfig): string {
    // Use project ID as cache key
    return MD5(project.id).toString();
  }

  private getCachePath(cacheKey: string): string {
    return `${this.cacheDir}/${cacheKey}.json`;
  }

  async get(project: ProjectConfig): Promise<ContextCache | null> {
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
        const contextCache = JSON.parse(cacheContent);
        // Store in memory cache
        this.memoryCache.set(cacheKey, contextCache);
        return contextCache;
      }
      logInfo("Cache miss for project:", project.name);
      return null;
    } catch (error) {
      logError("Error reading from project context cache:", error);
      return null;
    }
  }

  getSync(project: ProjectConfig): ContextCache | null {
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

  async set(project: ProjectConfig, contextCache: ContextCache): Promise<void> {
    try {
      await this.ensureCacheDir();
      const cacheKey = this.getCacheKey(project);
      const cachePath = this.getCachePath(cacheKey);
      logInfo("Caching context for project:", project.name);
      // Store in memory cache
      this.memoryCache.set(cacheKey, contextCache);
      // Store in file cache
      await this.vault.adapter.write(cachePath, JSON.stringify(contextCache));
    } catch (error) {
      logError("Error writing to project context cache:", error);
    }
  }

  private createEmptyCache(): ContextCache {
    return {
      markdownContext: "",
      webContexts: {},
      youtubeContexts: {},
      fileContexts: {},
      timestamp: Date.now(),
      markdownNeedsReload: false,
    };
  }

  //===========================================================================
  // CLEANUP OPERATIONS
  //===========================================================================

  /**
   * Clear all cached data for all projects
   */
  async clearAllCache(): Promise<void> {
    try {
      // Get all projects first to collect file keys to remove
      const allFileKeysToRemove = new Set<string>();

      // Process all projects to get their file cache keys
      for (const projectCache of Array.from(this.memoryCache.values())) {
        if (projectCache?.fileContexts) {
          // Collect all file cache keys for this project
          for (const filePath in projectCache.fileContexts) {
            if (projectCache.fileContexts[filePath]?.cacheKey) {
              allFileKeysToRemove.add(projectCache.fileContexts[filePath].cacheKey);
            }
          }
        }
      }

      // Clear memory cache
      this.memoryCache.clear();

      // Clear project context files
      if (await this.vault.adapter.exists(this.cacheDir)) {
        const files = await this.vault.adapter.list(this.cacheDir);
        logInfo("Clearing project context cache, removing files:", files.files.length);
        await Promise.all(files.files.map((file) => this.vault.adapter.remove(file)));
      }

      // Only remove the file cache entries that were referenced by projects
      for (const cacheKey of allFileKeysToRemove) {
        await this.fileCache.remove(cacheKey);
      }

      logInfo(
        `Cleared ${allFileKeysToRemove.size} file content cache entries associated with projects`
      );
    } catch (error) {
      logError("Error clearing project context cache:", error);
    }
  }

  /**
   * Clear all cached data for a specific project
   */
  async clearForProject(project: ProjectConfig): Promise<void> {
    try {
      logInfo(`[clearForProject] Starting for project: ${project.name} (ID: ${project.id})`);
      const projectCacheKey = this.getCacheKey(project);

      const projectCache = await this.get(project);
      let filesClearedCount = 0;

      if (projectCache?.fileContexts) {
        const fileContextKeys = Object.keys(projectCache.fileContexts);
        if (fileContextKeys.length > 0) {
          logInfo(
            `[clearForProject] Project ${project.name}: Found ${fileContextKeys.length} file contexts to remove from FileCache.`
          );
          for (const filePath in projectCache.fileContexts) {
            const fileEntry = projectCache.fileContexts[filePath];
            if (fileEntry && fileEntry.cacheKey) {
              await this.fileCache.remove(fileEntry.cacheKey); // fileCache.remove logs its own success/failure per file
              filesClearedCount++;
            } else {
              logWarn(
                `[clearForProject] Project ${project.name}: Skipped removing FileCache entry for file ${filePath} due to missing cacheKey.`
              );
            }
          }
          logInfo(
            `[clearForProject] Project ${project.name}: Attempted to clear ${filesClearedCount} entries from FileCache.`
          );
        }
      } else {
        logInfo(
          `[clearForProject] Project ${project.name}: No fileContexts found in existing project cache to clear from FileCache.`
        );
      }

      this.memoryCache.delete(projectCacheKey);
      logInfo(
        `[clearForProject] Project ${project.name}: Removed from ProjectContextCache memory.`
      );

      const cachePath = this.getCachePath(projectCacheKey);
      if (await this.vault.adapter.exists(cachePath)) {
        await this.vault.adapter.remove(cachePath);
        logInfo(
          `[clearForProject] Project ${project.name}: Successfully removed main project cache file: ${cachePath}`
        );
      } else {
        logInfo(
          `[clearForProject] Project ${project.name}: Main project cache file not found (already deleted or never existed): ${cachePath}`
        );
      }
      logInfo(`[clearForProject] Completed for project: ${project.name}`);
    } catch (error) {
      logError(`[clearForProject] Error for project ${project.name} (ID: ${project.id}):`, error);
    }
  }

  //===========================================================================
  // MARKDOWN CONTEXT OPERATIONS
  //===========================================================================

  /**
   * Invalidate markdown context for a project.
   * This marks it for rebuilding while preserving web and file contexts unless forced.
   */
  async invalidateMarkdownContext(
    project: ProjectConfig,
    forceReloadAllRemotes: boolean = false
  ): Promise<void> {
    const cache = await this.get(project);
    if (cache) {
      cache.markdownContext = "";
      cache.markdownNeedsReload = true;

      if (forceReloadAllRemotes) {
        cache.webContexts = {};
        cache.youtubeContexts = {};
        logInfo(`Flagged Web/YouTube contexts for full reload for project ${project.name}`);
      }

      await this.set(project, cache);

      // Also clean up any file references that no longer match the project's patterns
      await this.cleanupProjectFileReferences(project);

      logInfo(`Invalidated markdown context for project ${project.name}`);
    }
  }

  /**
   * Update the markdown context for a project
   */
  async updateMarkdownContext(project: ProjectConfig, content: string): Promise<void> {
    const cache = (await this.get(project)) || this.createEmptyCache();
    cache.markdownContext = content;
    cache.markdownNeedsReload = false;
    await this.set(project, cache);
    logInfo(`Updated markdown context for project ${project.name}`);
  }

  /**
   * Clear only the markdown context for a project
   */
  async clearMarkdownContext(project: ProjectConfig): Promise<void> {
    const cache = await this.get(project);
    if (cache) {
      cache.markdownContext = "";
      cache.markdownNeedsReload = true;
      await this.set(project, cache);
    }
  }

  //===========================================================================
  // FILE CONTEXT OPERATIONS
  //   Non-markdown files cached in fileCache after processing by FileParserManager
  //===========================================================================

  /**
   * Get content for a specific file in a project
   */
  async getFileContext(project: ProjectConfig, filePath: string): Promise<string | null> {
    try {
      // Ensure filePath is valid before proceeding
      if (!filePath || typeof filePath !== "string") {
        logError("Error getting file context: filePath is invalid.", {
          project: project.name,
          filePath,
        });
        return null;
      }

      const cache = await this.get(project);
      if (!cache || !cache.fileContexts || !cache.fileContexts[filePath]) {
        // Log if filePath itself is not in fileContexts, which is a valid scenario for a miss that FileCache.get will log
        // No need for specific logging here if it's just a standard miss.
        // FileCache.get will log "Cache miss for file: <key>" if the key is valid but not found.
        // If cache.fileContexts[filePath] is missing, cacheKey will be undefined below, leading to that log.
        return null;
      }

      const fileContextEntry = cache.fileContexts[filePath];

      // Check if cacheKey exists and is a non-empty string
      if (
        !fileContextEntry ||
        !fileContextEntry.cacheKey ||
        typeof fileContextEntry.cacheKey !== "string" ||
        fileContextEntry.cacheKey.trim() === ""
      ) {
        logWarn(
          `Missing, invalid, or empty cacheKey for filePath: ${filePath} in project ${project.name}. Entry will be treated as a cache miss.`,
          { project: project.name, filePath, fileContextEntry }
        );
        // Logged as "Cache miss for file: undefined" by fileCache.get if cacheKey is undefined/null.
        // If cacheKey is an empty string, fileCache.get might also log it or handle it as a miss.
        // Returning null here ensures it's treated as a miss by the caller.
        // The FileCache.get call below will receive 'undefined' if cacheKey is problematic here and log appropriately.
        return null;
      }

      const { cacheKey } = fileContextEntry;
      // Ensure cacheKey is actually a string before passing to fileCache.get
      // This handles cases where fileContextEntry might exist but cacheKey is null or not a string.
      if (typeof cacheKey !== "string") {
        logWarn(
          `cacheKey is not a string for filePath: ${filePath} in project ${project.name}. Treating as cache miss.`,
          { project: project.name, filePath, cacheKey }
        );
        return null; // This will prevent fileCache.get from being called with a non-string.
      }

      return await this.fileCache.get(cacheKey); // fileCache.get already logs "Cache miss for file:"
    } catch (error) {
      logError(`Error getting file context for ${filePath} in project ${project.name}:`, error);
      return null;
    }
  }

  /**
   * Add or update a file in a project's context
   */
  async setFileContext(project: ProjectConfig, filePath: string, content: string): Promise<void> {
    try {
      const cache = (await this.get(project)) || this.createEmptyCache();
      if (!cache.fileContexts) {
        cache.fileContexts = {};
      }

      // Create a unique cache key for this file in this project
      const file = this.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Use project ID as additional context to ensure uniqueness
      const cacheKey = this.fileCache.getCacheKey(file, project.id);

      // Store the file content in FileCache
      await this.fileCache.set(cacheKey, content);

      // Store just the metadata in the project context
      cache.fileContexts[filePath] = {
        timestamp: Date.now(),
        cacheKey,
      };

      await this.set(project, cache);
      logInfo(`Added/updated file context for ${filePath} in project ${project.name}`);
    } catch (error) {
      logError(`Error setting file context for ${filePath}:`, error);
    }
  }

  /**
   * Remove a file from a project's context
   */
  async removeFileContext(project: ProjectConfig, filePath: string): Promise<void> {
    try {
      const cache = await this.get(project);
      if (cache && cache.fileContexts[filePath]) {
        // Get the cache key before removing from project cache
        const { cacheKey } = cache.fileContexts[filePath];

        // Remove from project cache
        delete cache.fileContexts[filePath];
        await this.set(project, cache);

        // Remove from file cache
        await this.fileCache.remove(cacheKey);

        logInfo(`Removed file context for ${filePath} in project ${project.name}`);
      }
    } catch (error) {
      logError(`Error removing file context for ${filePath}:`, error);
    }
  }

  /**
   * Update project file references based on inclusion/exclusion patterns.
   * Removes references to files that no longer match patterns, but keeps their content cached.
   */
  async cleanupProjectFileReferences(project: ProjectConfig): Promise<void> {
    try {
      const cache = await this.get(project);
      if (!cache || !cache.fileContexts) {
        return;
      }

      const { inclusions, exclusions } = getMatchingPatterns({
        inclusions: project.contextSource.inclusions,
        exclusions: project.contextSource.exclusions,
        isProject: true,
      });

      let removedCount = 0;
      const updatedFileContexts: typeof cache.fileContexts = {};

      // Check each file against the patterns
      for (const filePath in cache.fileContexts) {
        const file = this.vault.getAbstractFileByPath(filePath);

        // If file no longer exists or doesn't match patterns, remove its reference
        if (!(file instanceof TFile) || !shouldIndexFile(file, inclusions, exclusions)) {
          // Note: We don't remove from fileCache to preserve content for future use
          removedCount++;
        } else {
          // Keep the file reference if it still matches
          updatedFileContexts[filePath] = cache.fileContexts[filePath];
        }
      }

      // Only update if we actually removed something
      if (removedCount > 0) {
        cache.fileContexts = updatedFileContexts;
        await this.set(project, cache);
        logInfo(
          `Removed ${removedCount} file references from project ${project.name} that no longer match inclusion patterns`
        );
      }
    } catch (error) {
      logError(`Error cleaning up project file references for ${project.name}:`, error);
    }
  }

  /**
   * Check if files match the project's patterns and add them to the project context.
   * Uses existing file cache when available to avoid unnecessary processing.
   */
  async updateProjectFilesFromPatterns(
    project: ProjectConfig,
    contextCacheToUpdate: ContextCache
  ): Promise<ContextCache> {
    try {
      logInfo(`[updateProjectFilesFromPatterns] Starting for project: ${project.name}`);
      if (!contextCacheToUpdate.fileContexts) {
        contextCacheToUpdate.fileContexts = {};
      }

      const { inclusions, exclusions } = getMatchingPatterns({
        inclusions: project.contextSource.inclusions,
        exclusions: project.contextSource.exclusions,
        isProject: true,
      });

      const allFiles = this.vault.getFiles();
      let addedCount = 0;

      for (const file of allFiles) {
        if (shouldIndexFile(file, inclusions, exclusions)) {
          if (contextCacheToUpdate.fileContexts[file.path]) {
            continue;
          }
          const cacheKey = this.fileCache.getCacheKey(file, project.id);
          contextCacheToUpdate.fileContexts[file.path] = {
            timestamp: Date.now(),
            cacheKey,
          };
          addedCount++;
        }
      }

      if (addedCount > 0) {
        logInfo(
          `[updateProjectFilesFromPatterns] Project ${project.name}: Added ${addedCount} new file references to context (in memory).`
        );
      }
      logInfo(
        `[updateProjectFilesFromPatterns] Completed for project: ${project.name}. Total fileContexts in memory: ${Object.keys(contextCacheToUpdate.fileContexts).length}`
      );
    } catch (error) {
      logError(`[updateProjectFilesFromPatterns] Error for project ${project.name}:`, error);
    }
    return contextCacheToUpdate;
  }

  //===========================================================================
  // WEB CONTEXT OPERATIONS
  //===========================================================================

  /**
   * Remove a web URL from a project's context
   */
  async removeWebUrl(project: ProjectConfig, url: string): Promise<void> {
    const cache = await this.get(project);
    if (cache?.webContexts?.[url]) {
      delete cache.webContexts[url];
      await this.set(project, cache);
      logInfo(`Removed web context for URL ${url} in project ${project.name}`);
    }
  }

  /**
   * Add or update a web URL in a project's context
   */
  async updateWebUrl(project: ProjectConfig, url: string, content: string): Promise<void> {
    const cache = (await this.get(project)) || this.createEmptyCache();
    if (!cache.webContexts) {
      cache.webContexts = {};
    }
    cache.webContexts[url] = content;
    await this.set(project, cache);
    logInfo(`Updated web context for URL ${url} in project ${project.name}`);
  }

  //===========================================================================
  // YOUTUBE CONTEXT OPERATIONS
  //===========================================================================

  /**
   * Remove a YouTube URL from a project's context
   */
  async removeYoutubeUrl(project: ProjectConfig, url: string): Promise<void> {
    const cache = await this.get(project);
    if (cache?.youtubeContexts?.[url]) {
      delete cache.youtubeContexts[url];
      await this.set(project, cache);
      logInfo(`Removed YouTube context for URL ${url} in project ${project.name}`);
    }
  }

  /**
   * Add or update a YouTube URL in a project's context
   */
  async updateYoutubeUrl(project: ProjectConfig, url: string, content: string): Promise<void> {
    const cache = (await this.get(project)) || this.createEmptyCache();
    if (!cache.youtubeContexts) {
      cache.youtubeContexts = {};
    }
    cache.youtubeContexts[url] = content;
    await this.set(project, cache);
    logInfo(`Updated YouTube context for URL ${url} in project ${project.name}`);
  }
}
