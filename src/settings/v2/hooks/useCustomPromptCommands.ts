import { useState, useEffect } from "react";
import { CustomPromptProcessor, CustomPrompt } from "@/customPromptProcessor";
import { TFile } from "obsidian";

export interface CustomPromptCommand {
  name: string;
  prompt: string;
  showInContextMenu: boolean;
  filePath: string;
}

export function useCustomPromptCommands(): {
  commands: CustomPromptCommand[];
  updateContextMenuSetting: (filePath: string, enabled: boolean) => Promise<void>;
} {
  const [commands, setCommands] = useState<CustomPromptCommand[]>([]);

  const loadCommands = async () => {
    try {
      if (!app?.vault) return;

      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);
      const prompts: CustomPrompt[] = await customPromptProcessor.getAllPrompts();

      const commandsFromPrompts: CustomPromptCommand[] = prompts.map((prompt) => ({
        name: prompt.title,
        prompt: prompt.content,
        showInContextMenu: prompt.showInContextMenu,
        filePath: prompt.filePath,
      }));

      setCommands(commandsFromPrompts);
    } catch (error) {
      console.error("Failed to load custom prompt commands:", error);
      setCommands([]);
    }
  };

  const updateContextMenuSetting = async (filePath: string, enabled: boolean) => {
    try {
      if (!app?.vault) return;

      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);
      await customPromptProcessor.updatePromptContextMenuSetting(filePath, enabled);

      // Wait for metadata cache to update before reloading commands
      await new Promise((resolve) => {
        const checkCache = () => {
          const file = app.vault.getAbstractFileByPath(filePath);
          if (file instanceof TFile) {
            const metadata = app.metadataCache.getFileCache(file);
            const currentValue = metadata?.frontmatter?.["copilot-command-context-menu-enabled"];

            // Check if the cache has been updated with the new value
            if (currentValue === enabled) {
              resolve(undefined);
              return;
            }
          }

          // If not updated yet, check again in a short time
          setTimeout(checkCache, 50);
        };

        checkCache();
      });

      // Reload commands to reflect the change
      await loadCommands();
    } catch (error) {
      console.error("Failed to update context menu setting:", error);
    }
  };

  useEffect(() => {
    loadCommands();
  }, []);

  return { commands, updateContextMenuSetting };
}
