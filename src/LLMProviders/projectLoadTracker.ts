import {
  getProjectContextLoadState,
  updateProjectContextLoadState,
  setProjectContextLoadState,
  ProjectConfig,
} from "@/aiParams";
import { ContextCache } from "@/cache/projectContextCache";
import { logInfo } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { TFile } from "obsidian";

/**
 * ProjectLoadTracker is responsible for managing the progress tracking of project file processing
 */
export class ProjectLoadTracker {
  private static instance: ProjectLoadTracker;
  private currentProjectId: string | null;

  private constructor() {
    this.currentProjectId = null;
  }

  public static getInstance(): ProjectLoadTracker {
    if (!ProjectLoadTracker.instance) {
      ProjectLoadTracker.instance = new ProjectLoadTracker();
    }
    return ProjectLoadTracker.instance;
  }

  public setCurrentProjectId(projectId: string | null): void {
    this.currentProjectId = projectId;
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
  public async executeWithProcessTracking<T>(key: string, operation: () => Promise<T>): Promise<T> {
    this.setFileOrUrlStartProcess(key);
    try {
      const result = await operation();
      this.setFileOrUrlProcessSuccessful(key);
      return result;
    } catch (error) {
      this.setFileOrUrlProcessFailed(key);
      throw error; // throw error to outer layer
    }
  }

  /**
   * Mark a file or URL as processing started
   */
  private setFileOrUrlStartProcess(key: string): void {
    const state = getProjectContextLoadState();

    logInfo(
      `[setFileOrUrlStartProcess] Project ${this.currentProjectId}: Marking file/url as processing started: ${key}`
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

    logInfo(
      `[setFileOrUrlProcessSuccessful] Project ${this.currentProjectId}: Marking file/url as successfully processed: ${key}`
    );

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
  private setFileOrUrlProcessFailed(key: string): void {
    const state = getProjectContextLoadState();

    logInfo(
      `[setFileOrUrlProcessFailed] Project ${this.currentProjectId}: Marking file/url as failed: ${key}`
    );

    updateProjectContextLoadState(
      "processingFiles",
      state.processingFiles.filter((file) => file !== key)
    );

    if (!state.failed.includes(key)) {
      updateProjectContextLoadState("failed", [...state.failed, key]);
    }
  }

  /**
   * Pre-compute all items that need to be processed in the project
   */
  public preComputeAllItems(project: ProjectConfig, contextCache: ContextCache, app: any): void {
    logInfo(`[preComputeAllItems] Starting pre-computation for project: ${project.name}`);

    const allItems: string[] = [];

    // 1. Count all matching files (markdown and non-markdown)
    if (project.contextSource?.inclusions || project.contextSource?.exclusions) {
      const { inclusions: inclusionPatterns, exclusions: exclusionPatterns } = getMatchingPatterns({
        inclusions: project.contextSource?.inclusions,
        exclusions: project.contextSource?.exclusions,
        isProject: true,
      });

      const allMatchingFiles = app.vault.getFiles().filter((file: TFile) => {
        return shouldIndexFile(file, inclusionPatterns, exclusionPatterns);
      });

      // Add all matching file paths to the list
      allItems.push(...allMatchingFiles.map((file: TFile) => file.path));
    }

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
   * Mark a cached item as successful
   */
  public markCachedItemAsSuccess(key: string): void {
    const state = getProjectContextLoadState();

    logInfo(
      `[markCachedItemAsSuccess] Project ${this.currentProjectId}: Marking cached item as successful: ${key}`
    );

    // Ensure the item is in the total list
    if (!state.total.includes(key)) {
      updateProjectContextLoadState("total", [...state.total, key]);
    }

    // Mark as successful directly
    if (!state.success.includes(key)) {
      updateProjectContextLoadState("success", [...state.success, key]);
    }
  }
}
