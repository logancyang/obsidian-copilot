import { ProjectConfig } from "@/aiParams";
import { logError, logInfo, logWarn } from "@/logger";
import {
  COPILOT_PROJECT_ID,
  PROJECTS_STORAGE_VERSION_LATEST,
  PROJECTS_UNSUPPORTED_FOLDER_NAME,
} from "@/projects/constants";
import {
  getProjectConfigFilePath,
  getProjectsFolder,
  getProjectsUnsupportedFolder,
  readFrontmatterFieldFromFile,
  sanitizeVaultPathSegment,
  writeProjectFrontmatter,
} from "@/projects/projectUtils";
import { addPendingFileWrite, removePendingFileWrite } from "@/projects/state";
import { getSettings, updateSetting } from "@/settings/model";
import { ensureFolderExists, stripFrontmatter } from "@/utils";
import { Notice, TFile, TFolder, Vault } from "obsidian";

/**
 * Normalize line endings for content comparison (avoid CRLF/LF mismatches).
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Save a failed migration project to unsupported/ directory as recovery backup.
 * Best-effort: if backup itself fails, log error but don't throw
 * (to avoid crashing the migration loop and losing the legacy data).
 *
 * @param vault - Vault instance
 * @param project - Original project config
 * @param reason - Failure reason
 * @returns true if a new backup was created, false if it already existed or backup failed
 */
async function saveFailedProjectToUnsupported(
  vault: Vault,
  project: ProjectConfig,
  reason: string
): Promise<boolean> {
  try {
    const unsupportedFolder = getProjectsUnsupportedFolder();
    await ensureFolderExists(unsupportedFolder);

    const safeId = sanitizeVaultPathSegment(project.id || "unknown") || "unknown";
    // Reason: use deterministic file name so repeated migration runs don't create duplicate backups
    const fileName = `Project Migration Failed - ${safeId}`;
    const filePath = `${unsupportedFolder}/${fileName}.md`;

    if (vault.getAbstractFileByPath(filePath)) return false;

    const content = [
      `> Projects migration failed: ${reason}`,
      ">",
      "> This file is an automatic backup (unsupported/), for manual recovery.",
      "> You can recreate the project from the JSON below, or fix and re-migrate.",
      "",
      "```json",
      JSON.stringify(project, null, 2),
      "```",
      "",
    ].join("\n");

    await vault.create(filePath, content);
    return true;
  } catch (backupError) {
    // Reason: backup failure must not crash migration loop or cause legacy data loss
    logError(
      `[Projects] Failed to save unsupported backup for project id=${project.id || "unknown"}`,
      backupError
    );
    return false;
  }
}

/**
 * Best-effort rollback: delete a file and its parent folder if empty.
 * Logs errors but never throws.
 */
async function rollbackCreatedFile(vault: Vault, filePath: string, folderPath: string): Promise<void> {
  try {
    const file = vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) await vault.delete(file, true);
    const folder = vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder && folder.children.length === 0) {
      await vault.delete(folder, true);
    }
  } catch (rollbackError) {
    logError(`[Projects] Migration rollback failed for ${filePath}`, rollbackError);
  }
}

/**
 * Write a single project to a vault file with full frontmatter.
 *
 * @param vault - Vault instance
 * @param project - ProjectConfig to write
 * @param folderName - Target folder name (typically the project id)
 * @returns Path of the created project.md
 */
async function writeProjectToVaultFile(
  vault: Vault,
  project: ProjectConfig,
  folderName: string
): Promise<string> {
  const projectsFolder = getProjectsFolder();
  await ensureFolderExists(projectsFolder);
  await ensureFolderExists(`${projectsFolder}/${folderName}`);

  const filePath = getProjectConfigFilePath(folderName);

  const folderPath = `${projectsFolder}/${folderName}`;

  addPendingFileWrite(filePath);
  try {
    await vault.create(filePath, project.systemPrompt || "");

    const file = vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) throw new Error("File not found after creation");

    const now = Date.now();
    const createdMs =
      Number.isFinite(project.created) && project.created > 0 ? project.created : now;
    const lastUsedMs =
      Number.isFinite(project.UsageTimestamps) && project.UsageTimestamps > 0
        ? project.UsageTimestamps
        : 0;

    try {
      await writeProjectFrontmatter(file, project, folderName, { createdMs, lastUsedMs });
    } catch (fmError) {
      // Reason: rollback the created file to avoid leaving a "poisoned" file without frontmatter
      await rollbackCreatedFile(vault, filePath, folderPath);
      throw fmError;
    }

    return filePath;
  } finally {
    removePendingFileWrite(filePath);
  }
}

