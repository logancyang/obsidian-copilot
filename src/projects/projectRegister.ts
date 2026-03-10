import { getCurrentProject, setCurrentProject } from "@/aiParams";
import { logError, logInfo, logWarn } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import {
  ensureProjectFrontmatter,
  getProjectsFolder,
  isProjectConfigFile,
  parseProjectConfigFile,
} from "@/projects/projectUtils";
import {
  deleteCachedProjectRecordByFilePath,
  getCachedProjectRecordByFilePath,
  getCachedProjectRecordById,
  isPendingFileWrite,
  replaceCachedProjectRecordByFilePath,
  updateCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { loadAllProjects } from "@/projects/projectUtils";
import { PROJECT_CONFIG_FILE_NAME, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import debounce from "lodash.debounce";
import { Notice, TAbstractFile, Vault } from "obsidian";

/**
 * Project Register: manages vault event listeners and cache synchronization.
 * Aligned with system-prompts Register pattern.
 *
 * Responsibilities:
 * - Auto-sync project.md create/modify/delete/rename to in-memory cache
 * - Listen for projectsFolder setting changes with latest-wins reload
 * - Avoid event loops from pending file writes
 */
export class ProjectRegister {
  private vault: Vault;
  private manager: ProjectFileManager;
  private settingsUnsubscriber?: () => void;
  /** Monotonic request id for latest-wins semantics on folder change. */
  private folderChangeRequestId = 0;
  /** Per-file debounced modify handlers to avoid cross-file debounce collisions. */
  private fileModifyDebouncers = new Map<string, ReturnType<typeof debounce>>();

  constructor(vault: Vault) {
    this.vault = vault;
    this.manager = ProjectFileManager.getInstance(vault);
    this.initializeEventListeners();
  }

  /**
   * Initialize: load all projects (internally runs read-side fallback migration).
   */
  async initialize(): Promise<void> {
    await this.manager.initialize();
  }

  /**
   * Cleanup event listeners (called on plugin unload).
   */
  cleanup(): void {
    for (const d of this.fileModifyDebouncers.values()) d.cancel();
    this.fileModifyDebouncers.clear();
    this.debouncedFolderChange.cancel();
    this.settingsUnsubscriber?.();

    this.vault.off("create", this.handleFileCreation);
    this.vault.off("delete", this.handleFileDeletion);
    this.vault.off("rename", this.handleFileRename);
    this.vault.off("modify", this.handleFileModify);
  }

  /**
   * Wire up vault event listeners and settings subscription.
   */
  private initializeEventListeners(): void {
    this.vault.on("create", this.handleFileCreation);
    this.vault.on("delete", this.handleFileDeletion);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.settingsUnsubscriber = subscribeToSettingsChange(this.handleSettingsChange);
  }

  /**
   * Settings change handler: react to projectsFolder changes.
   */
  private handleSettingsChange = (
    prev: ReturnType<typeof getSettings>,
    next: ReturnType<typeof getSettings>
  ): void => {
    if (prev.projectsFolder !== next.projectsFolder) {
      this.debouncedFolderChange(next.projectsFolder);
    }
  };

  /**
   * Debounced folder change handler (avoid rapid-fire during user typing).
   */
  private debouncedFolderChange = debounce(
    (nextFolder: string) => {
      void this.handleProjectsFolderChange(nextFolder);
    },
    300,
    { leading: false, trailing: true }
  );

  /**
   * Handle projectsFolder change: success-then-replace reload with latest-wins.
   */
  private async handleProjectsFolderChange(nextFolder: string): Promise<void> {
    const currentRequestId = ++this.folderChangeRequestId;

    try {
      const nextRecords = await this.manager.fetchProjects();

      // Latest-wins: discard stale results
      if (currentRequestId !== this.folderChangeRequestId) return;

      // Reason: old folder's debouncers are stale after folder change
      for (const d of this.fileModifyDebouncers.values()) d.cancel();
      this.fileModifyDebouncers.clear();

      updateCachedProjectRecords(nextRecords);

      // Reason: re-apply legacy merge so unmigrated projects remain visible after folder change
      // (same logic as ProjectFileManager.initialize, guarded by storageVersion).
      this.manager.mergeLegacyProjectsIntoCache();

      // Reason: validate against post-merge cache (includes legacy projects) to avoid
      // incorrectly clearing selection for projects that still exist via legacy fallback.
      const current = getCurrentProject();
      if (current) {
        const stillExists = getCachedProjectRecordById(current.id);
        if (!stillExists) {
          setCurrentProject(null);
          new Notice(`Project "${current.name}" not found in new folder. Cleared selection.`);
        }
      }

      logInfo(`[Projects] Folder changed -> reloaded: ${nextFolder}`);
      new Notice(`Projects folder updated: ${nextFolder}`);
    } catch (error) {
      logError(`[Projects] Failed to reload after folder change: ${nextFolder}`, error);
    }
  }

  /**
   * String-level check if oldPath could be a project config path (for rename events).
   */
  private isProjectConfigPathString(oldPath: string): boolean {
    const folder = getProjectsFolder();
    if (!oldPath.startsWith(folder + "/")) return false;

    const relativePath = oldPath.slice(folder.length + 1);
    if (relativePath.startsWith(`${PROJECTS_UNSUPPORTED_FOLDER_NAME}/`)) return false;

    const parts = relativePath.split("/");
    return parts.length === 2 && parts[1] === PROJECT_CONFIG_FILE_NAME;
  }

  /**
   * File creation event: parse and upsert to cache; ensure frontmatter if needed.
   */
  private handleFileCreation = async (file: TAbstractFile) => {
    if (!isProjectConfigFile(file) || isPendingFileWrite(file.path)) return;

    try {
      const record = await parseProjectConfigFile(file);
      if (!record) return;

      // Duplicate id: keep first in cache, ignore incoming
      const existing = getCachedProjectRecordById(record.project.id);
      if (existing && existing.filePath !== record.filePath) {
        logWarn(
          `[Projects] Duplicate id="${record.project.id}": ` +
            `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
        );
        return;
      }

      await ensureProjectFrontmatter(file, record);
      const updated = await parseProjectConfigFile(file);
      if (updated) upsertCachedProjectRecord(updated);
    } catch (error) {
      logError(`[Projects] Error on file creation: ${file.path}`, error);
    }
  };

  /**
   * File deletion event: remove from cache by filePath.
   * If deleted project is currently selected, clear the selection.
   */
  private handleFileDeletion = async (file: TAbstractFile) => {
    if (!isProjectConfigFile(file) || isPendingFileWrite(file.path)) return;

    this.evictFileModifyDebouncer(file.path);

    try {
      const record = getCachedProjectRecordByFilePath(file.path);
      deleteCachedProjectRecordByFilePath(file.path);

      // Reason: if the deleted file was the current project, clear selection to avoid UI pointing
      // to a non-existent project (aligned with system-prompts delete handler).
      if (record) {
        const current = getCurrentProject();
        if (current?.id === record.project.id) {
          setCurrentProject(null);
          new Notice(`Project "${record.project.name}" was deleted.`);
        }

        // Reason: rescan to re-admit any previously-ignored duplicate-id files
        // that were hidden while the deleted file was the "kept" entry.
        void loadAllProjects().catch((err) =>
          logError("[Projects] Rescan after delete failed", err)
        );
      }
    } catch (error) {
      logError(`[Projects] Error on file deletion: ${file.path}`, error);
    }
  };

  /**
   * File rename event: sync cache for old/new paths.
   * If renamed out of projects folder and was current project, clear selection.
   */
  private handleFileRename = async (file: TAbstractFile, oldPath: string) => {
    if (isPendingFileWrite(file.path) || isPendingFileWrite(oldPath)) return;

    const wasValid = this.isProjectConfigPathString(oldPath);
    const isValidNow = isProjectConfigFile(file);

    if (!wasValid && !isValidNow) return;

    if (wasValid) this.evictFileModifyDebouncer(oldPath);

    try {
      const oldRecord = wasValid ? getCachedProjectRecordByFilePath(oldPath) : undefined;
      if (wasValid) deleteCachedProjectRecordByFilePath(oldPath);

      // Reason: project moved out of projects folder → clear current selection
      if (wasValid && !isValidNow && oldRecord) {
        const current = getCurrentProject();
        if (current?.id === oldRecord.project.id) {
          setCurrentProject(null);
          new Notice(`Project "${oldRecord.project.name}" was moved.`);
        }
      }

      if (isValidNow) {
        const record = await parseProjectConfigFile(file);
        if (!record) return;

        const existing = getCachedProjectRecordById(record.project.id);
        if (existing && existing.filePath !== record.filePath) {
          logWarn(
            `[Projects] Duplicate id="${record.project.id}" after rename: ` +
              `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
          );
          return;
        }

        await ensureProjectFrontmatter(file, record);
        const updated = await parseProjectConfigFile(file);
        if (updated) upsertCachedProjectRecord(updated);
      }
    } catch (error) {
      logError(`[Projects] Error on file rename: ${oldPath} -> ${file.path}`, error);
    }
  };

  /** Cancel and remove a per-file debouncer (on delete/rename/folder change). */
  private evictFileModifyDebouncer(filePath: string): void {
    const d = this.fileModifyDebouncers.get(filePath);
    if (d) {
      d.cancel();
      this.fileModifyDebouncers.delete(filePath);
    }
  }

  /**
   * Process a single file modify: parse and update cache.
   */
  private async processFileModify(file: TAbstractFile): Promise<void> {
    // Reason: second guard — a new pending write may have started during the debounce window
    if (!isProjectConfigFile(file) || isPendingFileWrite(file.path)) return;

    try {
      const record = await parseProjectConfigFile(file);
      if (!record) return;

      const existing = getCachedProjectRecordById(record.project.id);
      if (existing && existing.filePath !== record.filePath) {
        // Reason: another file already owns this id. Still remove any stale entry for this
        // filePath (e.g. user changed frontmatter id to a conflicting value).
        deleteCachedProjectRecordByFilePath(file.path);
        logWarn(
          `[Projects] Duplicate id="${record.project.id}" on modify: ` +
            `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
        );
        return;
      }

      // Reason: single atomic write avoids transient gap where subscribers see the project disappear
      replaceCachedProjectRecordByFilePath(file.path, record);
    } catch (error) {
      logError(`[Projects] Error on file modify: ${file.path}`, error);
    }
  }

  /**
   * Get or create a per-file debounced modify handler.
   * Reason: per-file debounce avoids cross-file collisions where modifying projectA
   * within the debounce window of projectB would drop projectB's cache update.
   */
  private getFileModifyDebouncer(filePath: string): ReturnType<typeof debounce> {
    let d = this.fileModifyDebouncers.get(filePath);
    if (!d) {
      d = debounce(
        (file: TAbstractFile) => {
          void this.processFileModify(file);
        },
        1000,
        { leading: false, trailing: true }
      );
      this.fileModifyDebouncers.set(filePath, d);
    }
    return d;
  }

  /**
   * File modify event: filter pending writes at event time (before debounce),
   * so the guard is checked when the event fires, not 1s later when the pending flag
   * may already be cleared. Uses per-file debounce to avoid cross-file collisions.
   */
  private handleFileModify = (file: TAbstractFile): void => {
    if (!isProjectConfigFile(file) || isPendingFileWrite(file.path)) return;
    this.getFileModifyDebouncer(file.path)(file);
  };
}
