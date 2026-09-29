import { ProjectConfig } from "@/aiParams";
import { logError, logInfo, logWarn } from "@/logger";
import { COPILOT_PROJECT_ID, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { reconcileLegacyAgentsResidue } from "@/projects/legacyAgentsResidue";
import {
  deriveProjectFolderName,
  getProjectAnchorFromConfigPath,
  sanitizeVaultPathSegment,
} from "@/projects/projectPaths";
import {
  ensureProjectFrontmatter,
  getProjectConfigFilePath,
  getProjectsFolder,
  getProjectsUnsupportedFolder,
  readFrontmatterFieldFromFile,
  scanAllProjectConfigFiles,
  writeProjectFrontmatter,
} from "@/projects/projectUtils";
import { addPendingFileWrite, removePendingFileWrite } from "@/projects/state";
import { getSettings, updateSetting } from "@/settings/model";
import type { StartupMigrationItem } from "@/services/startupMigration";
import { ensureFolderExists, stripFrontmatter } from "@/utils";
import { App, normalizePath, parseYaml, TFile, TFolder, Vault } from "obsidian";
import { trashFile } from "@/utils/vaultAdapterUtils";

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function saveFailedProjectToUnsupported(
  vault: Vault,
  project: ProjectConfig,
  reason: string,
  projectsFolder: string
): Promise<boolean> {
  try {
    const unsupportedFolder = normalizePath(
      `${projectsFolder}/${PROJECTS_UNSUPPORTED_FOLDER_NAME}`
    );
    await ensureFolderExists(vault, unsupportedFolder);

    const safeId = sanitizeVaultPathSegment(project.id || "unknown") || "unknown";
    const baseName = `Project Migration Failed - ${safeId}`;
    let filePath = `${unsupportedFolder}/${baseName}.md`;
    let suffix = 2;
    while (await vault.adapter.exists(filePath)) {
      if (suffix === 2) {
        try {
          const existingContent = await vault.adapter.read(filePath);
          const jsonMatch = existingContent.match(/```json\s*\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            const backedUpProject = JSON.parse(jsonMatch[1]);
            if (JSON.stringify(backedUpProject) === JSON.stringify(project)) return false;
          }
        } catch {}
      }
      filePath = `${unsupportedFolder}/${baseName} - ${suffix}.md`;
      suffix++;
      if (suffix > 20) {
        logWarn(`[Projects] Too many backup collisions for safeId="${safeId}", giving up`);
        return false;
      }
    }

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
    logError(
      `[Projects] Failed to save unsupported backup for project id=${project.id || "unknown"}`,
      backupError
    );
    return false;
  }
}

async function rollbackCreatedFile(app: App, filePath: string, folderPath: string): Promise<void> {
  const vault = app.vault;
  try {
    const file = vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await trashFile(app, file);
    } else if (await vault.adapter.exists(filePath)) {
      await vault.adapter.remove(filePath);
    }
    const folder = vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder && folder.children.length === 0) {
      await trashFile(app, folder);
    } else if (await vault.adapter.exists(folderPath)) {
      const listing = await vault.adapter.list(folderPath);
      if (listing.files.length === 0 && listing.folders.length === 0) {
        await vault.adapter.rmdir(folderPath, false);
      }
    }
  } catch (rollbackError) {
    logError(`[Projects] Migration rollback failed for ${filePath}`, rollbackError);
  }
}

async function writeProjectToVaultFile(
  app: App,
  project: ProjectConfig,
  folderName: string,
  projectsFolder: string
): Promise<TFile> {
  const vault = app.vault;
  await ensureFolderExists(vault, projectsFolder);
  await ensureFolderExists(vault, `${projectsFolder}/${folderName}`);

  const filePath = getProjectConfigFilePath(folderName, projectsFolder);

  const folderPath = `${projectsFolder}/${folderName}`;

  addPendingFileWrite(filePath);
  try {
    const file = await vault.create(filePath, project.systemPrompt || "");

    const now = Date.now();
    const createdMs =
      Number.isFinite(project.created) && project.created > 0 ? project.created : now;
    const lastUsedMs =
      Number.isFinite(project.UsageTimestamps) && project.UsageTimestamps > 0
        ? project.UsageTimestamps
        : 0;

    try {
      await writeProjectFrontmatter(app, file, project, folderName, { createdMs, lastUsedMs });
    } catch (fmError) {
      await rollbackCreatedFile(app, filePath, folderPath);
      throw fmError;
    }

    return file;
  } finally {
    removePendingFileWrite(filePath);
  }
}

async function verifyMigratedContent(
  vault: Vault,
  fileOrPath: TFile | string,
  originalSystemPrompt: string
): Promise<boolean> {
  try {
    const rawContent =
      fileOrPath instanceof TFile
        ? await vault.read(fileOrPath)
        : await vault.adapter.read(fileOrPath);
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

function getMigrationFolderName(projectId: string, projectName?: string): string {
  return deriveProjectFolderName(projectId, projectName);
}

export async function migrateProjectsFromSettingsToVault(
  app: App
): Promise<StartupMigrationItem | null> {
  const passProjectsFolder = getProjectsFolder();
  const vault = app.vault;
  const settings = getSettings();
  const legacyProjects = settings.projectList || [];

  if (legacyProjects.length === 0) {
    logInfo("[Projects] No legacy projects to migrate");
    return null;
  }

  logInfo(`[Projects] Migrating ${legacyProjects.length} legacy projects to vault files...`);

  const migratedEntries: ProjectConfig[] = [];
  const seenIds = new Set<string>();
  const seenFolderNames = new Map<string, string>();

  for (const project of legacyProjects) {
    const id = (project.id || "").trim();

    if (!id) {
      logWarn("[Projects] Skip migrating project with empty id");
      await saveFailedProjectToUnsupported(vault, project, "empty project id", passProjectsFolder);
      continue;
    }

    if (seenIds.has(id)) {
      logWarn(`[Projects] Skip migrating duplicate project id: ${id}`);
      await saveFailedProjectToUnsupported(
        vault,
        project,
        `duplicate project id: ${id}`,
        passProjectsFolder
      );
      continue;
    }
    seenIds.add(id);

    const folderName = getMigrationFolderName(id, project.name);

    const folderKey = folderName.toLowerCase();
    const firstIdForFolder = seenFolderNames.get(folderKey);
    if (firstIdForFolder) {
      logWarn(
        `[Projects] Skip migrating project id="${id}": folder name "${folderName}" ` +
          `collides with id="${firstIdForFolder}"`
      );
      await saveFailedProjectToUnsupported(
        vault,
        project,
        `folder name collision: "${folderName}" already used by id="${firstIdForFolder}"`,
        passProjectsFolder
      );
      continue;
    }
    seenFolderNames.set(folderKey, id);
    const filePath = getProjectConfigFilePath(folderName, passProjectsFolder);

    const existingFile = vault.getAbstractFileByPath(filePath);
    const fileExistsOnDisk =
      existingFile instanceof TFile || (await vault.adapter.exists(filePath));
    if (fileExistsOnDisk) {
      let existingId = "";
      if (existingFile instanceof TFile) {
        const existingMeta = app.metadataCache.getFileCache(existingFile);
        existingId = String(existingMeta?.frontmatter?.[COPILOT_PROJECT_ID] ?? "").trim();
        if (!existingId) {
          existingId = await readFrontmatterFieldFromFile(vault, existingFile, COPILOT_PROJECT_ID);
        }
      } else {
        try {
          const raw = await vault.adapter.read(filePath);
          const fmMatch = raw.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (fmMatch) {
            const parsed = parseYaml(fmMatch[1]);
            if (parsed && typeof parsed === "object") {
              const raw = (parsed as Record<string, unknown>)[COPILOT_PROJECT_ID];
              existingId = (typeof raw === "string" ? raw : "").trim();
            }
          }
        } catch {
          existingId = "";
        }
      }

      if (existingId === id) {
        const verified = await verifyMigratedContent(
          vault,
          existingFile instanceof TFile ? existingFile : filePath,
          project.systemPrompt || ""
        );
        if (verified) {
          if (existingFile instanceof TFile) {
            try {
              const folderNameForRepair = getMigrationFolderName(id, project.name);
              await ensureProjectFrontmatter(app, existingFile, {
                project,
                filePath,
                folderName: folderNameForRepair,
              });
            } catch (repairError) {
              logWarn(
                `[Projects] Failed to repair frontmatter for id=${id}, continuing`,
                repairError
              );
            }
          }
          logInfo(
            `[Projects] Migration skip: target file already exists for id=${id} at ${filePath}`
          );
          migratedEntries.push(project);
          continue;
        }

        logWarn(`[Projects] Migration verify failed on existing file for id=${id} at ${filePath}`);
        await saveFailedProjectToUnsupported(
          vault,
          project,
          `existing file content mismatch at ${filePath} (delete/rename the file and re-run migration)`,
          passProjectsFolder
        );
        continue;
      }

      logWarn(
        `[Projects] Migration conflict: ${filePath} exists with id="${existingId}" but expected "${id}"`
      );
      await saveFailedProjectToUnsupported(
        vault,
        project,
        `target file exists at ${filePath} with mismatched id="${existingId}"`,
        passProjectsFolder
      );
      continue;
    }

    try {
      const file = await writeProjectToVaultFile(app, project, folderName, passProjectsFolder);

      const verified = await verifyMigratedContent(vault, file, project.systemPrompt || "");
      if (!verified) {
        const folderPath = `${passProjectsFolder}/${folderName}`;
        await rollbackCreatedFile(app, file.path, folderPath);
        await saveFailedProjectToUnsupported(
          vault,
          project,
          "content verification mismatch",
          passProjectsFolder
        );
      } else {
        migratedEntries.push(project);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError(`[Projects] Failed to migrate project id=${id}`, error);
      await saveFailedProjectToUnsupported(vault, project, msg, passProjectsFolder);
    }
  }

  updateSetting("projectList", []);

  const successCount = migratedEntries.length;
  const failedCount = legacyProjects.length - successCount;
  const projectsFolder = getProjectsFolder();
  const unsupportedFolder = getProjectsUnsupportedFolder();

  if (failedCount === 0) {
    logInfo(
      `[Projects] Migration succeeded: all ${successCount} project(s) migrated to vault files`
    );
    return {
      id: "projects",
      title: "Projects",
      status: "success",
      summary: `All ${successCount} project${successCount === 1 ? " was" : "s were"} migrated to note files.`,
      details: [`Stored in ${projectsFolder}.`],
    };
  } else if (successCount > 0) {
    logWarn(
      `[Projects] Migration partially succeeded: ${successCount} migrated, ${failedCount} failed`
    );
    return {
      id: "projects",
      title: "Projects",
      status: "action-required",
      summary: `${successCount} project${successCount === 1 ? " was" : "s were"} migrated; ${failedCount} could not be migrated.`,
      details: [
        `Migrated projects are in ${projectsFolder}.`,
        `Recover the remaining projects from ${unsupportedFolder}.`,
      ],
    };
  } else {
    logWarn("[Projects] Migration failed: no projects were migrated");
    return {
      id: "projects",
      title: "Projects",
      status: "error",
      summary: "No projects could be migrated, but recovery copies were created.",
      details: [`Recover the projects from ${unsupportedFolder}.`],
    };
  }
}

async function migrateProjectFolderNames(app: App): Promise<void> {
  const vault = app.vault;
  const { records } = await scanAllProjectConfigFiles(app);
  if (records.length === 0) return;

  let renamed = 0;
  const reservedLowerNames = new Map<string, string>();
  for (const r of records) {
    reservedLowerNames.set(r.folderName.toLowerCase(), r.project.id);
  }

  for (const record of records) {
    const name = (record.project.name || "").trim();
    if (!name) continue;

    const expectedFolder = sanitizeVaultPathSegment(name);
    const safeFolderName =
      expectedFolder.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME
        ? `_${expectedFolder}`
        : expectedFolder;

    if (safeFolderName === record.folderName) continue;

    const { projectsRoot: recordProjectsRoot, projectFolderPath: oldFolderPath } =
      getProjectAnchorFromConfigPath(record.filePath);
    const newFolderPath = `${recordProjectsRoot}/${safeFolderName}`;
    const oldFilePath = record.filePath;
    const newFilePath = getProjectConfigFilePath(safeFolderName, recordProjectsRoot);

    const lowerTarget = safeFolderName.toLowerCase();
    const existingOwner = reservedLowerNames.get(lowerTarget);
    if (existingOwner && existingOwner !== record.project.id) {
      logWarn(
        `[Projects] Naming migration skip: folder "${safeFolderName}" collides (case-insensitive) ` +
          `with project id="${existingOwner}" for project id="${record.project.id}"`
      );
      continue;
    }

    const isCaseOnlyRename = newFolderPath.toLowerCase() === oldFolderPath.toLowerCase();
    if (!isCaseOnlyRename && (await vault.adapter.exists(newFolderPath))) {
      logWarn(
        `[Projects] Naming migration skip: target folder "${newFolderPath}" already exists ` +
          `for project id="${record.project.id}"`
      );
      continue;
    }

    try {
      addPendingFileWrite(oldFilePath);
      addPendingFileWrite(newFilePath);

      const folderObj = vault.getAbstractFileByPath(oldFolderPath);
      if (folderObj instanceof TFolder) {
        await vault.rename(folderObj, newFolderPath);
      } else {
        await vault.adapter.rename(oldFolderPath, newFolderPath);
      }
      renamed++;
      reservedLowerNames.delete(record.folderName.toLowerCase());
      reservedLowerNames.set(lowerTarget, record.project.id);
      logInfo(
        `[Projects] Naming migration: renamed folder "${record.folderName}" → "${safeFolderName}" ` +
          `for project "${name}" (id=${record.project.id})`
      );
    } catch (error) {
      logError(`[Projects] Naming migration failed for project id="${record.project.id}"`, error);
    } finally {
      removePendingFileWrite(oldFilePath);
      removePendingFileWrite(newFilePath);
    }
  }

  if (renamed > 0) {
    logInfo(`[Projects] Naming migration complete: ${renamed} folder(s) renamed`);
  }
}

export async function ensureProjectsMigratedIfNeeded(
  app: App
): Promise<StartupMigrationItem | null> {
  const legacyProjects = getSettings().projectList || [];
  let migrationResult: StartupMigrationItem | null = null;
  if (legacyProjects.length > 0) {
    migrationResult = await migrateProjectsFromSettingsToVault(app);
  }

  await reconcileLegacyAgentsResidue(app);

  await migrateProjectFolderNames(app);
  return migrationResult;
}
