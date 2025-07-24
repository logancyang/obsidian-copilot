import {
  FailedItem,
  ProjectConfig,
  projectContextLoadAtom,
  setProjectContextLoadState,
  updateProjectContextLoadState,
} from "@/aiParams";
import { ContextCache } from "@/cache/projectContextCache";
import { logInfo } from "@/logger";
import { settingsStore } from "@/settings/model";
import { err2String } from "@/utils";
import { App, TFile } from "obsidian";
import { isRateLimitError } from "@/utils/rateLimitUtils";

/**
 * ProjectLoadTracker is responsible for managing the progress tracking of project file processing
 */
export class ProjectLoadTracker {
  private static instance: ProjectLoadTracker;
  private app: App;

  private constructor(app: App) {
    this.app = app;
  }

  public static getInstance(app: App): ProjectLoadTracker {
    if (!ProjectLoadTracker.instance) {
      ProjectLoadTracker.instance = new ProjectLoadTracker(app);
    }
    return ProjectLoadTracker.instance;
  }

  /**
   * Clear all project context loading states
   */
  public clearAllLoadStates(): void {
    setProjectContextLoadState({
      success: [],
      failed: [],
      processingFiles: [],
      total: [],
    });
  }

  /**
   * Wrap an operation and track its execution status
   */
  public async executeWithProcessTracking<T>(
    key: string,
    type: FailedItem["type"],
    operation: () => Promise<T>
  ): Promise<T> {
    this.setFileOrUrlStartProcess(key);
    try {
      const result = await operation();
      this.setFileOrUrlProcessSuccessful(key);
      return result;
    } catch (error) {
      const errorMessage = isRateLimitError(error)
        ? "Rate limit exceeded. (Rate limit: 50 files or 100MB per 3 hours, whichever is reached first)"
        : err2String(error);

      this.setFileOrUrlProcessFailed(key, type, errorMessage);
      throw error; // throw error to outer layer
    }
  }

  /**
   * Mark a file or URL as processing started
   */
  private setFileOrUrlStartProcess(key: string): void {
    settingsStore.set(projectContextLoadAtom, (prev) => {
      const newState = { ...prev };

      // note: we remove the failed file from the failed list when it starts processing
      if (newState.failed.find((item) => item.path === key)) {
        newState.failed = newState.failed.filter((file) => file.path !== key);
      }

      // note: we remove the success file from the success list when it starts processing
      // For the case where the file cacheKey still exists, but the actual cached content is missing
      if (newState.success.includes(key)) {
        newState.success = newState.success.filter((file) => file !== key);
      }

      // Add to processing files list
      if (!newState.processingFiles.includes(key)) {
        newState.processingFiles = [...newState.processingFiles, key];
      }

      // Ensure file is in the total list
      if (!newState.total.includes(key)) {
        newState.total = [...newState.total, key];
      }

      return newState;
    });
  }

  /**
   * Mark a process as successful
   */
  private setFileOrUrlProcessSuccessful(key: string): void {
    updateProjectContextLoadState("processingFiles", (prev) => prev.filter((file) => file !== key));
    updateProjectContextLoadState("success", (prev) => {
      if (!prev.includes(key)) {
        return [...prev, key];
      }
      return prev;
    });
  }

  /**
   * Mark a process as failed
   */
  private setFileOrUrlProcessFailed(key: string, type: FailedItem["type"], error?: string): void {
    updateProjectContextLoadState("processingFiles", (prev) => prev.filter((file) => file !== key));

    updateProjectContextLoadState("failed", (prev) => {
      const existingFailed = prev.find((item) => item.path === key);
      if (!existingFailed) {
        const failedItem: FailedItem = {
          path: key,
          type,
          error,
          timestamp: Date.now(),
        };
        return [...prev, failedItem];
      }
      return prev;
    });
  }

