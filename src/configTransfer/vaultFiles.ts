/**
 * Collect and restore vault files (custom commands, system prompts, memory)
 * for configuration file export/import.
 *
 * Files are stored as raw markdown (including frontmatter) so that after
 * plugin reload, each Manager re-parses them from disk — no need to go
 * through Manager write APIs which would trigger vault event storms.
 */

import { type App, TFile, normalizePath } from "obsidian";
import { getSettings, type CopilotSettings } from "@/settings/model";
import { ensureFolderExists, listDirectChildMdFiles } from "@/utils";
import {
  MEMORY_RECENT_CONVERSATIONS_FILENAME,
  MEMORY_SAVED_MEMORIES_FILENAME,
} from "@/constants";
import { logInfo, logWarn } from "@/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Portable representation of a single vault markdown file. */
export interface PortableVaultFile {
  /** File name only, e.g. "Summarize.md" (no path separators). */
  filename: string;
  /** Complete markdown content including frontmatter. */
  content: string;
}

/** Memory data with fixed keys (not generic filenames). */
export interface PortableMemory {
  /** Raw markdown of Recent Conversations, or null if not found. */
  recentConversations: string | null;
  /** Raw markdown of Saved Memories, or null if not found. */
  savedMemories: string | null;
}

/** Full collection of vault files for export/import. */
export interface CollectedVaultFiles {
  customCommands: PortableVaultFile[];
  systemPrompts: PortableVaultFile[];
  memory: PortableMemory;
}

/** Entry tracking a file write for rollback on failure. */
export interface RestoreRollbackEntry {
  path: string;
  /** Content before overwrite, or null if the file was newly created. */
  previousContent: string | null;
}

/** Result summary from restoring vault files. */
export interface RestoreResult {
  commandsWritten: number;
  promptsWritten: number;
  memoryWritten: number;
  errors: string[];
  /** Rollback entries for undoing writes on failure. */
  rollback: RestoreRollbackEntry[];
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

/**
 * Validate a filename is safe to write into a vault folder.
 *
 * Reason: imported filenames come from untrusted data. Path traversal
 * (../) or absolute paths could write files outside the target folder.
 *
 * @throws {Error} If the filename is unsafe.
 */
function assertSafeFilename(filename: string): void {
  if (!filename) {
    throw new Error("Empty filename is not allowed.");
  }
  if (filename.includes("/") || filename.includes("\\")) {
    throw new Error(`Filename "${filename}" contains path separators.`);
  }
  // Reason: `..` as a substring is NOT checked because valid filenames like
  // "Prompt..v2.md" would be falsely rejected. Path traversal is already
  // prevented by the separator check above — without `/` or `\`, `..` in a
  // basename cannot escape the target folder.
  if (!filename.endsWith(".md")) {
    throw new Error(`Filename "${filename}" is not a .md file.`);
  }
}

/**
 * Validate that a folder path is a safe vault-relative path.
 *
 * Reason: rejects absolute paths and path traversal to prevent writes outside
 * the vault root. Any vault-relative path is allowed — users may configure
 * folders anywhere in the vault (e.g. old defaults at vault root, or custom
 * directories). The `.copilot` file is AES-256-GCM encrypted and import is
 * user-initiated, so namespace restriction is not needed.
 *
 * Shared by both export and import validation.
 *
 * @param folderPath - The folder path to validate.
 * @param label - Human-readable label for error messages (e.g. "Custom commands folder").
 * @param allowEmpty - If true, skip validation for empty paths (export-side behavior).
 * @throws {Error} If the path is absolute or contains traversal.
 */
export function assertSafeVaultRelativePath(
  folderPath: string,
  label: string,
  allowEmpty = false
): void {
  // Reason: check the raw string BEFORE normalizePath() because Obsidian's
  // normalizePath() strips leading slashes, which would let absolute paths
  // like "/etc/secrets" bypass the startsWith("/") check.
  const rawTrimmed = folderPath.trim();
  if (!rawTrimmed) {
    if (allowEmpty) return;
    throw new Error(`${label} path is empty.`);
  }
  if (
    rawTrimmed.startsWith("/") ||
    rawTrimmed.startsWith("\\") ||
    /^[A-Za-z]:/.test(rawTrimmed)
  ) {
    throw new Error(`${label} "${rawTrimmed}" is an absolute path.`);
  }
  // Reason: normalizePath() is safe to use for ".." detection because it
  // normalizes separators but does NOT collapse ".." segments.
  const normalized = normalizePath(rawTrimmed);
  const segments = normalized.replace(/\\/g, "/").split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error(`${label} "${normalized}" contains path traversal.`);
  }
}

// ---------------------------------------------------------------------------
// Export options
// ---------------------------------------------------------------------------

