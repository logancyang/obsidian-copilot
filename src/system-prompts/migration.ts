import { TFile, Vault } from "obsidian";
import {
  ensurePromptFrontmatter,
  getPromptFilePath,
  getSystemPromptsFolder,
  loadAllSystemPrompts,
} from "@/system-prompts/systemPromptUtils";
import { UserSystemPrompt } from "@/system-prompts/type";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ensureFolderExists, stripFrontmatter } from "@/utils";

/**
 * Default name for migrated system prompt
 */
const MIGRATED_PROMPT_NAME = "Migrated Custom System Prompt";

/**
 * Generate a unique prompt name by appending a number suffix if the base name exists
 * @param baseName - The base name to start with
 * @param vault - The vault to check for existing files
 * @returns A unique prompt name that doesn't conflict with existing files
 */
function generateUniquePromptName(baseName: string, vault: Vault): string {
  let name = baseName;
  let counter = 1;

  // Keep incrementing until we find a name that doesn't exist
  while (vault.getAbstractFileByPath(getPromptFilePath(name))) {
    counter++;
    name = `${baseName} ${counter}`;
  }

  return name;
}

/**
 * Normalize line endings to LF for consistent comparison
 * Reason: File systems may convert CRLF to LF on write, causing false mismatches
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Save failed migration to unsupported folder
 * Reference: Similar to custom command's saveUnsupportedCommands pattern
 * @param vault - Vault instance
 * @param content - Original content to save
 * @param reason - Reason for migration failure
 * @returns Path to the created file
 */
async function saveFailedMigrationToUnsupported(
  vault: Vault,
  content: string,
  reason: string
): Promise<string> {
  const folder = getSystemPromptsFolder();
  const unsupportedFolder = `${folder}/unsupported`;
  await ensureFolderExists(unsupportedFolder);

  // Generate unique filename to avoid conflicts
  const baseName = "Migrated System Prompt (Failed Verification)";
  let fileName = baseName;
  let counter = 1;

  // Check if file exists and generate unique name if needed
  while (vault.getAbstractFileByPath(`${unsupportedFolder}/${fileName}.md`)) {
    counter++;
    fileName = `${baseName} ${counter}`;
  }

  const filePath = `${unsupportedFolder}/${fileName}.md`;

  // Prepend error message to content
  const contentWithError = `> Migration failed: ${reason}
>
> To fix: Review the content below, then move this file to ${folder}

${content}`;

  await vault.create(filePath, contentWithError);
  return filePath;
}

/**
 * Verify that migrated content matches the original legacy prompt
 * This is the "write-then-verify" safety check
 * @param vault - Vault instance used to read back file content
 * @param file - The file to verify
 * @param originalContent - The original content that should have been saved
 * @returns true if content matches, false otherwise
 */
async function verifyMigratedContent(
  vault: Vault,
  file: TFile,
  originalContent: string
): Promise<boolean> {
  try {
    const rawContent = await vault.read(file);
    const savedContent = stripFrontmatter(rawContent, { trimStart: false });

    // Normalize line endings and strip leading newlines for comparison
    // Reason: Obsidian may insert extra blank line after frontmatter (---\n\n),
    // but stripFrontmatter only removes one, causing false verification failures
    const savedNormalized = normalizeLineEndings(savedContent).replace(/^\n+/, "");
    const originalNormalized = normalizeLineEndings(originalContent).replace(/^\n+/, "");

    if (savedNormalized !== originalNormalized) {
      logWarn(
        `Migration verification failed: content mismatch. ` +
          `Expected ${originalNormalized.length} chars, got ${savedNormalized.length} chars`
      );
      return false;
    }

    return true;
  } catch (error) {
    logError("Migration verification failed: unable to read back file", error);
    return false;
  }
}

/**
 * Migrate the legacy userSystemPrompt from settings to a file
 * Automatically migrates and shows a notification modal to inform the user
 *
 * Safety guarantees:
 * 1. If target file exists, generates a unique name (never overwrites)
 * 2. After writing, reads back and verifies content matches
 * 3. If verification fails, saves to unsupported/ folder for manual recovery
 * 4. Only clears userSystemPrompt after successfully saving to file system (normal or unsupported)
 * 5. If all save attempts fail, preserves userSystemPrompt for data safety
 */
