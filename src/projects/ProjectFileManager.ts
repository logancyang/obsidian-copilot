import { ProjectConfig } from "@/aiParams";
import { ProjectContextCache } from "@/cache/projectContextCache";
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
import { RecentUsageManager } from "@/utils/recentUsageManager";
import {
  isInVaultCache,
  patchFrontmatter,
  readFrontmatterViaAdapter,
  resolveFileByPath,
} from "@/utils/vaultAdapterUtils";
import { normalizePath, stringifyYaml, TFile, TFolder, Vault } from "obsidian";
import { ensureProjectsMigratedIfNeeded } from "@/projects/projectMigration";

/**
 * Project file manager (aligned with system-prompts Manager pattern).
 *
 * Responsibilities:
 * - CRUD: create/update/delete project.md files
 * - Cache: maintain in-memory list via state.ts
 * - last-used: throttled frontmatter writes via RecentUsageManager
 */
export class ProjectFileManager {
  private static instance: ProjectFileManager;
  private vault: Vault;
  private readonly projectLastUsedManager = new RecentUsageManager<string>();

  private constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Get singleton instance.
   * @param vault - Obsidian Vault (required on first call)
   * @returns ProjectFileManager singleton
   */
  public static getInstance(vault?: Vault): ProjectFileManager {
    if (!ProjectFileManager.instance) {
      if (!vault) throw new Error("Vault is required for first initialization");
      ProjectFileManager.instance = new ProjectFileManager(vault);
    }
    return ProjectFileManager.instance;
  }

  /**
   * Initialize: run one-time migration from data.json if needed, then load all
   * projects from vault files. Migration unconditionally clears settings.projectList
   * after backing up failures to unsupported/ (no retry/merge — single source of truth).
   */
  public async initialize(): Promise<void> {
    logInfo("[Projects] Initializing ProjectFileManager");
    await ensureProjectsMigratedIfNeeded(this.vault);
    await loadAllProjects();
  }

  /**
   * Get cached ProjectConfig list.
   * @returns Array of ProjectConfig
   */
  public getProjects(): ProjectConfig[] {
    return getCachedProjectRecords().map((r) => r.project);
  }

  /**
   * Get cached ProjectFileRecord list.
   * @returns Array of ProjectFileRecord
   */
  public getProjectRecords(): ProjectFileRecord[] {
    return getCachedProjectRecords();
  }

  /**
   * Reload all projects from vault (full scan + cache replace).
   */
  public async reloadProjects(): Promise<ProjectFileRecord[]> {
    return await loadAllProjects();
  }

  /**
   * Fetch all projects from vault without updating cache.
   */
  public async fetchProjects(): Promise<ProjectFileRecord[]> {
    return await fetchAllProjects();
  }

  /**
   * Get the RecentUsageManager for project last-used timestamps (for UI sorting).
   */
  public getProjectUsageTimestampsManager(): RecentUsageManager<string> {
    return this.projectLastUsedManager;
  }

  /**
   * Sanitize a string for use as a project folder name.
   * Typically receives the project name (or id as fallback when name is empty).
   * Replaces path separators and control characters.
   * Rejects reserved names that conflict with internal directories.
   */
  private sanitizeFolderName(input: string): string {
    const sanitized = sanitizeVaultPathSegment(input);
    // Reason: "unsupported" is reserved for migration failure backups
    if (sanitized.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME) {
      return `_${sanitized}`;
    }
    return sanitized;
  }

