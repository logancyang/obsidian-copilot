import { ProjectConfig } from "@/aiParams";
import { FileCache } from "@/cache/fileCache";
import { logError, logInfo, logWarn } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { MD5 } from "crypto-js";
import { TAbstractFile, TFile, Vault } from "obsidian";
import debounce from "lodash.debounce";
import { Mutex } from "async-mutex";

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
  private projectMutexMap: Map<string, Mutex> = new Map();
  private mutexCreationMutex: Mutex = new Mutex(); // Global lock to protect project mutex creation

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

    // Clean up project mutexes
    this.projectMutexMap.clear();
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

        if (shouldIndexFile(file, inclusions, exclusions, true)) {
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

  private async getOrCreateProjectMutex(project: ProjectConfig): Promise<Mutex> {
    const projectId = project.id;

    // Quick check without lock for performance
    const existingMutex = this.projectMutexMap.get(projectId);
    if (existingMutex) {
      return existingMutex;
    }

    // Use global lock to ensure atomic creation
    return await this.mutexCreationMutex.runExclusive(async () => {
      // Double-check inside the lock
      const mutex = this.projectMutexMap.get(projectId);
      if (mutex) {
        return mutex;
      }

      // Create new mutex safely
      const newMutex = new Mutex();
      this.projectMutexMap.set(projectId, newMutex);
      logInfo(`Created new mutex for project: ${project.name} (ID: ${projectId})`);

      return newMutex;
    });
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

  async getOrInitializeCache(project: ProjectConfig): Promise<ContextCache> {
    const initialProjectCache = await this.get(project);

    if (initialProjectCache) {
      logInfo(
        `[getOrInitializeCache] Project ${project.name}: Existing cache found. MarkdownNeedsReload: ${initialProjectCache.markdownNeedsReload}`
      );
      return initialProjectCache;
    }

    logInfo(
      `[getOrInitializeCache] Project ${project.name}: No existing cache found, building fresh context.`
    );

    const newCache = this.createEmptyCache();
    await this.setWithoutMutex(project, newCache);
    return newCache;
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

  private async set(project: ProjectConfig, contextCache: ContextCache): Promise<void> {
    const mutex = await this.getOrCreateProjectMutex(project);

    if (mutex.isLocked()) {
      logInfo(`Waiting for project cache lock for project: ${project.name}`);
    }

    return await mutex.runExclusive(async () => {
      logInfo(`Acquired cache lock for project: ${project.name}`);
      return await this.setWithoutMutex(project, contextCache);
    });
  }

  private async setWithoutMutex(project: ProjectConfig, contextCache: ContextCache): Promise<void> {
    try {
      await this.ensureCacheDir();
      const cacheKey = this.getCacheKey(project);
      const cachePath = this.getCachePath(cacheKey);
      logInfo("Caching context for project:", project.name);

      // Create a deep copy to avoid reference issues
      const contextCacheCopy = JSON.parse(JSON.stringify(contextCache));

      // Store in memory cache
      this.memoryCache.set(cacheKey, contextCacheCopy);

      // Store in file cache
      await this.vault.adapter.write(cachePath, JSON.stringify(contextCacheCopy));
    } catch (error) {
      logError("Error writing to project context cache:", error);
      throw error; // Re-throw to maintain error propagation
    }
  }

  private createEmptyCache(): ContextCache {
    return {
      markdownContext: "",
      webContexts: {},
      youtubeContexts: {},
      fileContexts: {},
      timestamp: Date.now(),
      markdownNeedsReload: true,
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
      // Clean up the mutex for this project to prevent memory leaks
      this.projectMutexMap.delete(project.id);
      logInfo(`[clearForProject] Cleaned up mutex for project: ${project.name}`);

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
    await this.updateCacheSafely(
      project,
      (cache) => {
        cache.markdownContext = "";
        cache.markdownNeedsReload = true;

        if (forceReloadAllRemotes) {
          cache.webContexts = {};
          cache.youtubeContexts = {};
          logInfo(`Flagged Web/YouTube contexts for full reload for project ${project.name}`);
        }

        // Also clean up any file references that no longer match the project's patterns
        const cleanedCache = this.cleanupFileReferencesInCache(project, cache);

        logInfo(`Invalidated markdown context for project ${project.name}`);
        return cleanedCache;
      },
      true
    );
  }

  /**
   * Update the markdown context for a project
   */
  async updateMarkdownContext(project: ProjectConfig, content: string): Promise<void> {
    return await this.updateCacheSafely(project, (cache) => {
      cache.markdownContext = content;
      cache.markdownNeedsReload = false;
      logInfo(`Updated markdown context for project ${project.name}`);
      return cache;
    });
  }

  /**
   * Clear only the markdown context for a project
   */
  async clearMarkdownContext(project: ProjectConfig): Promise<void> {
    await this.updateCacheSafely(project, (cache) => {
      cache.markdownContext = "";
      cache.markdownNeedsReload = true;
      return cache;
    });
  }

  //===========================================================================
  // FILE CONTEXT OPERATIONS
  //   Non-markdown files cached in fileCache after processing by FileParserManager
  //===========================================================================

  /**
   * Get file content from project cache or reuse from universal cache if available
   * This method efficiently searches across all available caches to find file content
   */
  async getOrReuseFileContext(project: ProjectConfig, filePath: string): Promise<string | null> {
    try {
      // 1. Try to get from project cache first
      const projectContent = await this.getFileContext(project, filePath);
      if (projectContent) {
        return projectContent;
      }

      // 2. Search other projects as fallback
      const result = await this.searchOtherProjectsForFile(filePath);
      if (result) {
        // Associate with current project
        await this.associateCacheWithProject(project, filePath, result.cacheKey);
        logInfo(
          `Reused cached content from other project for: ${filePath} in project ${project.name}`
        );
        return result.content;
      }

      // No content found in any cache
      return null;
    } catch (error) {
      logError(`Error in getOrReuseFileContext for ${filePath} in project ${project.name}:`, error);
      return null;
    }
  }

  /**
   * Get content for a specific file in a project
   */
  protected async getFileContext(project: ProjectConfig, filePath: string): Promise<string | null> {
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
    return await this.updateCacheSafelyAsync(project, async (cache) => {
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

      logInfo(`Added/updated file context for ${filePath} in project ${project.name}`);
      return cache;
    });
  }

  /**
   * Remove a file from a project's context
   */
  async removeFileContext(project: ProjectConfig, filePath: string): Promise<void> {
    return await this.updateCacheSafelyAsync(project, async (cache) => {
      if (cache.fileContexts && cache.fileContexts[filePath]) {
        // Get the cache key before removing from project cache
        const { cacheKey } = cache.fileContexts[filePath];

        // Remove from project cache
        delete cache.fileContexts[filePath];

        // Remove from file cache
        await this.fileCache.remove(cacheKey);

        logInfo(`Removed file context for ${filePath} in project ${project.name}`);
      }
      return cache;
    });
  }

  /**
   * Search all existing projects for cached content of a file
   * If found, migrate that content to universal cache and return it
   */
  private async searchOtherProjectsForFile(
    filePath: string
  ): Promise<{ cacheKey: string; content: string } | null> {
    try {
      const settings = getSettings();
      const projects = settings.projectList || [];

      if (projects.length === 0) {
        return null;
      }

      logInfo(`Searching other projects for file: ${filePath}`);

      for (const project of projects) {
        // Skip projects without cache
        const cache = await this.get(project);
        if (!cache || !cache.fileContexts) {
          continue;
        }

        // Check if this project has the file cached
        if (cache.fileContexts[filePath]) {
          const { cacheKey } = cache.fileContexts[filePath];
          if (!cacheKey) continue;

          // Try to get content from this project's cache
          const content = await this.fileCache.get(cacheKey);
          if (content) {
            logInfo(`Found content for file ${filePath} in project ${project.name}`);
            return { content, cacheKey };
          }
        }
      }

      logInfo(`No content found in any project for file: ${filePath}`);
      return null;
    } catch (error) {
      logError(`Error searching other projects for file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Associate an existing cache with a specific project, creates the project reference to that cache
   */
  async associateCacheWithProject(
    project: ProjectConfig,
    filePath: string,
    cacheKey: string
  ): Promise<void> {
    return await this.updateCacheSafelyAsync(project, async (cache) => {
      if (!cache.fileContexts) {
        cache.fileContexts = {};
      }

      // Update project context to reference the other cache key directly
      cache.fileContexts[filePath] = {
        timestamp: Date.now(),
        cacheKey: cacheKey,
      };

      logInfo(`Associated cache with project ${project.name} for file: ${filePath}`);
      return cache;
    });
  }

  /**
   * Helper method to perform file reference cleanup logic on a cache object
   */
  private cleanupFileReferencesInCache(project: ProjectConfig, cache: ContextCache): ContextCache {
    if (!cache.fileContexts) {
      return cache;
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
      if (!(file instanceof TFile) || !shouldIndexFile(file, inclusions, exclusions, true)) {
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
      logInfo(
        `Removed ${removedCount} file references from project ${project.name} that no longer match inclusion patterns`
      );
    }

    return cache;
  }

  /**
   * Update project file references based on inclusion/exclusion patterns.
   * Removes references to files that no longer match patterns, but keeps their content cached.
   */
  async cleanupProjectFileReferences(project: ProjectConfig): Promise<void> {
    logInfo(`[cleanupProjectFileReferences] Starting for project: ${project.name}`);
    try {
      await this.updateCacheSafely(
        project,
        (cache) => this.cleanupFileReferencesInCache(project, cache),
        true
      );
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
        if (shouldIndexFile(file, inclusions, exclusions, true)) {
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

  updateProjectMarkdownFilesFromPatterns(
    project: ProjectConfig,
    contextCacheToUpdate: ContextCache,
    projectAllFiles: TFile[]
  ): ContextCache {
    try {
      if (!contextCacheToUpdate.fileContexts) {
        contextCacheToUpdate.fileContexts = {};
      }

      const allFiles = projectAllFiles.filter((file) => file.extension === "md");
      let addedCount = 0;

      for (const file of allFiles) {
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

      if (addedCount > 0) {
        logInfo(
          `[updateProjectFilesFromPatterns] Project ${project.name}: Added ${addedCount} new file references to context (in memory).`
        );
      }

      logInfo(
        `[updateProjectFilesFromPatterns] Completed for project: ${project.name}. Total markdown fileContexts in memory: ${Object.keys(contextCacheToUpdate.fileContexts).length}`
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
   * Remove a web URLs from a project's context
   */

  async removeWebUrls(project: ProjectConfig, urls: string[]): Promise<void> {
    if (!urls.length) return;

    await this.updateCacheSafely(project, (cache) => {
      if (cache.webContexts) {
        for (const url of urls) {
          if (cache.webContexts[url]) {
            delete cache.webContexts[url];
          }
        }
        logInfo(`Removed web contexts for URLs ${urls.join(", ")} in project ${project.name}`);
      }
      return cache;
    });
  }

  /**
   * Add or update a web URL in a project's context
   */
  async updateWebUrl(project: ProjectConfig, url: string, content: string): Promise<void> {
    return await this.updateCacheSafely(project, (cache) => {
      if (!cache.webContexts) {
        cache.webContexts = {};
      }
      cache.webContexts[url] = content;
      logInfo(`Updated web context for URL ${url} in project ${project.name}`);
      return cache;
    });
  }

  //===========================================================================
  // YOUTUBE CONTEXT OPERATIONS
  //===========================================================================

  /**
   * Remove a YouTube URLs from a project's context
   */

  async removeYoutubeUrls(project: ProjectConfig, urls: string[]): Promise<void> {
    if (!urls.length) return;

    await this.updateCacheSafely(project, (cache) => {
      if (cache.youtubeContexts) {
        for (const url of urls) {
          if (cache.youtubeContexts[url]) {
            delete cache.youtubeContexts[url];
          }
        }
        logInfo(
          `removeYoutubeUrls: Removed YouTube contexts for URLs ${urls.join(", ")} in project ${project.name}`
        );
      }
      return cache;
    });
  }

  /**
   * Add or update a YouTube URL in a project's context
   */
  async updateYoutubeUrl(project: ProjectConfig, url: string, content: string): Promise<void> {
    return await this.updateCacheSafely(project, (cache) => {
      if (!cache.youtubeContexts) {
        cache.youtubeContexts = {};
      }
      cache.youtubeContexts[url] = content;
      logInfo(`Updated YouTube context for URL ${url} in project ${project.name}`);
      return cache;
    });
  }

  //===========================================================================
  // EXTERNAL SAFE OPERATIONS
  //===========================================================================

  /**
   * Safe external method for bulk cache updates
   * This is for external modules that need to perform complex updates safely
   * @param project
   * @param updateFn
   * @param skipIfEmpty - If true, skip the update when cache is empty instead of throwing an error
   */
  async updateCacheSafely(
    project: ProjectConfig,
    updateFn: (cache: ContextCache) => ContextCache,
    skipIfEmpty: boolean = false
  ): Promise<void> {
    const mutex = await this.getOrCreateProjectMutex(project);

    return await mutex.runExclusive(async () => {
      try {
        const cache = await this.get(project);
        if (!cache) {
          if (skipIfEmpty) {
            return;
          }
          throw new Error(
            `Project: ${project.name} context cache not found, please invoke getOrInitializeCache method before invoke update context cache`
          );
        }
        const updatedCache = updateFn(cache);
        await this.setWithoutMutex(project, updatedCache);
      } catch (error) {
        logError(`Error updating cache for project ${project.name}:`, error);
        throw error;
      }
    });
  }

  /**
   * Safe external method for async cache updates
   * This is for external modules that need to perform async updates safely
   * @param project
   * @param updateFn
   * @param skipIfEmpty - If true, skip the update when cache is empty instead of throwing an error
   */
  async updateCacheSafelyAsync(
    project: ProjectConfig,
    updateFn: (cache: ContextCache) => Promise<ContextCache>,
    skipIfEmpty: boolean = false
  ): Promise<void> {
    const mutex = await this.getOrCreateProjectMutex(project);

    return await mutex.runExclusive(async () => {
      try {
        const cache = await this.get(project);
        if (!cache) {
          if (skipIfEmpty) {
            return;
          }
          throw new Error(
            `Project: ${project.name} context cache not found, please invoke getOrInitializeCache method before invoke update context cache`
          );
        }
        const updatedCache = await updateFn(cache);
        await this.setWithoutMutex(project, updatedCache);
      } catch (error) {
        logError(`Error updating cache for project ${project.name}:`, error);
        throw error;
      }
    });
  }

  /**
   * Safe external method for setting complete cache
   * Use this instead of direct set() calls from external modules
   */
  async setCacheSafely(project: ProjectConfig, contextCache: ContextCache): Promise<void> {
    const mutex = await this.getOrCreateProjectMutex(project);

    return await mutex.runExclusive(async () => {
      logInfo(`External safe set for project: ${project.name}`);
      return await this.setWithoutMutex(project, contextCache);
    });
  }
}