/**
 * Write-then-verify: check that migrated file content matches original systemPrompt.
 * Aligned with system-prompts migration verification strategy.
 */
async function verifyMigratedContent(
  vault: Vault,
  file: TFile,
  originalSystemPrompt: string
): Promise<boolean> {
  try {
    const rawContent = await vault.read(file);
    const savedContent = stripFrontmatter(rawContent, { trimStart: false });

    const savedNorm = normalizeLineEndings(savedContent).replace(/^\n+/, "");
    const originalNorm = normalizeLineEndings(originalSystemPrompt || "").replace(/^\n+/, "");

    if (savedNorm !== originalNorm) {
      logWarn(
        `[Projects] Migration verify failed: content mismatch. ` +
          `Expected ${originalNorm.length} chars, got ${savedNorm.length} chars`
      );
      return false;
    }
    return true;
  } catch (error) {
    logError("[Projects] Migration verify failed: unable to read back file", error);
    return false;
  }
}

/**
 * Derive the migration folder name from a legacy project id.
 * Stable across versions so partial migrations are retryable.
 */
function getMigrationFolderName(projectId: string): string {
  let folderName = sanitizeVaultPathSegment(projectId);
  // Reason: "unsupported" is reserved for migration failure backups
  if (folderName.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME) {
    folderName = `_${folderName}`;
  }
  return folderName;
}

/**
 * Execute project migration from data.json (settings.projectList) to vault files.
 *
 * Safety guarantees:
 * - write-then-verify: each file is read back and verified
 * - unsupported/ backup: failed items are backed up for manual recovery
 * - version only set after ALL succeed: prevents half-migration state
 * - dirty data defense: skip duplicate ids, empty ids
 * - retry-safe: already-migrated projects (target file exists with matching id) are skipped
 *
 * @param vault - Vault instance
 */