export async function migrateSystemPromptsFromSettings(vault: Vault): Promise<void> {
  const settings = getSettings();
  const legacyPrompt = settings.userSystemPrompt;

  // Skip if empty or already migrated
  if (!legacyPrompt || legacyPrompt.trim().length === 0) {
    logInfo("No legacy userSystemPrompt to migrate");
    return;
  }

  try {
    logInfo("Migrating legacy userSystemPrompt from settings to file system");

    // Ensure the system prompts folder exists (creates nested folders recursively)
    const folder = getSystemPromptsFolder();
    await ensureFolderExists(folder);

    // Generate a unique name if default name already exists
    // Reason: Prevents data loss when file exists with different content
    const promptName = generateUniquePromptName(MIGRATED_PROMPT_NAME, vault);
    const filePath = getPromptFilePath(promptName);

    if (promptName !== MIGRATED_PROMPT_NAME) {
      logInfo(`Default name already exists, using unique name: "${promptName}"`);
    }

    const now = Date.now();
    // Normalize line endings but preserve whitespace (consistent with command migration)
    const normalizedContent = normalizeLineEndings(legacyPrompt);
    const newPrompt: UserSystemPrompt = {
      title: promptName,
      content: normalizedContent,
      createdMs: now,
      modifiedMs: now,
      lastUsedMs: 0,
    };

    // Step 1: Create the file
    await vault.create(filePath, normalizedContent);

    // Step 2: Add frontmatter
    const file = vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error("File not found after creation");
    }

    await ensurePromptFrontmatter(file, newPrompt);

    // Step 3: Write-then-verify - read back and confirm content matches
    // Reason: Ensures data was actually persisted before marking migration complete
    const verificationPassed = await verifyMigratedContent(vault, file, legacyPrompt);

    if (verificationPassed) {
      // ✅ Verification succeeded - set as default and show success
      updateSetting("defaultSystemPromptTitle", promptName);

      // Best-effort: Try to reload prompts, but don't fail migration if reload fails
      try {
        await loadAllSystemPrompts();
      } catch (loadError) {
        logWarn("Failed to reload prompts after migration:", loadError);
      }

      // Clear legacy field - data is safely in file system
      updateSetting("userSystemPrompt", "");
      logInfo("Cleared legacy userSystemPrompt field");

      new ConfirmModal(
        app,
        () => {},
        `We have upgraded your system prompt to the new file-based format. It is now stored as "${promptName}" in ${folder}.\n\nYou can now:\n• Edit your system prompt directly in the file\n• Create multiple system prompts\n• Manage prompts through the settings UI\n\nYour migrated prompt has been set as the default system prompt.`,
        "🚀 System Prompt Upgraded",
        "OK",
        ""
      ).open();
    } else {
      // ❌ Verification failed - save to unsupported folder and notify user
      const unsupportedPath = await saveFailedMigrationToUnsupported(
        vault,
        legacyPrompt,
        "content verification mismatch"
      );

      // Best-effort: Try to reload prompts, but don't fail if reload fails
      try {
        await loadAllSystemPrompts();
      } catch (loadError) {
        logWarn("Failed to reload prompts after failed migration:", loadError);
      }

      // Clear legacy field - data is safely in unsupported folder
      updateSetting("userSystemPrompt", "");
      logInfo("Cleared legacy userSystemPrompt field (saved to unsupported)");

      new ConfirmModal(
        app,
        () => {},
        `⚠️ System Prompt Migration Issue

Your system prompt was migrated but verification failed. Your data has been saved to:

${unsupportedPath}

To recover:
1. Open the file and review the content
2. Move it to ${folder}
3. The prompt will be available immediately`,
        "Migration Verification Failed",
        "OK",
        ""
      ).open();
    }
  } catch (error) {
    // On any error, try to save to unsupported folder before clearing (best-effort data preservation)
    logError("Failed to migrate legacy userSystemPrompt:", error);

    // Best-effort: Try to save legacy prompt to unsupported folder
    try {
      const unsupportedPath = await saveFailedMigrationToUnsupported(
        vault,
        legacyPrompt,
        error.message || String(error)
      );

      // Clear legacy field - data is safely in unsupported folder
      updateSetting("userSystemPrompt", "");
      logInfo("Cleared legacy userSystemPrompt field (saved to unsupported after error)");

      new ConfirmModal(
        app,
        () => {},
        `⚠️ System Prompt Migration Failed

An error occurred during migration. Your data has been saved to:

${unsupportedPath}

To recover:
1. Open the file and review the content
2. Move it to ${getSystemPromptsFolder()}
3. The prompt will be available immediately`,
        "Migration Failed",
        "OK",
        ""
      ).open();
    } catch (saveError) {
      // Even saving to unsupported failed - DO NOT clear userSystemPrompt (preserve data)
      logError("Failed to save to unsupported folder:", saveError);
      logWarn("Preserving userSystemPrompt in settings for manual recovery");

      new ConfirmModal(
        app,
        () => {},
        `Failed to migrate system prompt: ${error.message}

Unable to save to file system. Your system prompt is still in settings and will continue to work.

Please check:
- Folder permissions for ${getSystemPromptsFolder()}
- Available disk space
- Vault is accessible

You can retry by reloading the plugin.`,
        "Migration Failed - Data Preserved",
        "OK",
        ""
      ).open();
    }
  }
}
