import { getCurrentProject } from "@/aiParams";
import { ProjectContextCache } from "@/cache/projectContextCache";
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
  getCachedProjectRecords,
  isPendingFileWrite,
  replaceCachedProjectRecordByFilePath,
  updateCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { loadAllProjects } from "@/projects/projectUtils";
import { PROJECT_CONFIG_FILE_NAME, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { debounce } from "@/utils/debounce";
import { App, Notice, TAbstractFile, Vault } from "obsidian";

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

  constructor(app: App) {
    this.vault = app.vault;
    this.manager = ProjectFileManager.getInstance(app);
  }

  /**
   * Initialize: register vault listeners and load all projects.
   *
   * Reason: listeners must be registered here (not in the constructor) because
   * the constructor runs during plugin onload(), before onLayoutReady(). Obsidian's
   * Vault.on("create") fires for every existing file during the initial vault load,
   * which would trigger premature cache mutations and ensureProjectFrontmatter writes
   * before migration has completed. Deferring to initialize() (called from
   * onLayoutReady) avoids this race.
   */
  async initialize(): Promise<void> {
    this.initializeEventListeners();
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
    1000,
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

      // Reason: await old cache clears before installing new records to prevent
      // same-id race: fire-and-forget clears could delete freshly rebuilt cache.
      const oldRecords = getCachedProjectRecords();
      const cache = ProjectContextCache.getInstance();
      await Promise.all(
        oldRecords.map((old) =>
          cache
            .clearForProject(old.project)
            .catch((err) =>
              logError("[Projects] Failed to clear context cache on folder switch", err)
            )
        )
      );

      updateCachedProjectRecords(nextRecords);

      // Reason: don't call setCurrentProject(null) here — ProjectManager's
      // records subscriber will detect the disappearance after updateCachedProjectRecords
      // and handle save-first ordering via switchProject(null).
      const current = getCurrentProject();
      if (current) {
        const stillExists = getCachedProjectRecordById(current.id);
        if (!stillExists) {
          new Notice(`Project "${current.name}" not found in new folder. Cleared selection.`);
        }
      }

      logInfo(`[Projects] Folder changed -> reloaded: ${nextFolder}`);
      new Notice(`Projects folder updated: ${nextFolder}`);
    } catch (error) {
      // Reason: latest-wins guard — discard stale failure from an earlier request
      // that resolved after a newer successful reload.
      if (currentRequestId !== this.folderChangeRequestId) return;

      // Reason: clear stale cache on failure to avoid split-brain storage where
      // creates go to the new folder while edits/deletes target old cached paths.
      for (const d of this.fileModifyDebouncers.values()) d.cancel();
      this.fileModifyDebouncers.clear();

      // Reason: clear context caches before wiping records to prevent same-id
      // projects from reusing stale context on a later retry.
      const oldRecords = getCachedProjectRecords();
      const cache = ProjectContextCache.getInstance();
      await Promise.all(
        oldRecords.map((old) =>
          cache
            .clearForProject(old.project)
            .catch((err) =>
              logError("[Projects] Failed to clear context cache on folder switch failure", err)
            )
        )
      );

      updateCachedProjectRecords([]);

      logError(`[Projects] Failed to reload after folder change: ${nextFolder}`, error);
      new Notice(
        `Failed to reload projects from "${nextFolder}". Projects cleared — reopen settings to retry.`
      );
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
        // Reason: don't call setCurrentProject(null) here — ProjectManager's
        // records subscriber will detect the disappearance and handle save-first
        // ordering via switchProject(null) to avoid misclassifying the chat.
        const current = getCurrentProject();
        if (current?.id === record.project.id) {
          new Notice(`Project "${record.project.name}" was deleted.`);
        }

        // Reason: await cache clear to prevent same-ID recreation from having its
        // fresh cache wiped by a stale async cleanup. Consistent with folder-switch path.
        await ProjectContextCache.getInstance()
          .clearForProject(record.project)
          .catch((err) =>
            logError("[Projects] Failed to clear context cache on external delete", err)
          );

        // Reason: rescan to re-admit any previously-ignored duplicate-id files
        // that were hidden while the deleted file was the "kept" entry.
        // Re-merge legacy projects after rescan so unmigrated fallback entries stay visible.
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

      // Reason: validate the new file before deleting the old cache entry,
      // so a duplicate-ID rename doesn't leave a cache gap.
      if (isValidNow) {
        const record = await parseProjectConfigFile(file);
        if (!record) {
          if (wasValid) deleteCachedProjectRecordByFilePath(oldPath);
          return;
        }

        // Reason: check for duplicate ID, but exclude the old record being renamed
        // (self-rename: existing.filePath === oldPath means it's the same project).
        const existing = getCachedProjectRecordById(record.project.id);
        const isTrueDuplicate =
          existing && existing.filePath !== record.filePath && existing.filePath !== oldPath;

        if (isTrueDuplicate) {
          if (wasValid) deleteCachedProjectRecordByFilePath(oldPath);
          logWarn(
            `[Projects] Duplicate id="${record.project.id}" after rename: ` +
              `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
          );
          return;
        }

        await ensureProjectFrontmatter(file, record);
        const updated = await parseProjectConfigFile(file);
        if (updated) {
          // Reason: use atomic replace to avoid transient disappearance gap.
          // delete+upsert causes the subscriber to see the active project as missing
          // and trigger switchProject(null) during valid renames.
          if (wasValid) {
            replaceCachedProjectRecordByFilePath(oldPath, updated);
          } else {
            upsertCachedProjectRecord(updated);
          }
        } else if (wasValid) {
          deleteCachedProjectRecordByFilePath(oldPath);
        }
      } else if (wasValid) {
        deleteCachedProjectRecordByFilePath(oldPath);
      }

      // Reason: project moved out of projects folder → clear current selection and context cache
      if (wasValid && !isValidNow && oldRecord) {
        // Reason: don't call setCurrentProject(null) here — ProjectManager's
        // records subscriber handles save-first ordering via switchProject(null).
        const current = getCurrentProject();
        if (current?.id === oldRecord.project.id) {
          new Notice(`Project "${oldRecord.project.name}" was moved.`);
        }

        // Reason: await cache clear to prevent same-ID recreation from having its
        // fresh cache wiped by a stale async cleanup. Consistent with folder-switch path.
        await ProjectContextCache.getInstance()
          .clearForProject(oldRecord.project)
          .catch((err) => logError("[Projects] Failed to clear context cache on rename-out", err));

        // Reason: rescan to re-admit any previously-ignored duplicate-id files
        // that were hidden while the moved file was the "kept" entry.
        void loadAllProjects().catch((err) =>
          logError("[Projects] Rescan after rename-out failed", err)
        );
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
      if (!record) {
        // Reason: file became invalid YAML — remove stale cache entry and clear selection
        // if this was the active project, so UI and chain don't use stale config.
        const staleRecord = getCachedProjectRecordByFilePath(file.path);
        deleteCachedProjectRecordByFilePath(file.path);
        if (staleRecord) {
          void ProjectContextCache.getInstance()
            .clearForProject(staleRecord.project)
            .catch((err) =>
              logError("[Projects] Failed to clear context cache on invalid edit", err)
            );
          // Reason: rescan to re-admit previously-ignored duplicate-id files
          void loadAllProjects().catch((err) =>
            logError("[Projects] Rescan after invalid edit failed", err)
          );
        }
        return;
      }

      const existing = getCachedProjectRecordById(record.project.id);
      if (existing && existing.filePath !== record.filePath) {
        // Reason: another file already owns this id. Remove stale entry.
        const staleRecord = getCachedProjectRecordByFilePath(file.path);
        deleteCachedProjectRecordByFilePath(file.path);
        if (staleRecord) {
          void ProjectContextCache.getInstance()
            .clearForProject(staleRecord.project)
            .catch((err) =>
              logError("[Projects] Failed to clear context cache on duplicate edit", err)
            );
          // Reason: rescan to re-admit previously-ignored duplicate-id files
          void loadAllProjects().catch((err) =>
            logError("[Projects] Rescan after duplicate edit failed", err)
          );
        }
        logWarn(
          `[Projects] Duplicate id="${record.project.id}" on modify: ` +
            `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
        );
        return;
      }

      // Reason: if the user edited copilot-project-id directly, clear the old id's
      // context cache to prevent stale context resurrection when the old id is reused.
      const oldRecord = getCachedProjectRecordByFilePath(file.path);
      if (oldRecord && oldRecord.project.id !== record.project.id) {
        await ProjectContextCache.getInstance()
          .clearForProject(oldRecord.project)
          .catch((err) => logError("[Projects] Failed to clear context cache on id change", err));
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
