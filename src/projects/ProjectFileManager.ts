import { ProjectConfig } from "@/aiParams";
import { removeGeneratedInstructionFiles } from "@/instructions/agentsFile";
import { logError, logInfo, logWarn } from "@/logger";
import {
  COPILOT_PROJECT_CREATED,
  COPILOT_PROJECT_DESCRIPTION,
  COPILOT_PROJECT_EXCLUSIONS,
  COPILOT_PROJECT_ID,
  COPILOT_PROJECT_INCLUSIONS,
  COPILOT_PROJECT_LAST_USED,
  COPILOT_PROJECT_MAX_TOKENS,
  COPILOT_PROJECT_MODEL_KEY,
  COPILOT_PROJECT_NAME,
  COPILOT_PROJECT_TEMPERATURE,
  COPILOT_PROJECT_WEB_URLS,
  COPILOT_PROJECT_YOUTUBE_URLS,
  PROJECTS_UNSUPPORTED_FOLDER_NAME,
} from "@/projects/constants";
import { ProjectFileRecord } from "@/projects/type";
import {
  fetchAllProjects,
  getProjectAnchorFromConfigPath,
  getProjectConfigFilePath,
  getProjectFolderPath,
  getProjectsFolder,
  loadAllProjects,
  sanitizeVaultPathSegment,
  splitUrlsStringToArray,
  writeProjectFrontmatter,
} from "@/projects/projectUtils";
import {
  addPendingFileWrite,
  deleteCachedProjectRecordById,
  getCachedProjectRecordById,
  getCachedProjectRecords,
  isPendingFileWrite,
  removePendingFileWrite,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { ensureFolderExists } from "@/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import {
  isInVaultCache,
  patchFrontmatter,
  readFrontmatterViaAdapter,
  resolveFileByPath,
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { App, normalizePath, stringifyYaml, TFile, TFolder, Vault } from "obsidian";
import { ensureProjectsMigratedIfNeeded } from "@/projects/projectMigration";
import type { StartupMigrationItem } from "@/services/startupMigration";

export class ProjectFileManager {
  private static instance: ProjectFileManager;
  private app: App;
  private vault: Vault;
  private readonly projectLastUsedManager = new RecentUsageManager<string>();

  private constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
  }

  public static getInstance(app?: App): ProjectFileManager {
    if (!ProjectFileManager.instance) {
      if (!app) throw new Error("App is required for first initialization");
      ProjectFileManager.instance = new ProjectFileManager(app);
    }
    return ProjectFileManager.instance;
  }

  public async initialize(): Promise<StartupMigrationItem | null> {
    logInfo("[Projects] Initializing ProjectFileManager");
    const migrationResult = await ensureProjectsMigratedIfNeeded(this.app);
    await loadAllProjects(this.app);
    return migrationResult;
  }

  public async fetchProjects(): Promise<ProjectFileRecord[]> {
    return await fetchAllProjects(this.app);
  }

  public getProjectUsageTimestampsManager(): RecentUsageManager<string> {
    return this.projectLastUsedManager;
  }

  private sanitizeFolderName(input: string): string {
    const sanitized = sanitizeVaultPathSegment(input);
    if (sanitized.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME) {
      return `_${sanitized}`;
    }
    return sanitized;
  }

  private async rollbackCreatedFile(filePath: string, folderPath: string): Promise<void> {
    try {
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await trashFile(this.app, file);
      } else if (await this.vault.adapter.exists(filePath)) {
        await this.vault.adapter.remove(filePath);
      }
      const folder = this.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder && folder.children.length === 0) {
        await trashFile(this.app, folder);
      } else if (await this.vault.adapter.exists(folderPath)) {
        const listing = await this.vault.adapter.list(folderPath);
        if (listing.files.length === 0 && listing.folders.length === 0) {
          // Obsidian's desktop adapter rejects non-recursive rmdir even for an empty folder. https://github.com/logancyang/obsidian-copilot/issues/3075
          await this.vault.adapter.rmdir(folderPath, true);
        }
      }
    } catch (rollbackError) {
      logError(`[Projects] Rollback failed for ${filePath}`, rollbackError);
    }
  }

  private getLeadingFrontmatterBlock(raw: string): string | null {
    const content = raw.replace(/^\uFEFF/, "");
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? match[0] : null;
  }

  private buildProjectFileContent(
    project: ProjectConfig,
    folderName: string,
    timestamps: { createdMs: number; lastUsedMs: number }
  ): string {
    const webUrls = splitUrlsStringToArray(project.contextSource?.webUrls || "");
    const youtubeUrls = splitUrlsStringToArray(project.contextSource?.youtubeUrls || "");

    const fm: Record<string, unknown> = {
      [COPILOT_PROJECT_ID]: project.id.trim(),
      [COPILOT_PROJECT_NAME]: (project.name || folderName).trim(),
      [COPILOT_PROJECT_DESCRIPTION]: (project.description || "").trim(),
      [COPILOT_PROJECT_MODEL_KEY]: (project.projectModelKey || "").trim(),
      [COPILOT_PROJECT_INCLUSIONS]: project.contextSource?.inclusions || "",
      [COPILOT_PROJECT_EXCLUSIONS]: project.contextSource?.exclusions || "",
      [COPILOT_PROJECT_WEB_URLS]: webUrls,
      [COPILOT_PROJECT_YOUTUBE_URLS]: youtubeUrls,
      [COPILOT_PROJECT_CREATED]: timestamps.createdMs,
      [COPILOT_PROJECT_LAST_USED]: timestamps.lastUsedMs,
    };

    if (project.modelConfigs?.temperature != null) {
      fm[COPILOT_PROJECT_TEMPERATURE] = project.modelConfigs.temperature;
    }
    if (project.modelConfigs?.maxTokens != null) {
      fm[COPILOT_PROJECT_MAX_TOKENS] = project.modelConfigs.maxTokens;
    }

    return `---\n${stringifyYaml(fm)}---\n${project.systemPrompt || ""}`;
  }

  public async createProject(project: ProjectConfig): Promise<ProjectFileRecord> {
    const projectId = (project.id || "").trim();
    if (!projectId) throw new Error("Project id cannot be empty");

    if (getCachedProjectRecordById(projectId)) {
      throw new Error(`Project id already exists: ${projectId}`);
    }

    const trimmedName = (project.name || "").trim();
    if (trimmedName) {
      const nameExists = getCachedProjectRecords().some(
        (r) => r.project.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (nameExists) {
        throw new Error(`A project with the name "${trimmedName}" already exists`);
      }
    }

    const folderName = this.sanitizeFolderName(trimmedName || projectId);
    const folderPath = getProjectFolderPath(folderName);
    const filePath = getProjectConfigFilePath(folderName);

    const folderKey = folderName.toLowerCase();
    const cachedRecords = getCachedProjectRecords();
    const existingFolderConflict = cachedRecords.find(
      (r) => r.folderName.toLowerCase() === folderKey && r.project.id !== projectId
    );
    if (existingFolderConflict) {
      throw new Error(
        `Folder name collision: project id "${projectId}" sanitizes to folder "${folderName}" ` +
          `which conflicts with existing project "${existingFolderConflict.project.id}"`
      );
    }

    try {
      addPendingFileWrite(filePath);

      await ensureFolderExists(this.vault, getProjectsFolder());
      await ensureFolderExists(this.vault, folderPath);

      if (await this.vault.adapter.exists(filePath)) {
        throw new Error(
          `Project file already exists at "${filePath}". ` +
            `This may be a folder name collision — project id "${projectId}" sanitizes to folder "${folderName}"`
        );
      }

      const now = Date.now();
      const createdMs =
        Number.isFinite(project.created) && project.created > 0 ? project.created : now;
      const lastUsedMs =
        Number.isFinite(project.UsageTimestamps) && project.UsageTimestamps > 0
          ? project.UsageTimestamps
          : 0;

      try {
        if (isInVaultCache(this.app, folderPath)) {
          const file = await this.vault.create(filePath, project.systemPrompt || "");
          await writeProjectFrontmatter(this.app, file, project, folderName, {
            createdMs,
            lastUsedMs,
          });
        } else {
          // Hidden folders are not indexed, so processFrontMatter cannot create their project metadata.
          // https://github.com/logancyang/obsidian-copilot/issues/3075
          await this.vault.adapter.write(
            filePath,
            this.buildProjectFileContent(project, folderName, { createdMs, lastUsedMs })
          );
        }
      } catch (fmError) {
        await this.rollbackCreatedFile(filePath, folderPath);
        throw fmError;
      }

      const record: ProjectFileRecord = {
        project: { ...project, id: projectId, created: createdMs, UsageTimestamps: lastUsedMs },
        filePath,
        folderName,
      };

      upsertCachedProjectRecord(record);
      logInfo(`[Projects] Created project: ${projectId} -> ${filePath}`);
      return record;
    } finally {
      removePendingFileWrite(filePath);
    }
  }

  public async updateProject(
    projectId: string,
    nextProject: ProjectConfig
  ): Promise<ProjectFileRecord> {
    const normalizedId = (projectId || "").trim();
    if (!normalizedId) throw new Error("Project id cannot be empty");
    if ((nextProject.id || "").trim() !== normalizedId) {
      throw new Error("Project id mismatch: cannot change id via update");
    }

    const existing = getCachedProjectRecordById(normalizedId);
    if (!existing) throw new Error(`Project not found: ${normalizedId}`);

    const trimmedName = (nextProject.name || "").trim();
    if (trimmedName) {
      const nameConflict = getCachedProjectRecords().some(
        (r) =>
          r.project.id !== normalizedId &&
          r.project.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (nameConflict) {
        throw new Error(`A project with the name "${trimmedName}" already exists`);
      }
    }

    let filePath = existing.filePath;
    let folderName = existing.folderName;
    const { projectsRoot } = getProjectAnchorFromConfigPath(existing.filePath);
    const projectFolderIn = (name: string) => normalizePath(`${projectsRoot}/${name}`);

    const nextFolderName = this.sanitizeFolderName(trimmedName || normalizedId);
    let oldFilePathForPending: string | null = null;

    if (nextFolderName !== existing.folderName) {
      const newFolderPath = projectFolderIn(nextFolderName);
      const newFilePath = getProjectConfigFilePath(nextFolderName, projectsRoot);

      const folderKey = nextFolderName.toLowerCase();
      const folderConflict = getCachedProjectRecords().find(
        (r) => r.project.id !== normalizedId && r.folderName.toLowerCase() === folderKey
      );
      if (folderConflict) {
        throw new Error(
          `Cannot rename project folder: "${nextFolderName}" conflicts with project "${folderConflict.project.name}"`
        );
      }
      const isCaseOnlyRename =
        newFolderPath.toLowerCase() === projectFolderIn(existing.folderName).toLowerCase();
      if (!isCaseOnlyRename && (await this.vault.adapter.exists(newFolderPath))) {
        throw new Error(`Cannot rename project folder: "${newFolderPath}" already exists on disk`);
      }

      oldFilePathForPending = filePath;
      addPendingFileWrite(oldFilePathForPending);
      addPendingFileWrite(newFilePath);

      try {
        const oldFolderPath = projectFolderIn(existing.folderName);
        const folderObj = this.vault.getAbstractFileByPath(oldFolderPath);
        if (folderObj instanceof TFolder) {
          await this.vault.rename(folderObj, newFolderPath);
        } else {
          await this.vault.adapter.rename(oldFolderPath, newFolderPath);
        }
      } catch (renameError) {
        removePendingFileWrite(oldFilePathForPending);
        removePendingFileWrite(newFilePath);
        throw renameError;
      }

      filePath = newFilePath;
      folderName = nextFolderName;
      logInfo(
        `[Projects] Renamed project folder: "${existing.folderName}" → "${nextFolderName}" for project ${normalizedId}`
      );
    }

    try {
      if (!oldFilePathForPending) {
        addPendingFileWrite(filePath);
      }

      let file = await resolveFileByPath(this.app, filePath);
      let materialized = false;

      if (!file) {
        logInfo(`[Projects] Materializing missing vault file for project: ${normalizedId}`);
        const folderPath = projectFolderIn(folderName);
        await ensureFolderExists(this.vault, projectsRoot);
        await ensureFolderExists(this.vault, folderPath);
        file = await this.vault.create(filePath, nextProject.systemPrompt || "");
        materialized = true;
      }

      const createdMs =
        Number.isFinite(existing.project.created) && existing.project.created > 0
          ? existing.project.created
          : Date.now();
      const cachedLastUsed =
        Number.isFinite(existing.project.UsageTimestamps) && existing.project.UsageTimestamps > 0
          ? existing.project.UsageTimestamps
          : 0;
      const memoryLastUsed = this.projectLastUsedManager.getLastTouchedAt(normalizedId) ?? 0;
      const lastUsedMs = Math.max(cachedLastUsed, memoryLastUsed);

      const projectForWrite = { ...nextProject, created: createdMs, UsageTimestamps: lastUsedMs };

      try {
        await writeProjectFrontmatter(this.app, file, projectForWrite, folderName, {
          createdMs,
          lastUsedMs,
        });
      } catch (fmError) {
        if (materialized) await this.rollbackCreatedFile(filePath, projectFolderIn(folderName));
        throw fmError;
      }

      const isIndexed = isInVaultCache(this.app, filePath);
      const rawWithFrontmatter = isIndexed
        ? await this.vault.read(file)
        : await this.vault.adapter.read(filePath);
      const frontmatterBlock = this.getLeadingFrontmatterBlock(rawWithFrontmatter);
      if (!frontmatterBlock) {
        throw new Error(`Expected frontmatter block after update: ${file.path}`);
      }
      const separator = frontmatterBlock.endsWith("\n") ? "" : "\n";
      const nextContent = frontmatterBlock + separator + (nextProject.systemPrompt || "");
      if (isIndexed) {
        await this.vault.modify(file, nextContent);
      } else {
        await this.vault.adapter.write(filePath, nextContent);
      }

      const updated: ProjectFileRecord = {
        project: { ...nextProject, created: createdMs, UsageTimestamps: lastUsedMs },
        filePath,
        folderName,
      };

      upsertCachedProjectRecord(updated);

      logInfo(`[Projects] Updated project: ${normalizedId} -> ${filePath}`);
      return updated;
    } catch (writeError) {
      if (oldFilePathForPending && folderName !== existing.folderName) {
        try {
          const oldFolderPath = projectFolderIn(existing.folderName);
          const newFolderPath = projectFolderIn(folderName);
          const renamedFolder = this.vault.getAbstractFileByPath(newFolderPath);
          if (renamedFolder instanceof TFolder) {
            await this.vault.rename(renamedFolder, oldFolderPath);
          } else {
            await this.vault.adapter.rename(newFolderPath, oldFolderPath);
          }
          logWarn(
            `[Projects] Rolled back folder rename "${folderName}" → "${existing.folderName}" after write failure`
          );
        } catch (rollbackError) {
          logError(
            `[Projects] Failed to rollback folder rename for ${normalizedId}`,
            rollbackError
          );
        }
      }
      throw writeError;
    } finally {
      removePendingFileWrite(filePath);
      if (oldFilePathForPending) removePendingFileWrite(oldFilePathForPending);
    }
  }

  public async deleteProject(projectId: string): Promise<void> {
    const normalizedId = (projectId || "").trim();
    const existing = getCachedProjectRecordById(normalizedId);
    if (!existing) {
      logWarn(`[Projects] deleteProject: not found: ${normalizedId}`);
      return;
    }

    const { projectFolderPath: folderPath } = getProjectAnchorFromConfigPath(existing.filePath);

    try {
      addPendingFileWrite(existing.filePath);

      const configFile = this.vault.getAbstractFileByPath(existing.filePath);
      if (configFile instanceof TFile) {
        await trashFile(this.app, configFile);
      } else if (await this.vault.adapter.exists(existing.filePath)) {
        await this.vault.adapter.remove(existing.filePath);
      }

      deleteCachedProjectRecordById(normalizedId);

      await removeGeneratedInstructionFiles(this.app, folderPath);

      try {
        const folder = this.vault.getAbstractFileByPath(folderPath);
        if (folder instanceof TFolder && folder.children.length === 0) {
          await trashFile(this.app, folder);
        } else if (await this.vault.adapter.exists(folderPath)) {
          const listing = await this.vault.adapter.list(folderPath);
          if (listing.files.length === 0 && listing.folders.length === 0) {
            // Obsidian's desktop adapter rejects non-recursive rmdir even for an empty folder. https://github.com/logancyang/obsidian-copilot/issues/3075
            await this.vault.adapter.rmdir(folderPath, true);
          }
        }
      } catch (cleanupError) {
        logWarn(`[Projects] Failed to clean up empty project folder: ${folderPath}`, cleanupError);
      }

      if (isDesktopRuntime()) {
        const { clearProjectMarkers } = await import("@/context/projectMarkerCleanup");
        await clearProjectMarkers(this.app, normalizedId).catch((err) =>
          logError(`[Projects] Failed to clear off-vault failure markers on delete`, err)
        );
      }

      logInfo(`[Projects] Deleted project: ${normalizedId} -> ${folderPath}`);

      void loadAllProjects(this.app).catch((err) =>
        logError("[Projects] Rescan after delete failed", err)
      );
    } finally {
      removePendingFileWrite(existing.filePath);
    }
  }

  public async touchProjectLastUsed(projectId: string): Promise<void> {
    const normalizedId = (projectId || "").trim();
    const record = getCachedProjectRecordById(normalizedId);
    if (!record) return;

    try {
      this.projectLastUsedManager.touch(normalizedId);

      const timestampToPersist = this.projectLastUsedManager.shouldPersist(
        normalizedId,
        record.project.UsageTimestamps
      );
      if (timestampToPersist === null) return;

      const filePath = normalizePath(record.filePath);
      const file = await resolveFileByPath(this.app, filePath);
      if (!file) return;

      const alreadyPending = isPendingFileWrite(filePath);
      let actualPersistedValue = timestampToPersist;
      try {
        if (!alreadyPending) addPendingFileWrite(filePath);

        if (isInVaultCache(this.app, filePath)) {
          await this.app.fileManager.processFrontMatter(
            file,
            (frontmatter: Record<string, unknown>) => {
              const existing = Number(frontmatter[COPILOT_PROJECT_LAST_USED]);
              const existingMs = Number.isFinite(existing) && existing > 0 ? existing : 0;
              actualPersistedValue = Math.max(existingMs, timestampToPersist);
              if (existingMs === actualPersistedValue) return;
              frontmatter[COPILOT_PROJECT_LAST_USED] = actualPersistedValue;
            }
          );
        } else {
          const adapterFm = await readFrontmatterViaAdapter(this.app, filePath);
          const existing = Number(adapterFm?.[COPILOT_PROJECT_LAST_USED]);
          const existingMs = Number.isFinite(existing) && existing > 0 ? existing : 0;
          actualPersistedValue = Math.max(existingMs, timestampToPersist);
          if (existingMs !== actualPersistedValue) {
            await patchFrontmatter(this.app, filePath, {
              [COPILOT_PROJECT_LAST_USED]: actualPersistedValue,
            });
          }
        }
      } finally {
        if (!alreadyPending) removePendingFileWrite(filePath);
      }

      this.projectLastUsedManager.markPersisted(normalizedId, actualPersistedValue);

      const freshRecord = getCachedProjectRecordById(normalizedId);
      if (freshRecord) {
        upsertCachedProjectRecord({
          ...freshRecord,
          project: { ...freshRecord.project, UsageTimestamps: actualPersistedValue },
        });
      }
    } catch (error) {
      logError(`[Projects] Failed to touch last-used for projectId=${projectId}`, error);
    }
  }
}