  /**
   * Pre-compute all items that need to be processed in the project
   */
  public preComputeAllItems(project: ProjectConfig, projectAllFiles: TFile[]): void {
    logInfo(`[preComputeAllItems] Starting pre-computation for project: ${project.name}`);

    const allItems: string[] = [];

    // 1. Count all matching files (markdown and non-markdown)
    // Add all matching file paths to the list
    allItems.push(...projectAllFiles.map((file: TFile) => file.path));

    // 2. Count all Web URLs
    const configuredWebUrls = project.contextSource?.webUrls?.trim() || "";
    if (configuredWebUrls) {
      const webUrls = configuredWebUrls.split("\n").filter((url) => url.trim());
      allItems.push(...webUrls);
    }

    // 3. Count all YouTube URLs
    const configuredYoutubeUrls = project.contextSource?.youtubeUrls?.trim() || "";
    if (configuredYoutubeUrls) {
      const youtubeUrls = configuredYoutubeUrls.split("\n").filter((url) => url.trim());
      allItems.push(...youtubeUrls);
    }

    // Add all items to the total list
    if (allItems.length > 0) {
      const uniqueItems = [...new Set([...allItems])];
      updateProjectContextLoadState("total", (_) => uniqueItems);
      logInfo(
        `[preComputeAllItems] Project ${project.name}: Added ${allItems.length} items to tracking (${uniqueItems.length} total unique items)`
      );
    }
  }

  /**
   * Mark all cached items(besides Non-markdown files) as successful
   */
  public markAllCachedItemsAsSuccess(
    project: ProjectConfig,
    contextCache: ContextCache,
    projectAllFiles: TFile[]
  ): void {
    logInfo(`[markAllCachedItemsAsSuccess] Starting for project: ${project.name || "default"}`);

    // 1. Mark cached Web URLs
    const configuredWebUrls = project.contextSource?.webUrls?.trim() || "";
    if (configuredWebUrls) {
      const urlsInConfig = configuredWebUrls.split("\n").filter((url) => url.trim());
      const cachedUrls = urlsInConfig.filter((url) => contextCache.webContexts[url]);
      cachedUrls.forEach((url) => {
        this.markCachedItemAsSuccess(url);
      });
      if (cachedUrls.length > 0) {
        logInfo(
          `[markAllCachedItemsAsSuccess] Project ${project.name}: Marked ${cachedUrls.length} cached Web URLs as successful`
        );
      }
    }

    // 2. Mark cached YouTube URLs
    const configuredYoutubeUrls = project.contextSource?.youtubeUrls?.trim() || "";
    if (configuredYoutubeUrls) {
      const urlsInConfig = configuredYoutubeUrls.split("\n").filter((url) => url.trim());
      const cachedUrls = urlsInConfig.filter((url) => contextCache.youtubeContexts[url]);
      cachedUrls.forEach((url) => {
        this.markCachedItemAsSuccess(url);
      });
      if (cachedUrls.length > 0) {
        logInfo(
          `[markAllCachedItemsAsSuccess] Project ${project.name}: Marked ${cachedUrls.length} cached YouTube URLs as successful`
        );
      }
    }

    // 3. Only mark markdown files present in fileContexts as successful, does not include Non-markdown files.
    // because track Non-markdown in the processNonMarkdownFiles method
    if (contextCache.fileContexts) {
      // only for markdown files
      const matchingFilesSet = new Set(
        projectAllFiles.filter((file) => file.extension === "md").map((file: TFile) => file.path)
      );

      const cachedFilesToMark = Object.keys(contextCache.fileContexts).filter((filePath) =>
        matchingFilesSet.has(filePath)
      );

      cachedFilesToMark.forEach((filePath) => {
        this.markCachedItemAsSuccess(filePath);
      });

      if (cachedFilesToMark.length > 0) {
        logInfo(
          `[markAllCachedItemsAsSuccess] Project ${project.name}: Marked ${
            cachedFilesToMark.length
          } cached files that match current project patterns as successful.`
        );
      }
    }
  }

  /**
   * Mark a cached item as successful
   */
  public markCachedItemAsSuccess(key: string): void {
    updateProjectContextLoadState("total", (prev) => {
      if (!prev.includes(key)) {
        return [...prev, key];
      }
      return prev;
    });

    // Mark as successful directly
    updateProjectContextLoadState("success", (prev) => {
      if (!prev.includes(key)) {
        return [...prev, key];
      }
      return prev;
    });
  }

  public makeItemFailed(key: string, type: FailedItem["type"], error?: string): void {
    updateProjectContextLoadState("total", (prev) => {
      if (!prev.includes(key)) {
        return [...prev, key];
      }
      return prev;
    });

    // Check if this item is already in the failed list
    updateProjectContextLoadState("failed", (prev) => {
      const existingFailed = prev.find((item) => item.path === key);
      if (!existingFailed) {
        const failedItem: FailedItem = {
          path: key,
          type,
          error,
          timestamp: Date.now(),
        };
        return [...prev, failedItem];
      }
      return prev;
    });
  }
}