/** Controls which vault file sections are included in a .copilot export. */
export interface ExportContentOptions {
  customCommands: boolean;
  systemPrompts: boolean;
  savedMemories: boolean;
  recentConversations: boolean;
}

/** Default export options: everything on except recent conversations (privacy). */
export const DEFAULT_EXPORT_OPTIONS: ExportContentOptions = {
  customCommands: true,
  systemPrompts: true,
  savedMemories: true,
  recentConversations: false,
};

// ---------------------------------------------------------------------------
// Export-side: collect vault files
// ---------------------------------------------------------------------------

/**
 * Collect all direct-child .md files from a vault folder.
 *
 * @returns Array of portable files, or empty array if folder doesn't exist.
 */
async function collectMdFiles(appInstance: App, folder: string): Promise<PortableVaultFile[]> {
  if (!folder) return [];

  const files = listDirectChildMdFiles(folder);
  if (files.length === 0) {
    logInfo(`[vaultFiles] No .md files found in "${folder}", skipping collection.`);
    return [];
  }

  const results: PortableVaultFile[] = [];
  for (const file of files) {
    const content = await appInstance.vault.read(file);
    results.push({ filename: file.name, content });
  }

  return results;
}

/**
 * Read a single memory file, returning null if it doesn't exist.
 */
async function readMemoryFile(appInstance: App, filePath: string): Promise<string | null> {
  const normalized = normalizePath(filePath);
  const file = appInstance.vault.getAbstractFileByPath(normalized);
  if (!file || !(file instanceof TFile)) return null;
  return appInstance.vault.read(file);
}

/**
 * Collect vault files based on export options.
 *
 * @param appInstance - Obsidian App for vault file access.
 * @param options - Controls which sections to include. Defaults to all on
 *   except recent conversations.
 */
export async function collectAllVaultFiles(
  appInstance: App,
  options: ExportContentOptions = DEFAULT_EXPORT_OPTIONS
): Promise<CollectedVaultFiles> {
  const settings = getSettings();
  const memoryFolder = (settings.memoryFolderName || "").trim();

  const [customCommands, systemPrompts, recentConversations, savedMemories] = await Promise.all([
    options.customCommands
      ? collectMdFiles(appInstance, settings.customPromptsFolder)
      : Promise.resolve([]),
    options.systemPrompts
      ? collectMdFiles(appInstance, settings.userSystemPromptsFolder)
      : Promise.resolve([]),
    // Reason: skip memory file reads when memoryFolderName is blank — building
    // a path like "/filename.md" from an empty prefix would look up the vault
    // root, which is incorrect.
    options.recentConversations && memoryFolder
      ? readMemoryFile(appInstance, `${memoryFolder}/${MEMORY_RECENT_CONVERSATIONS_FILENAME}`)
      : Promise.resolve(null),
    options.savedMemories && memoryFolder
      ? readMemoryFile(appInstance, `${memoryFolder}/${MEMORY_SAVED_MEMORIES_FILENAME}`)
      : Promise.resolve(null),
  ]);

  return {
    customCommands,
    systemPrompts,
    memory: { recentConversations, savedMemories },
  };
}

// ---------------------------------------------------------------------------
// Import-side: restore vault files
// ---------------------------------------------------------------------------

/**
 * Write a single file to the vault, creating or overwriting as needed.
 *
 * @returns true if written successfully, false otherwise.
 */
