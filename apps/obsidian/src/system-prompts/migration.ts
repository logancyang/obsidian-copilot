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

const MIGRATED_PROMPT_NAME = "Migrated Custom System Prompt";

function generateUniquePromptName(baseName: string, vault: Vault): string {
  let name = baseName;
  let counter = 1;

  while (vault.getAbstractFileByPath(getPromptFilePath(name))) {
    counter++;
    name = `${baseName} ${counter}`;
  }

  return name;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function saveFailedMigrationToUnsupported(
  vault: Vault,
  content: string,
  reason: string
): Promise<string> {
  const folder = getSystemPromptsFolder();
  const unsupportedFolder = `${folder}/unsupported`;
  await ensureFolderExists(vault, unsupportedFolder);

  const baseName = "Migrated System Prompt (Failed Verification)";
  let fileName = baseName;
  let counter = 1;

  while (vault.getAbstractFileByPath(`${unsupportedFolder}/${fileName}.md`)) {
    counter++;
    fileName = `${baseName} ${counter}`;
  }

  const filePath = `${unsupportedFolder}/${fileName}.md`;

  const contentWithError = `> Migration failed: ${reason}
>
> To fix: Review the content below, then move this file to ${folder}

${content}`;

  await vault.create(filePath, contentWithError);
  return filePath;
}

async function verifyMigratedContent(
  vault: Vault,
  file: TFile,
  originalContent: string
): Promise<boolean> {
  try {
    const rawContent = await vault.read(file);
    const savedContent = stripFrontmatter(rawContent, { trimStart: false });

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

export async function migrateSystemPromptsFromSettings(
  app: App
): Promise<StartupMigrationItem | null> {
  const vault = app.vault;
  const settings = getSettings();
  const legacyPrompt = settings.userSystemPrompt;

  if (!legacyPrompt || legacyPrompt.trim().length === 0) {
    logInfo("No legacy userSystemPrompt to migrate");
    return null;
  }

  try {
    logInfo("Migrating legacy userSystemPrompt from settings to file system");

    const folder = getSystemPromptsFolder();
    await ensureFolderExists(vault, folder);

    const promptName = generateUniquePromptName(MIGRATED_PROMPT_NAME, vault);
    const filePath = getPromptFilePathInFolder(promptName, folder);

    if (promptName !== MIGRATED_PROMPT_NAME) {
      logInfo(`Default name already exists, using unique name: "${promptName}"`);
    }

    const now = Date.now();
    const normalizedContent = normalizeLineEndings(legacyPrompt);
    const newPrompt: UserSystemPrompt = {
      title: promptName,
      content: normalizedContent,
      createdMs: now,
      modifiedMs: now,
      lastUsedMs: 0,
    };

    await vault.create(filePath, normalizedContent);

    const file = vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error("File not found after creation");
    }

    await ensurePromptFrontmatter(app, file, newPrompt);

    const verificationPassed = await verifyMigratedContent(vault, file, legacyPrompt);

    if (verificationPassed) {
      updateSetting("defaultSystemPromptTitle", promptName);

      try {
        await loadAllSystemPrompts(app);
      } catch (loadError) {
        logWarn("Failed to reload prompts after migration:", loadError);
      }

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
      const unsupportedPath = await saveFailedMigrationToUnsupported(
        vault,
        legacyPrompt,
        "content verification mismatch"
      );

      try {
        await loadAllSystemPrompts(app);
      } catch (loadError) {
        logWarn("Failed to reload prompts after failed migration:", loadError);
      }

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
    logError("Failed to migrate legacy userSystemPrompt:", error);

    try {
      const unsupportedPath = await saveFailedMigrationToUnsupported(
        vault,
        legacyPrompt,
        errorMessage
      );

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
