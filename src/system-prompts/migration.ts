import { App, TFile, Vault } from "obsidian";
import {
  ensurePromptFrontmatter,
  getPromptFilePath,
  getPromptFilePathInFolder,
  getSystemPromptsFolder,
  loadAllSystemPrompts,
} from "@/system-prompts/systemPromptUtils";
import { UserSystemPrompt } from "@/system-prompts/type";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import type { StartupMigrationItem } from "@/services/startupMigration";
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
  await ensureFolderExists(vault, unsupportedFolder);

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
 * Automatically migrates and returns a result for the startup migration summary.
 *
 * Safety guarantees:
 * 1. If target file exists, generates a unique name (never overwrites)
 * 2. After writing, reads back and verifies content matches
 * 3. If verification fails, saves to unsupported/ folder for manual recovery
 * 4. Only clears userSystemPrompt after successfully saving to file system (normal or unsupported)
 * 5. If all save attempts fail, preserves userSystemPrompt for data safety
 */
export async function migrateSystemPromptsFromSettings(
  app: App
): Promise<StartupMigrationItem | null> {
  const vault = app.vault;
  const settings = getSettings();
  const legacyPrompt = settings.userSystemPrompt;

  // Skip if empty or already migrated
  if (!legacyPrompt || legacyPrompt.trim().length === 0) {
    logInfo("No legacy userSystemPrompt to migrate");
    return null;
  }

  try {
    logInfo("Migrating legacy userSystemPrompt from settings to file system");

    // Ensure the system prompts folder exists (creates nested folders recursively)
    const folder = getSystemPromptsFolder();
    await ensureFolderExists(vault, folder);

    // Generate a unique name if default name already exists
    // Reason: Prevents data loss when file exists with different content
    const promptName = generateUniquePromptName(MIGRATED_PROMPT_NAME, vault);
    // Same folder that was just ensured, not a fresh lookup.
    const filePath = getPromptFilePathInFolder(promptName, folder);

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

    await ensurePromptFrontmatter(app, file, newPrompt);

    // Step 3: Write-then-verify - read back and confirm content matches
    // Reason: Ensures data was actually persisted before marking migration complete
    const verificationPassed = await verifyMigratedContent(vault, file, legacyPrompt);

    if (verificationPassed) {
      // ✅ Verification succeeded - set as default
      updateSetting("defaultSystemPromptTitle", promptName);

      // Best-effort: Try to reload prompts, but don't fail migration if reload fails
      try {
        await loadAllSystemPrompts(app);
      } catch (loadError) {
        logWarn("Failed to reload prompts after migration:", loadError);
      }

      // Clear legacy field - data is safely in file system
      updateSetting("userSystemPrompt", "");
      logInfo("Cleared legacy userSystemPrompt field");

      return {
        id: "system-prompt",
        title: "System prompt",
        status: "success",
        summary: `Migrated "${promptName}" and set it as the default system prompt.`,
        details: [`Stored in ${filePath}.`],
      };
    } else {
      // ❌ Verification failed - save to unsupported folder and notify user
      const unsupportedPath = await saveFailedMigrationToUnsupported(
        vault,
        legacyPrompt,
        "content verification mismatch"
      );

      // Best-effort: Try to reload prompts, but don't fail if reload fails
      try {
        await loadAllSystemPrompts(app);
      } catch (loadError) {
        logWarn("Failed to reload prompts after failed migration:", loadError);
      }

      // Clear legacy field - data is safely in unsupported folder
      updateSetting("userSystemPrompt", "");
      logInfo("Cleared legacy userSystemPrompt field (saved to unsupported)");

      return {
        id: "system-prompt",
        title: "System prompt",
        status: "action-required",
        summary: "The prompt was preserved, but its migrated content could not be verified.",
        details: [
          `Review ${unsupportedPath}, then move it to ${folder} to make the prompt available.`,
        ],
      };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // On any error, try to save to unsupported folder before clearing (best-effort data preservation)
    logError("Failed to migrate legacy userSystemPrompt:", error);

    // Best-effort: Try to save legacy prompt to unsupported folder
    try {
      const unsupportedPath = await saveFailedMigrationToUnsupported(
        vault,
        legacyPrompt,
        errorMessage
      );

      // Clear legacy field - data is safely in unsupported folder
      updateSetting("userSystemPrompt", "");
      logInfo("Cleared legacy userSystemPrompt field (saved to unsupported after error)");

      return {
        id: "system-prompt",
        title: "System prompt",
        status: "action-required",
        summary: "The prompt migration failed, but the original content was preserved.",
        details: [
          `Review ${unsupportedPath}, then move it to ${getSystemPromptsFolder()} to make the prompt available.`,
        ],
      };
    } catch (saveError) {
      // Even saving to unsupported failed - DO NOT clear userSystemPrompt (preserve data)
      logError("Failed to save to unsupported folder:", saveError);
      logWarn("Preserving userSystemPrompt in settings for manual recovery");

      return {
        id: "system-prompt",
        title: "System prompt",
        status: "error",
        summary: "The prompt could not be migrated. It remains in settings and will be retried.",
        details: [
          errorMessage,
          `Check folder permissions and available disk space for ${getSystemPromptsFolder()}.`,
        ],
      };
    }
  }
}
