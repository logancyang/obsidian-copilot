import {
  FailedItem,
  getProjectContextLoadState,
  ProjectConfig,
  setProjectContextLoadState,
  updateProjectContextLoadState,
} from "@/aiParams";
import { ContextCache } from "@/cache/projectContextCache";
import { logInfo } from "@/logger";
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
    const state = getProjectContextLoadState();

    // note: we remove the failed file from the failed list when it starts processing
    updateProjectContextLoadState(
      "failed",
      state.failed.filter((file) => file.path !== key)
    );

    // Add to processing files list
    if (!state.processingFiles.includes(key)) {
      updateProjectContextLoadState("processingFiles", [...state.processingFiles, key]);
    }

    // Ensure file is in the total list
    if (!state.total.includes(key)) {
      updateProjectContextLoadState("total", [...state.total, key]);
    }
  }

  /**
   * Mark a process as successful
   */
  private setFileOrUrlProcessSuccessful(key: string): void {
    const state = getProjectContextLoadState();

    updateProjectContextLoadState(
      "processingFiles",
      state.processingFiles.filter((file) => file !== key)
    );

    if (!state.success.includes(key)) {
      updateProjectContextLoadState("success", [...state.success, key]);
    }
  }

  /**
   * Mark a process as failed
   */
  private setFileOrUrlProcessFailed(key: string, type: FailedItem["type"], error?: string): void {
    const state = getProjectContextLoadState();

    updateProjectContextLoadState(
      "processingFiles",
      state.processingFiles.filter((file) => file !== key)
    );

    // Check if this item is already in the failed list
    const existingFailed = state.failed.find((item) => item.path === key);
    if (!existingFailed) {
      const failedItem: FailedItem = {
        path: key,
        type,
        error,
        timestamp: Date.now(),
      };
      updateProjectContextLoadState("failed", [...state.failed, failedItem]);
    }
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
      updateProjectContextLoadState("total", uniqueItems);
      logInfo(
        `[preComputeAllItems] Project ${project.name}: Added ${allItems.length} items to tracking (${uniqueItems.length} total unique items)`
      );
    }
  }

  /**
   * Mark all cached items as successful
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
          `[markAllCachedItemsAsSuccess] Project ${
            project.name || "default"
          }: Marked ${cachedUrls.length} cached Web URLs as successful`
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
          `[markAllCachedItemsAsSuccess] Project ${
            project.name || "default"
          }: Marked ${cachedUrls.length} cached YouTube URLs as successful`
        );
      }
    }

    // 3. Mark all files present in fileContexts as successful
    if (contextCache.fileContexts) {
      const matchingFilesSet = new Set(projectAllFiles.map((file: TFile) => file.path));

      const cachedFilesToMark = Object.keys(contextCache.fileContexts).filter((filePath) =>
        matchingFilesSet.has(filePath)
      );

      cachedFilesToMark.forEach((filePath) => {
        this.markCachedItemAsSuccess(filePath);
      });

      if (cachedFilesToMark.length > 0) {
        logInfo(
          `[markAllCachedItemsAsSuccess] Project ${project.name || "default"}: Marked ${
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
    const state = getProjectContextLoadState();

    // Ensure the item is in the total list
    if (!state.total.includes(key)) {
      updateProjectContextLoadState("total", [...state.total, key]);
    }

    // Mark as successful directly
    if (!state.success.includes(key)) {
      updateProjectContextLoadState("success", [...state.success, key]);
    }
  }

  public makeItemFailed(key: string, type: FailedItem["type"], error?: string): void {
    const state = getProjectContextLoadState();
    // Ensure the item is in the total list
    if (!state.total.includes(key)) {
      updateProjectContextLoadState("total", [...state.total, key]);
    }

    // Check if this item is already in the failed list
    const existingFailed = state.failed.find((item) => item.path === key);
    if (!existingFailed) {
      const failedItem: FailedItem = {
        path: key,
        type,
        error,
        timestamp: Date.now(),
      };
      updateProjectContextLoadState("failed", [...state.failed, failedItem]);
    }
  }
}
