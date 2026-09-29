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
import { deriveProjectsFolder } from "@/settings/copilotFolder";
import type { StartupMigrationItem } from "@/services/startupMigration";
import { debounce, type DebouncedFunction } from "@/utils/debounce";
import { App, Notice, TAbstractFile, Vault } from "obsidian";

export class ProjectRegister {
  private app: App;
  private vault: Vault;
  private manager: ProjectFileManager;
  private settingsUnsubscriber?: () => void;
  private folderChangeRequestId = 0;
  private fileModifyDebouncers = new Map<
    string,
    DebouncedFunction<(file: TAbstractFile) => void>
  >();

  constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.manager = ProjectFileManager.getInstance(app);
  }

  async initialize(): Promise<StartupMigrationItem | null> {
    this.initializeEventListeners();
    return this.manager.initialize();
  }

  cleanup(): void {
    for (const d of this.fileModifyDebouncers.values()) d.cancel();
    this.fileModifyDebouncers.clear();
    this.debouncedFolderChange.cancel();
    this.folderChangeRequestId++;
    this.settingsUnsubscriber?.();

    this.vault.off("create", this.handleFileCreation);
    this.vault.off("delete", this.handleFileDeletion);
    this.vault.off("rename", this.handleFileRename);
    this.vault.off("modify", this.handleFileModify);
  }

  private initializeEventListeners(): void {
    this.vault.on("create", this.handleFileCreation);
    this.vault.on("delete", this.handleFileDeletion);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.settingsUnsubscriber = subscribeToSettingsChange(this.handleSettingsChange);
  }

  private handleSettingsChange = (
    prev: ReturnType<typeof getSettings>,
    next: ReturnType<typeof getSettings>
  ): void => {
    const nextFolder = deriveProjectsFolder(next);
    if (deriveProjectsFolder(prev) !== nextFolder) {
      this.debouncedFolderChange(nextFolder);
    }
  };

  private debouncedFolderChange = debounce(
    (nextFolder: string) => {
      void this.handleProjectsFolderChange(nextFolder);
    },
    1000,
    { leading: false, trailing: true }
  );

  private async handleProjectsFolderChange(nextFolder: string): Promise<void> {
    const currentRequestId = ++this.folderChangeRequestId;

    try {
      const nextRecords = await this.manager.fetchProjects();

      if (currentRequestId !== this.folderChangeRequestId) return;

      for (const d of this.fileModifyDebouncers.values()) d.cancel();
      this.fileModifyDebouncers.clear();

      updateCachedProjectRecords(nextRecords);

      logInfo(`[Projects] Folder changed -> reloaded: ${nextFolder}`);
      new Notice(`Projects folder updated: ${nextFolder}`);
    } catch (error) {
      if (currentRequestId !== this.folderChangeRequestId) return;

      for (const d of this.fileModifyDebouncers.values()) d.cancel();
      this.fileModifyDebouncers.clear();

      updateCachedProjectRecords([]);

      logError(`[Projects] Failed to reload after folder change: ${nextFolder}`, error);
      new Notice(
        `Failed to reload projects from "${nextFolder}". Projects cleared — reopen settings to retry.`
      );
    }
  }

  private isProjectConfigPathString(oldPath: string): boolean {
    const folder = getProjectsFolder();
    if (!oldPath.startsWith(folder + "/")) return false;

    const relativePath = oldPath.slice(folder.length + 1);
    if (relativePath.startsWith(`${PROJECTS_UNSUPPORTED_FOLDER_NAME}/`)) return false;

    const parts = relativePath.split("/");
    return parts.length === 2 && parts[1] === PROJECT_CONFIG_FILE_NAME;
  }

  private handleFileCreation = async (file: TAbstractFile) => {
    if (!isProjectConfigFile(file) || isPendingFileWrite(file.path)) return;

    try {
      const record = await parseProjectConfigFile(this.app, file);
      if (!record) return;

      const existing = getCachedProjectRecordById(record.project.id);
      if (existing && existing.filePath !== record.filePath) {
        logWarn(
          `[Projects] Duplicate id="${record.project.id}": ` +
            `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
        );
        return;
      }

      await ensureProjectFrontmatter(this.app, file, record);
      const updated = await parseProjectConfigFile(this.app, file);
      if (updated) upsertCachedProjectRecord(updated);
    } catch (error) {
      logError(`[Projects] Error on file creation: ${file.path}`, error);
    }
  };

  private handleFileDeletion = async (file: TAbstractFile) => {
    if (!isProjectConfigFile(file) || isPendingFileWrite(file.path)) return;

    this.evictFileModifyDebouncer(file.path);

    try {
      const record = getCachedProjectRecordByFilePath(file.path);
      deleteCachedProjectRecordByFilePath(file.path);

      if (record) {
        void loadAllProjects(this.app).catch((err) =>
          logError("[Projects] Rescan after delete failed", err)
        );
      }
    } catch (error) {
      logError(`[Projects] Error on file deletion: ${file.path}`, error);
    }
  };

  private handleFileRename = async (file: TAbstractFile, oldPath: string) => {
    if (isPendingFileWrite(file.path) || isPendingFileWrite(oldPath)) return;

    const wasValid = this.isProjectConfigPathString(oldPath);
    const isValidNow = isProjectConfigFile(file);

    if (!wasValid && !isValidNow) return;

    if (wasValid) this.evictFileModifyDebouncer(oldPath);

    try {
      const oldRecord = wasValid ? getCachedProjectRecordByFilePath(oldPath) : undefined;

      if (isValidNow) {
        const record = await parseProjectConfigFile(this.app, file);
        if (!record) {
          if (wasValid) deleteCachedProjectRecordByFilePath(oldPath);
          return;
        }

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

        await ensureProjectFrontmatter(this.app, file, record);
        const updated = await parseProjectConfigFile(this.app, file);
        if (updated) {
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

      if (wasValid && !isValidNow && oldRecord) {
        void loadAllProjects(this.app).catch((err) =>
          logError("[Projects] Rescan after rename-out failed", err)
        );
      }
    } catch (error) {
      logError(`[Projects] Error on file rename: ${oldPath} -> ${file.path}`, error);
    }
  };

  private evictFileModifyDebouncer(filePath: string): void {
    const d = this.fileModifyDebouncers.get(filePath);
    if (d) {
      d.cancel();
      this.fileModifyDebouncers.delete(filePath);
    }
  }

  private async processFileModify(file: TAbstractFile): Promise<void> {
    if (!isProjectConfigFile(file) || isPendingFileWrite(file.path)) return;

    try {
      const record = await parseProjectConfigFile(this.app, file);
      if (!record) {
        const staleRecord = getCachedProjectRecordByFilePath(file.path);
        deleteCachedProjectRecordByFilePath(file.path);
        if (staleRecord) {
          void loadAllProjects(this.app).catch((err) =>
            logError("[Projects] Rescan after invalid edit failed", err)
          );
        }
        return;
      }

      const existing = getCachedProjectRecordById(record.project.id);
      if (existing && existing.filePath !== record.filePath) {
        const staleRecord = getCachedProjectRecordByFilePath(file.path);
        deleteCachedProjectRecordByFilePath(file.path);
        if (staleRecord) {
          void loadAllProjects(this.app).catch((err) =>
            logError("[Projects] Rescan after duplicate edit failed", err)
          );
        }
        logWarn(
          `[Projects] Duplicate id="${record.project.id}" on modify: ` +
            `existing=${existing.filePath}, incoming=${record.filePath}; ignored`
        );
        return;
      }

      replaceCachedProjectRecordByFilePath(file.path, record);
    } catch (error) {
      logError(`[Projects] Error on file modify: ${file.path}`, error);
    }
  }

  private getFileModifyDebouncer(
    filePath: string
  ): DebouncedFunction<(file: TAbstractFile) => void> {
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

  private handleFileModify = (file: TAbstractFile): void => {
    if (!isProjectConfigFile(file) || isPendingFileWrite(file.path)) return;
    this.getFileModifyDebouncer(file.path)(file);
  };
}