async function writeVaultFile(
  appInstance: App,
  folderPath: string,
  filename: string,
  content: string,
  errors: string[],
  rollback: RestoreRollbackEntry[]
): Promise<boolean> {
  try {
    assertSafeFilename(filename);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `Unsafe filename: ${filename}`);
    return false;
  }

  const fullPath = normalizePath(`${folderPath}/${filename}`);

  try {
    const existing = appInstance.vault.getAbstractFileByPath(fullPath);
    // Reason: capture previous content BEFORE overwriting so rollback can restore it.
    const previousContent =
      existing && existing instanceof TFile ? await appInstance.vault.read(existing) : null;

    if (existing && existing instanceof TFile) {
      await appInstance.vault.modify(existing, content);
    } else {
      await appInstance.vault.create(fullPath, content);
    }
    rollback.push({ path: fullPath, previousContent });
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to write "${fullPath}": ${msg}`);
    return false;
  }
}

/**
 * Restore vault files to the target vault using paths from importedSettings.
 *
 * Reason: uses importedSettings (not getSettings()) because the imported
 * folder paths may differ from the current vault's paths, and settings
 * have not been persisted yet at this point.
 *
 * @param appInstance - Obsidian App instance.
 * @param files - Collected vault files to restore.
 * @param importedSettings - Settings from the imported config file.
 * @returns Summary of what was written and any errors encountered.
 */
export async function restoreVaultFiles(
  appInstance: App,
  files: CollectedVaultFiles,
  importedSettings: CopilotSettings
): Promise<RestoreResult> {
  const result: RestoreResult = {
    commandsWritten: 0,
    promptsWritten: 0,
    memoryWritten: 0,
    errors: [],
    rollback: [],
  };

  const commandsFolder = importedSettings.customPromptsFolder;
  const promptsFolder = importedSettings.userSystemPromptsFolder;
  const memoryFolder = importedSettings.memoryFolderName;

  // Reason: only validate and create folders for sections that actually have
  // content to restore. This keeps import/export symmetric — export allows
  // empty folder paths (unconfigured features), so import must too.
  const hasCommands = files.customCommands.length > 0;
  const hasPrompts = files.systemPrompts.length > 0;
  const hasMemory =
    files.memory.recentConversations != null || files.memory.savedMemories != null;

  try {
    if (hasCommands) assertSafeVaultRelativePath(commandsFolder, "Custom commands folder");
    if (hasPrompts) assertSafeVaultRelativePath(promptsFolder, "System prompts folder");
    if (hasMemory) assertSafeVaultRelativePath(memoryFolder, "Memory folder");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Unsafe folder path: ${msg}`);
    return result;
  }

  // Ensure target folders exist before writing
  try {
    if (hasCommands) await ensureFolderExists(commandsFolder);
    if (hasPrompts) await ensureFolderExists(promptsFolder);
    if (hasMemory) await ensureFolderExists(memoryFolder);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to create folders: ${msg}`);
    return result;
  }

  // Write custom commands
  for (const file of files.customCommands) {
    const ok = await writeVaultFile(
      appInstance,
      commandsFolder,
      file.filename,
      file.content,
      result.errors,
      result.rollback
    );
    if (ok) result.commandsWritten++;
  }

  // Write system prompts
  for (const file of files.systemPrompts) {
    const ok = await writeVaultFile(
      appInstance,
      promptsFolder,
      file.filename,
      file.content,
      result.errors,
      result.rollback
    );
    if (ok) result.promptsWritten++;
  }

  // Write memory files (fixed names)
  if (files.memory.recentConversations != null) {
    const ok = await writeVaultFile(
      appInstance,
      memoryFolder,
      MEMORY_RECENT_CONVERSATIONS_FILENAME,
      files.memory.recentConversations,
      result.errors,
      result.rollback
    );
    if (ok) result.memoryWritten++;
  }
  if (files.memory.savedMemories != null) {
    const ok = await writeVaultFile(
      appInstance,
      memoryFolder,
      MEMORY_SAVED_MEMORIES_FILENAME,
      files.memory.savedMemories,
      result.errors,
      result.rollback
    );
    if (ok) result.memoryWritten++;
  }

  if (result.errors.length > 0) {
    logWarn("[vaultFiles] Some files failed to restore:", result.errors);
  }

  logInfo(
    `[vaultFiles] Restored: ${result.commandsWritten} commands, ` +
      `${result.promptsWritten} prompts, ${result.memoryWritten} memory files.`
  );

  return result;
}

/**
 * Undo vault file writes recorded in a RestoreResult.rollback array.
 *
 * Reason: when a later step of the import flow fails (e.g. settings persistence),
 * files that were already written must be reverted so the vault is not left
 * in a half-imported state. Processes entries in reverse order so that the
 * earliest write is undone last.
 */
/**
 * @returns Paths that could not be rolled back (empty if fully successful).
 */
export async function rollbackVaultFiles(
  appInstance: App,
  rollback: RestoreRollbackEntry[]
): Promise<string[]> {
  const failedPaths: string[] = [];
  for (const entry of [...rollback].reverse()) {
    try {
      const existing = appInstance.vault.getAbstractFileByPath(entry.path);
      if (entry.previousContent == null) {
        // File was newly created — delete it
        if (existing && existing instanceof TFile) {
          await appInstance.vault.delete(existing);
        }
      } else {
        // File was overwritten — restore original content.
        // Reason: recreate if file was deleted before rollback runs,
        // so the vault returns to its pre-import state.
        if (existing instanceof TFile) {
          await appInstance.vault.modify(existing, entry.previousContent);
        } else {
          await appInstance.vault.create(entry.path, entry.previousContent);
        }
      }
    } catch (error) {
      // Reason: best-effort rollback — log but don't throw so remaining entries are still processed.
      logWarn(`[vaultFiles] Rollback failed for "${entry.path}":`, error);
      failedPaths.push(entry.path);
    }
  }
  return failedPaths;
}
