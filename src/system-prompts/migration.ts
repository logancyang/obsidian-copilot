import { TFile, Vault } from "obsidian";
import {
  ensurePromptFrontmatter,
  getPromptFilePath,
  getSystemPromptsFolder,
  loadAllSystemPrompts,
} from "@/system-prompts/systemPromptUtils";
import { UserSystemPrompt } from "@/system-prompts/type";
import { logError, logInfo } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ensureFolderExists } from "@/utils";

/**
 * Default name for migrated system prompt
 */
const MIGRATED_PROMPT_NAME = "Migrated Custom System Prompt";

/**
 * Migrate the legacy userSystemPrompt from settings to a file
 * Automatically migrates and shows a notification modal to inform the user
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

    // Create a prompt file with default name
    const promptName = MIGRATED_PROMPT_NAME;
    const filePath = getPromptFilePath(promptName);
    const existingFile = vault.getAbstractFileByPath(filePath);

    // Skip if file already exists (avoid overwriting)
    if (existingFile) {
      logInfo(`File "${promptName}" already exists, skipping legacy prompt migration`);
      // Clear the legacy field and set as default
      updateSetting("userSystemPrompt", "");
      updateSetting("defaultSystemPromptTitle", promptName);
      return;
    }

    const now = Date.now();
    const newPrompt: UserSystemPrompt = {
      title: promptName,
      content: legacyPrompt.trim(),
      createdMs: now,
      modifiedMs: now,
      lastUsedMs: 0,
    };

    // Create the file
    await vault.create(filePath, legacyPrompt.trim());

    // Add frontmatter
    const file = vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await ensurePromptFrontmatter(file, newPrompt);
      logInfo(`Successfully migrated legacy userSystemPrompt to "${promptName}"`);

      // Clear the legacy userSystemPrompt field after successful migration
      updateSetting("userSystemPrompt", "");

      // Set the migrated prompt as the new default
      updateSetting("defaultSystemPromptTitle", promptName);
    }

    // Reload all prompts to update cache
    await loadAllSystemPrompts();

    // Show notification modal to inform user
    new ConfirmModal(
      app,
      () => {},
      `We have upgraded your system prompt to the new file-based format. It is now stored as "${promptName}" in ${folder}.\n\nYou can now:\n• Edit your system prompt directly in the file\n• Create multiple system prompts\n• Manage prompts through the settings UI\n\nYour migrated prompt has been set as the default system prompt.`,
      "🚀 System Prompt Upgraded",
      "OK",
      ""
    ).open();
  } catch (error) {
    logError("Failed to migrate legacy userSystemPrompt:", error);
  }
}
