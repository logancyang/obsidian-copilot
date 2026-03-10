import { ProjectConfig } from "@/aiParams";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { logError, logInfo, logWarn } from "@/logger";
import {
  COPILOT_PROJECT_LAST_USED,
  PROJECTS_STORAGE_VERSION_LATEST,
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
import { getSettings, updateSetting } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { normalizePath, TFile, TFolder, Vault } from "obsidian";
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
   * Initialize: run read-side fallback migration if needed, then load all projects.
   * When migration hasn't fully completed, merges legacy projects into the cache
   * so they remain visible and usable during the current session.
   */
  public async initialize(): Promise<void> {
    logInfo("[Projects] Initializing ProjectFileManager");
    await ensureProjectsMigratedIfNeeded(this.vault);
    await loadAllProjects();
    this.mergeLegacyProjectsIntoCache();
  }

  /**
   * Merge legacy `settings.projectList` entries into the in-memory cache for any
   * projects not found in vault files. This ensures projects that failed migration
   * remain visible and usable until migration succeeds on a subsequent restart.
   *
   * Only active when `projectsStorageVersion < PROJECTS_STORAGE_VERSION_LATEST`.
   */
  public mergeLegacyProjectsIntoCache(): void {
    const settings = getSettings();
    const storageVersion = Number(settings.projectsStorageVersion || 0);
    if (storageVersion >= PROJECTS_STORAGE_VERSION_LATEST) return;

    const legacyProjects: ProjectConfig[] = settings.projectList || [];
    if (legacyProjects.length === 0) return;

    const cachedRecords = getCachedProjectRecords();
    const existingIds = new Set(cachedRecords.map((r) => r.project.id));
    // Reason: track folder names to prevent collisions where different legacy ids sanitize
    // to the same folder, which would cause updateProject() to overwrite the wrong file.
    const existingFolderNames = new Set(cachedRecords.map((r) => r.folderName.toLowerCase()));
    let mergedCount = 0;

    for (const legacy of legacyProjects) {
      // Reason: sanitize legacy id so it's safe for filenames and path prefixes
      const rawId = (legacy.id || "").trim();
      if (!rawId) continue;
      const id = sanitizeVaultPathSegment(rawId);
      if (existingIds.has(id)) continue;

      const folderName = this.sanitizeFolderName(id);
      const folderKey = folderName.toLowerCase();
      if (existingFolderNames.has(folderKey)) {
        logWarn(
          `[Projects] Skip legacy merge for id="${id}": folder "${folderName}" collides with existing project`
        );
        continue;
      }

      upsertCachedProjectRecord({
        project: { ...legacy, id, name: (legacy.name || id).trim() },
        filePath: getProjectConfigFilePath(folderName),
        folderName,
      });
      existingIds.add(id);
      existingFolderNames.add(folderKey);
      mergedCount++;
    }

    if (mergedCount > 0) {
      logInfo(`[Projects] Merged ${mergedCount} legacy project(s) into cache as fallback`);
    }
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
   * Sanitize a project id for use as a folder name.
   * Replaces path separators and control characters.
   * Rejects reserved names that conflict with internal directories.
   */
  private sanitizeFolderName(id: string): string {
    const sanitized = sanitizeVaultPathSegment(id);
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
      if (file instanceof TFile) await this.vault.delete(file, true);
      const folder = this.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder && folder.children.length === 0) {
        await this.vault.delete(folder, true);
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
   * Create a new project file (\<projectsFolder\>/\<id\>/project.md).
   * @param project - ProjectConfig to create
   * @returns Newly created ProjectFileRecord
   */
  public async createProject(project: ProjectConfig): Promise<ProjectFileRecord> {
    // Reason: validate raw id first (sanitizeVaultPathSegment never returns empty),
    // then sanitize for safe filenames, path prefixes, and YAML frontmatter.
    const rawId = (project.id || "").trim();
    if (!rawId) throw new Error("Project id cannot be empty");
    const projectId = sanitizeVaultPathSegment(rawId);

    if (getCachedProjectRecordById(projectId)) {
      throw new Error(`Project id already exists: ${projectId}`);
    }

    const folderName = this.sanitizeFolderName(projectId);
    const folderPath = getProjectFolderPath(folderName);
    const filePath = getProjectConfigFilePath(folderName);

    try {
      addPendingFileWrite(filePath);

      await ensureFolderExists(getProjectsFolder());
      await ensureFolderExists(folderPath);

      // Reason: detect folder name collisions where a different project id sanitizes to the
      // same folder (e.g. "a/b" and "a\\b" both produce "a_b"). Check both cache and filesystem.
      if (this.vault.getAbstractFileByPath(filePath)) {
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

      await this.vault.create(filePath, project.systemPrompt || "");

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) throw new Error("File not found after creation");

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

    const filePath = existing.filePath;
    const folderName = existing.folderName;

    try {
      addPendingFileWrite(filePath);

      let file = this.vault.getAbstractFileByPath(filePath);
      let materialized = false;

      // Reason: if the file doesn't exist (e.g. legacy project merged into cache before migration
      // completed), materialize it now so the update can proceed.
      if (!(file instanceof TFile)) {
        logInfo(`[Projects] Materializing missing vault file for project: ${normalizedId}`);
        const folderPath = getProjectFolderPath(folderName);
        await ensureFolderExists(getProjectsFolder());
        await ensureFolderExists(folderPath);
        await this.vault.create(filePath, nextProject.systemPrompt || "");
        file = this.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) throw new Error(`Project file not found after creation: ${filePath}`);
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

      // Reason: write frontmatter first so the file never loses it. If the second write
      // (body replacement) fails, the file still has valid frontmatter with old body — much
      // safer than the reverse which would leave the file with no frontmatter at all.
      try {
        await writeProjectFrontmatter(
          file,
          { ...nextProject, created: createdMs, UsageTimestamps: lastUsedMs },
          folderName,
          { createdMs, lastUsedMs }
        );
      } catch (fmError) {
        // Reason: if we just materialized the file, rollback to avoid leaving a poisoned file
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

      const updated: ProjectFileRecord = {
        project: { ...nextProject, created: createdMs, UsageTimestamps: lastUsedMs },
        filePath,
        folderName,
      };

      upsertCachedProjectRecord(updated);
      logInfo(`[Projects] Updated project: ${normalizedId} -> ${filePath}`);
      return updated;
    } finally {
      removePendingFileWrite(filePath);
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
      }

      // Cleanup: remove the folder only if it is empty after deleting project.md
      const folder = this.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder && folder.children.length === 0) {
        await this.vault.delete(folder);
      }

      deleteCachedProjectRecordById(normalizedId);

      // Reason: also remove from legacy settings.projectList so the project doesn't
      // reappear on restart when migration hasn't fully completed. Compare sanitized
      // legacy ids since runtime ids are now sanitized.
      const legacyList = getSettings().projectList || [];
      const matchesId = (p: ProjectConfig) =>
        sanitizeVaultPathSegment((p.id || "").trim()) === normalizedId;
      if (legacyList.some(matchesId)) {
        updateSetting(
          "projectList",
          legacyList.filter((p) => !matchesId(p))
        );
      }

      // Reason: clear stale context cache to prevent reuse if project id is re-created.
      // Best-effort: clearForProject catches/logs its own errors internally.
      void ProjectContextCache.getInstance()
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
      const file = this.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) return;

      // Reason: use alreadyPending pattern to avoid clearing another in-flight pending write
      const alreadyPending = isPendingFileWrite(file.path);
      let actualPersistedValue = timestampToPersist;
      try {
        if (!alreadyPending) addPendingFileWrite(file.path);
        await app.fileManager.processFrontMatter(file, (frontmatter) => {
          const existing = Number(frontmatter[COPILOT_PROJECT_LAST_USED]);
          const existingMs = Number.isFinite(existing) && existing > 0 ? existing : 0;
          // Monotonic: only write if new value is greater
          actualPersistedValue = Math.max(existingMs, timestampToPersist);
          if (existingMs === actualPersistedValue) return;
          frontmatter[COPILOT_PROJECT_LAST_USED] = actualPersistedValue;
        });
      } finally {
        if (!alreadyPending) removePendingFileWrite(file.path);
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