  /**
   * Best-effort rollback: delete a file created during a failed operation.
   * Also removes the parent folder if empty. Logs errors but never throws.
   */
  private async rollbackCreatedFile(filePath: string, folderPath: string): Promise<void> {
    try {
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await this.vault.delete(file, true);
      } else if (await this.vault.adapter.exists(filePath)) {
        // Reason: hidden-folder files are not indexed by vault cache.
        // Fall back to adapter-based deletion for consistent hidden-folder support.
        await this.vault.adapter.remove(filePath);
      }
      const folder = this.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder && folder.children.length === 0) {
        await this.vault.delete(folder, true);
      } else if (await this.vault.adapter.exists(folderPath)) {
        const listing = await this.vault.adapter.list(folderPath);
        if (listing.files.length === 0 && listing.folders.length === 0) {
          await this.vault.adapter.rmdir(folderPath, false);
        }
      }
    } catch (rollbackError) {
      logError(`[Projects] Rollback failed for ${filePath}`, rollbackError);
    }
  }

  /**
   * Extract the leading YAML frontmatter block (including closing marker and trailing newline).
   * @returns The frontmatter block string, or null if none found
   */
  private getLeadingFrontmatterBlock(raw: string): string | null {
    // Reason: strip optional BOM before matching, consistent with readFrontmatterFieldFromFile
    const content = raw.replace(/^\uFEFF/, "");
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? match[0] : null;
  }

  /**
   * Build complete file content (frontmatter + body) for a project.
   * Used for hidden-folder files where processFrontMatter is unavailable.
   *
   * @param project - ProjectConfig to serialize
   * @param folderName - Folder name (fallback for id/name)
   * @param timestamps - Created and last-used timestamps
   * @returns Complete file content string
   */
  private buildProjectFileContent(
    project: ProjectConfig,
    folderName: string,
    timestamps: { createdMs: number; lastUsedMs: number }
  ): string {
    const webUrls = splitUrlsStringToArray(project.contextSource?.webUrls || "");
    const youtubeUrls = splitUrlsStringToArray(project.contextSource?.youtubeUrls || "");

    const fm: Record<string, unknown> = {
      // Reason: do NOT fallback to folderName for id — with name-based folders,
      // folderName is derived from project name, not id.
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

  /**
   * Create a new project file (\<projectsFolder\>/\<id\>/project.md).
   * @param project - ProjectConfig to create
   * @returns Newly created ProjectFileRecord
   */
  public async createProject(project: ProjectConfig): Promise<ProjectFileRecord> {
    // Reason: validate raw id first, then sanitize only for folder name derivation.
    // The project.id stays as-is for stable logical identity.
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

    // Reason: derive folder name from project name for user-friendly vault browsing.
    // Fall back to id when name is empty/whitespace.
    const folderName = this.sanitizeFolderName(trimmedName || projectId);
    const folderPath = getProjectFolderPath(folderName);
    const filePath = getProjectConfigFilePath(folderName);

    // Reason: detect case-insensitive folder collisions (macOS/Windows vaults are
    // case-insensitive). Without this, "Foo" and "foo" map to the same disk folder.
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

      await ensureFolderExists(getProjectsFolder());
      await ensureFolderExists(folderPath);

      // Reason: detect folder name collisions where a different project id sanitizes to the
      // same folder (e.g. "a/b" and "a\\b" both produce "a_b"). Check both cache and filesystem.
      // Uses adapter.exists() instead of getAbstractFileByPath() for hidden-folder compatibility.
      if (await this.vault.adapter.exists(filePath)) {
        throw new Error(
          `Project file already exists at "${filePath}". ` +
            `This may be a folder name collision — project id "${projectId}" sanitizes to folder "${folderName}"`
        );
      }

      const now = Date.now();
      const createdMs = Number.isFinite(project.created) && project.created > 0 ? project.created : now;
      const lastUsedMs =
        Number.isFinite(project.UsageTimestamps) && project.UsageTimestamps > 0
          ? project.UsageTimestamps
          : 0;

      // Reason: use vault.create() return value directly instead of re-fetching via
      // getAbstractFileByPath(), which fails for hidden folders not indexed by vault cache.
      const file = await this.vault.create(filePath, project.systemPrompt || "");

      try {
        await writeProjectFrontmatter(file, project, folderName, { createdMs, lastUsedMs });
      } catch (fmError) {
        // Reason: rollback the created file to avoid leaving a "poisoned" file without frontmatter
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

  /**
   * Update an existing project (located by id).
   * @param projectId - Project id to update
   * @param nextProject - New ProjectConfig (id must match)
   * @returns Updated ProjectFileRecord
   */
  public async updateProject(projectId: string, nextProject: ProjectConfig): Promise<ProjectFileRecord> {
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
        (r) => r.project.id !== normalizedId && r.project.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (nameConflict) {
        throw new Error(`A project with the name "${trimmedName}" already exists`);
      }
    }

    let filePath = existing.filePath;
    let folderName = existing.folderName;

    // Reason: when the project name changes, the folder should be renamed to match.
    // This keeps vault browsing intuitive (folder = project name).
    const nextFolderName = this.sanitizeFolderName(trimmedName || normalizedId);
    let oldFilePathForPending: string | null = null;

    if (nextFolderName !== existing.folderName) {
      const newFolderPath = getProjectFolderPath(nextFolderName);
      const newFilePath = getProjectConfigFilePath(nextFolderName);

      // Check collision: cache (case-insensitive) + filesystem
      const folderKey = nextFolderName.toLowerCase();
      const folderConflict = getCachedProjectRecords().find(
        (r) => r.project.id !== normalizedId && r.folderName.toLowerCase() === folderKey
      );
      if (folderConflict) {
        throw new Error(
          `Cannot rename project folder: "${nextFolderName}" conflicts with project "${folderConflict.project.name}"`
        );
      }
      // Reason: on case-insensitive filesystems (macOS/Windows), a case-only rename
      // (e.g. "foo" → "Foo") reports the old folder as "already existing". Skip the
      // disk-conflict check when the paths differ only in case.
      const isCaseOnlyRename =
        newFolderPath.toLowerCase() === getProjectFolderPath(existing.folderName).toLowerCase();
      if (!isCaseOnlyRename && (await this.vault.adapter.exists(newFolderPath))) {
        throw new Error(
          `Cannot rename project folder: "${newFolderPath}" already exists on disk`
        );
      }

      // Suppress vault events for both old and new project.md paths
      oldFilePathForPending = filePath;
      addPendingFileWrite(oldFilePathForPending);
      addPendingFileWrite(newFilePath);

      try {
        const oldFolderPath = getProjectFolderPath(existing.folderName);
        // Reason: use vault-cache-aware rename when possible, adapter fallback for hidden folders
        const folderObj = this.vault.getAbstractFileByPath(oldFolderPath);
        if (folderObj instanceof TFolder) {
          await this.vault.rename(folderObj, newFolderPath);
        } else {
          await this.vault.adapter.rename(oldFolderPath, newFolderPath);
        }
      } catch (renameError) {
        // Rename failed — folder not moved, clean up pending and rethrow
        removePendingFileWrite(oldFilePathForPending);
        removePendingFileWrite(newFilePath);
        throw renameError;
      }

      // Update local variables to use new paths for subsequent writes
      filePath = newFilePath;
      folderName = nextFolderName;
      logInfo(
        `[Projects] Renamed project folder: "${existing.folderName}" → "${nextFolderName}" for project ${normalizedId}`
      );
    }

    try {
      // Reason: only add pending-write guard when no folder rename occurred.
      // When a rename happened, the new path was already guarded at L380 and will be
      // cleaned up in the finally block. Adding again would leak the ref-count.
      if (!oldFilePathForPending) {
        addPendingFileWrite(filePath);
      }

      // Reason: use resolveFileByPath to handle both vault-cached and hidden-folder files.
      // getAbstractFileByPath returns null for hidden folders even when the file exists on disk.
      let file = await resolveFileByPath(app, filePath);
      let materialized = false;

      // Reason: if the file doesn't exist anywhere (e.g. legacy project merged into cache before
      // migration completed), materialize it now so the update can proceed.
      if (!file) {
        logInfo(`[Projects] Materializing missing vault file for project: ${normalizedId}`);
        const folderPath = getProjectFolderPath(folderName);
        await ensureFolderExists(getProjectsFolder());
        await ensureFolderExists(folderPath);
        file = await this.vault.create(filePath, nextProject.systemPrompt || "");
        materialized = true;
      }

      const createdMs =
        Number.isFinite(existing.project.created) && existing.project.created > 0
          ? existing.project.created
          : Date.now();
      // Reason: take the maximum of cached value and in-memory manager value to avoid
      // clobbering a recent touchProjectLastUsed() write with a stale cached value.
      const cachedLastUsed =
        Number.isFinite(existing.project.UsageTimestamps) && existing.project.UsageTimestamps > 0
          ? existing.project.UsageTimestamps
          : 0;
      const memoryLastUsed = this.projectLastUsedManager.getLastTouchedAt(normalizedId) ?? 0;
      const lastUsedMs = Math.max(cachedLastUsed, memoryLastUsed);

      const projectForWrite = { ...nextProject, created: createdMs, UsageTimestamps: lastUsedMs };

      // Reason: processFrontMatter (used by writeProjectFrontmatter) does not work reliably
      // on synthetic TFiles for hidden folders. Split into cached-file and adapter-based paths.
      if (isInVaultCache(app, filePath)) {
        // Vault-cached file: use processFrontMatter for safe field-level updates
        try {
          await writeProjectFrontmatter(file, projectForWrite, folderName, { createdMs, lastUsedMs });
        } catch (fmError) {
          if (materialized) await this.rollbackCreatedFile(filePath, getProjectFolderPath(folderName));
          throw fmError;
        }

        // Read back the updated frontmatter block, then combine with new body in a single write
        const rawWithFrontmatter = await this.vault.read(file);
        const frontmatterBlock = this.getLeadingFrontmatterBlock(rawWithFrontmatter);
        if (!frontmatterBlock) {
          throw new Error(`Expected frontmatter block after update: ${file.path}`);
        }
        const separator = frontmatterBlock.endsWith("\n") ? "" : "\n";
        await this.vault.modify(
          file,
          frontmatterBlock + separator + (nextProject.systemPrompt || "")
        );
      } else {
        // Hidden-folder file: build complete content and write via adapter
        const content = this.buildProjectFileContent(projectForWrite, folderName, {
          createdMs,
          lastUsedMs,
        });
        await this.vault.adapter.write(filePath, content);
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
      // Reason: if the folder was already renamed but writing failed, roll the folder back
      // to prevent leaving the project in an inconsistent location.
      if (oldFilePathForPending && folderName !== existing.folderName) {
        try {
          const oldFolderPath = getProjectFolderPath(existing.folderName);
          const newFolderPath = getProjectFolderPath(folderName);
          // Reason: use vault.rename() for cached folders (same as forward rename) so
          // the vault cache stays consistent. Fall back to adapter for hidden folders.
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
          logError(`[Projects] Failed to rollback folder rename for ${normalizedId}`, rollbackError);
        }
      }
      throw writeError;
    } finally {
      // Reason: mirror the add logic — only remove the non-rename guard when no rename occurred.
      // When a rename happened, filePath points to newFilePath which was guarded at L380.
      // Remove that single guard plus the old-path guard. No double-remove.
      removePendingFileWrite(filePath);
      if (oldFilePathForPending) removePendingFileWrite(oldFilePathForPending);
    }
  }

  /**
   * Delete a project by id. Deletes only the managed project.md file, then removes
   * the folder if it is empty (to avoid deleting user-created files).
   * @param projectId - Project id to delete
   */
  public async deleteProject(projectId: string): Promise<void> {
    const normalizedId = (projectId || "").trim();
    const existing = getCachedProjectRecordById(normalizedId);
    if (!existing) {
      logWarn(`[Projects] deleteProject: not found: ${normalizedId}`);
      return;
    }

    const folderPath = getProjectFolderPath(existing.folderName);

    try {
      addPendingFileWrite(existing.filePath);

      // Reason: delete only the managed config file to avoid destroying user files
      // that may have been placed in the project folder. Use non-force delete so
      // Obsidian respects the user's trash behavior (system trash / .trash folder).
      const configFile = this.vault.getAbstractFileByPath(existing.filePath);
      if (configFile instanceof TFile) {
        await this.vault.delete(configFile);
      } else if (await this.vault.adapter.exists(existing.filePath)) {
        // Reason: hidden-folder files are not indexed by vault cache.
        // Fall back to adapter-based deletion for consistent hidden-folder support.
        await this.vault.adapter.remove(existing.filePath);
      }

      // Reason: clear cache immediately after file deletion to prevent phantom project
      // state if the subsequent folder cleanup fails.
      deleteCachedProjectRecordById(normalizedId);

      // Cleanup: remove the folder only if it is empty after deleting project.md.
      // Best-effort: the project file is already gone, so cleanup failure
      // must not leave a phantom project in memory.
      try {
        const folder = this.vault.getAbstractFileByPath(folderPath);
        if (folder instanceof TFolder && folder.children.length === 0) {
          await this.vault.delete(folder);
        } else if (await this.vault.adapter.exists(folderPath)) {
          const listing = await this.vault.adapter.list(folderPath);
          if (listing.files.length === 0 && listing.folders.length === 0) {
            await this.vault.adapter.rmdir(folderPath, false);
          }
        }
      } catch (cleanupError) {
        logWarn(`[Projects] Failed to clean up empty project folder: ${folderPath}`, cleanupError);
      }

      // Reason: await cache clear to prevent same-ID recreation from having its
      // fresh cache wiped by a stale async cleanup. Consistent with folder-switch path.
      await ProjectContextCache.getInstance()
        .clearForProject(existing.project)
        .catch((err) => logError("[Projects] Failed to clear context cache on delete", err));

      logInfo(`[Projects] Deleted project: ${normalizedId} -> ${folderPath}`);

      // Reason: rescan to re-admit any previously-ignored duplicate-id files.
      // The register won't fire (pending guard), so we trigger rescan here.
      void loadAllProjects().catch((err) =>
        logError("[Projects] Rescan after delete failed", err)
      );
    } finally {
      removePendingFileWrite(existing.filePath);
    }
  }

  /**
   * Touch project last-used: memory updated immediately; frontmatter write throttled.
   * @param projectId - Project id to touch
   */
  public async touchProjectLastUsed(projectId: string): Promise<void> {
    const normalizedId = (projectId || "").trim();
    const record = getCachedProjectRecordById(normalizedId);
    if (!record) return;

    try {
      // 1. Update memory immediately (for UI sorting feedback)
      this.projectLastUsedManager.touch(normalizedId);

      // 2. Check if persistence is needed (throttled)
      const timestampToPersist = this.projectLastUsedManager.shouldPersist(
        normalizedId,
        record.project.UsageTimestamps
      );
      if (timestampToPersist === null) return;

      const filePath = normalizePath(record.filePath);
      const file = await resolveFileByPath(app, filePath);
      if (!file) return;

      // Reason: use alreadyPending pattern to avoid clearing another in-flight pending write
      const alreadyPending = isPendingFileWrite(filePath);
      let actualPersistedValue = timestampToPersist;
      try {
        if (!alreadyPending) addPendingFileWrite(filePath);

        if (isInVaultCache(app, filePath)) {
          // Vault-cached file: use processFrontMatter for safe field-level update
          await app.fileManager.processFrontMatter(file, (frontmatter) => {
            const existing = Number(frontmatter[COPILOT_PROJECT_LAST_USED]);
            const existingMs = Number.isFinite(existing) && existing > 0 ? existing : 0;
            actualPersistedValue = Math.max(existingMs, timestampToPersist);
            if (existingMs === actualPersistedValue) return;
            frontmatter[COPILOT_PROJECT_LAST_USED] = actualPersistedValue;
          });
        } else {
          // Hidden-folder file: use adapter-based frontmatter patch
          const adapterFm = await readFrontmatterViaAdapter(app, filePath);
          const existing = Number(adapterFm?.[COPILOT_PROJECT_LAST_USED]);
          const existingMs = Number.isFinite(existing) && existing > 0 ? existing : 0;
          actualPersistedValue = Math.max(existingMs, timestampToPersist);
          if (existingMs !== actualPersistedValue) {
            await patchFrontmatter(app, filePath, {
              [COPILOT_PROJECT_LAST_USED]: actualPersistedValue,
            });
          }
        }
      } finally {
        if (!alreadyPending) removePendingFileWrite(filePath);
      }

      // 3. Mark persistence successful with actual written value (for accurate throttling)
      this.projectLastUsedManager.markPersisted(normalizedId, actualPersistedValue);

      // 4. Sync cached record so updateProject() sees the latest value.
      // Reason: re-read fresh record to avoid overwriting concurrent edits to other fields.
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