export async function migrateProjectsFromSettingsToVault(vault: Vault): Promise<void> {
  const settings = getSettings();
  const legacyProjects = settings.projectList || [];

  if (legacyProjects.length === 0) {
    logInfo("[Projects] No legacy projects to migrate");
    return;
  }

  logInfo(`[Projects] Migrating ${legacyProjects.length} legacy projects to vault files...`);

  let allSucceeded = true;
  let newBackupsCreated = 0;
  const seenIds = new Set<string>();
  // Reason: track sanitized folder names (case-insensitive) to detect collisions where
  // different ids map to the same folder. Case-insensitive because macOS/Windows vaults
  // have case-insensitive filesystems (e.g. "MyProject" and "myproject" collide on disk).
  const seenFolderNames = new Map<string, string>(); // lowercase folderName -> first project id

  for (const project of legacyProjects) {
    const id = (project.id || "").trim();

    // Dirty data defense: skip empty ids
    if (!id) {
      allSucceeded = false;
      logWarn("[Projects] Skip migrating project with empty id");
      if (await saveFailedProjectToUnsupported(vault, project, "empty project id"))
        newBackupsCreated++;
      continue;
    }

    // Dirty data defense: skip duplicate ids
    if (seenIds.has(id)) {
      allSucceeded = false;
      logWarn(`[Projects] Skip migrating duplicate project id: ${id}`);
      if (await saveFailedProjectToUnsupported(vault, project, `duplicate project id: ${id}`))
        newBackupsCreated++;
      continue;
    }
    seenIds.add(id);

    const folderName = getMigrationFolderName(id);

    // Dirty data defense: skip folder name collisions (case-insensitive for cross-platform safety)
    const folderKey = folderName.toLowerCase();
    const firstIdForFolder = seenFolderNames.get(folderKey);
    if (firstIdForFolder) {
      allSucceeded = false;
      logWarn(
        `[Projects] Skip migrating project id="${id}": folder name "${folderName}" ` +
          `collides with id="${firstIdForFolder}"`
      );
      if (
        await saveFailedProjectToUnsupported(
          vault,
          project,
          `folder name collision: "${folderName}" already used by id="${firstIdForFolder}"`
        )
      )
        newBackupsCreated++;
      continue;
    }
    seenFolderNames.set(folderKey, id);
    const filePath = getProjectConfigFilePath(folderName);

    // Retry-safety: if target file already exists from a prior partial migration, skip it
    // but only if the frontmatter id matches (to avoid treating conflict files as successful)
    const existingFile = vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      // Try metadataCache first (fast path), fall back to reading file content directly
      // Reason: metadataCache may not be ready on startup, returning null frontmatter
      // which would cause false conflict detection and unnecessary unsupported backups
      const existingMeta = app.metadataCache.getFileCache(existingFile);
      let existingId = String(existingMeta?.frontmatter?.[COPILOT_PROJECT_ID] ?? "").trim();

      if (!existingId) {
        existingId = await readFrontmatterFieldFromFile(vault, existingFile, COPILOT_PROJECT_ID);
      }

      // Reason: compare against sanitized id since writeProjectFrontmatter now sanitizes
      // the id on write. Raw legacy ids with special chars will differ from persisted ids.
      const sanitizedId = sanitizeVaultPathSegment(id);
      if (existingId === sanitizedId) {
        // Reason: verify content on retry to avoid cementing a previously truncated/corrupted file.
        // Without this, a partial first-run write would be skipped on rerun and counted as success.
        const verified = await verifyMigratedContent(
          vault,
          existingFile,
          project.systemPrompt || ""
        );
        if (verified) {
          logInfo(
            `[Projects] Migration skip: target file already exists for id=${id} at ${filePath}`
          );
          continue;
        }

        allSucceeded = false;
        logWarn(
          `[Projects] Migration verify failed on existing file for id=${id} at ${filePath}`
        );
        if (
          await saveFailedProjectToUnsupported(
            vault,
            project,
            `existing file content mismatch at ${filePath} (delete/rename the file and re-run migration)`
          )
        )
          newBackupsCreated++;
        continue;
      }

      // File exists but id doesn't match — treat as conflict
      allSucceeded = false;
      logWarn(
        `[Projects] Migration conflict: ${filePath} exists with id="${existingId}" but expected "${id}"`
      );
      if (
        await saveFailedProjectToUnsupported(
          vault,
          project,
          `target file exists at ${filePath} with mismatched id="${existingId}"`
        )
      )
        newBackupsCreated++;
      continue;
    }

    try {
      const writtenPath = await writeProjectToVaultFile(vault, project, folderName);
      const file = vault.getAbstractFileByPath(writtenPath);
      if (!(file instanceof TFile)) throw new Error("File not found after write");

      const verified = await verifyMigratedContent(vault, file, project.systemPrompt || "");
      if (!verified) {
        allSucceeded = false;
        if (await saveFailedProjectToUnsupported(vault, project, "content verification mismatch"))
          newBackupsCreated++;
      }
    } catch (error) {
      allSucceeded = false;
      const msg = error instanceof Error ? error.message : String(error);
      logError(`[Projects] Failed to migrate project id=${id}`, error);
      if (await saveFailedProjectToUnsupported(vault, project, msg)) newBackupsCreated++;
    }
  }

  if (!allSucceeded) {
    // Reason: don't set version flag or clear old data when migration has failures
    logWarn("[Projects] Migration finished with failures; preserving legacy projectList");
    // Reason: only show Notice when new backup files were created, to avoid noisy repeated notices
    if (newBackupsCreated > 0) {
      new Notice("Projects migration completed with some failures. Check unsupported/ folder.");
    }
    return;
  }

  // All succeeded: set version flag but preserve legacy projectList for one version cycle
  // Reason: §1.4 requires keeping projectList for downgrade compatibility
  updateSetting("projectsStorageVersion", PROJECTS_STORAGE_VERSION_LATEST);
  logInfo("[Projects] Migration succeeded; projectList preserved for backward compatibility");
  new Notice("Projects migrated to vault files successfully.");
}

/**
 * Read-side fallback: auto-trigger migration when data.json has unmigrated projects.
 *
 * Retry-safe: even if vault already has some project files (from a prior partial migration),
 * we still attempt migration — the migration loop will skip already-existing target files.
 *
 * Conditions for migration:
 * - projectsStorageVersion < latest
 * - legacy projectList is non-empty
 *
 * @param vault - Vault instance
 */
export async function ensureProjectsMigratedIfNeeded(vault: Vault): Promise<void> {
  const settings = getSettings();
  const storageVersion = Number(settings.projectsStorageVersion || 0);

  if (storageVersion >= PROJECTS_STORAGE_VERSION_LATEST) return;

  const legacyProjects = settings.projectList || [];
  if (legacyProjects.length === 0) return;

  await migrateProjectsFromSettingsToVault(vault);
}
