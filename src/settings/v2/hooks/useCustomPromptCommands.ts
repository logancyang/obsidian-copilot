import { useState, useEffect } from "react";
import {
  CustomPromptProcessor,
  CustomPrompt,
  COPILOT_COMMAND_CONTEXT_MENU_ENABLED,
  COPILOT_COMMAND_SLASH_ENABLED,
  COPILOT_COMMAND_CONTEXT_MENU_ORDER,
} from "@/customPromptProcessor";
import { TFile } from "obsidian";

export interface CustomPromptCommand {
  name: string;
  prompt: string;
  showInContextMenu: boolean;
  slashCommandEnabled: boolean;
  filePath: string;
  order: number;
}

export function useCustomPromptCommands(): {
  commands: CustomPromptCommand[];
  updateContextMenuSetting: (filePath: string, enabled: boolean) => Promise<void>;
  updateSlashCommandSetting: (filePath: string, enabled: boolean) => Promise<void>;
  updateOrder: (filePath: string, order: number, skipReload?: boolean) => Promise<void>;
  reloadCommands: () => Promise<void>;
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
        slashCommandEnabled: prompt.slashCommandEnabled,
        filePath: prompt.filePath,
        order: prompt.order,
      }));

      setCommands(commandsFromPrompts);
    } catch (error) {
      console.error("Failed to load custom prompt commands:", error);
      setCommands([]);
    }
  };

  // Helper function to wait for metadata cache to update with expected value
  const waitForMetadataUpdate = async (
    filePath: string,
    propertyName: string,
    expectedValue: any
  ): Promise<void> => {
    return new Promise((resolve) => {
      const checkCache = () => {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const metadata = app.metadataCache.getFileCache(file);
          const currentValue = metadata?.frontmatter?.[propertyName];

          // Check if the cache has been updated with the new value
          if (currentValue === expectedValue) {
            resolve(undefined);
            return;
          }
        }

        // If not updated yet, check again in a short time
        setTimeout(checkCache, 50);
      };

      checkCache();
    });
  };

  const updateContextMenuSetting = async (filePath: string, enabled: boolean) => {
    try {
      if (!app?.vault) return;

      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);
      await customPromptProcessor.updatePromptContextMenuSetting(filePath, enabled);

      await waitForMetadataUpdate(filePath, COPILOT_COMMAND_CONTEXT_MENU_ENABLED, enabled);

      await loadCommands();
    } catch (error) {
      console.error("Failed to update context menu setting:", error);
    }
  };

  const updateSlashCommandSetting = async (filePath: string, enabled: boolean) => {
    try {
      if (!app?.vault) return;

      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);
      await customPromptProcessor.updatePromptSlashCommandSetting(filePath, enabled);

      await waitForMetadataUpdate(filePath, COPILOT_COMMAND_SLASH_ENABLED, enabled);

      await loadCommands();
    } catch (error) {
      console.error("Failed to update slash command setting:", error);
    }
  };

  const updateOrder = async (filePath: string, order: number, skipReload?: boolean) => {
    try {
      if (!app?.vault) return;

      const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault);
      await customPromptProcessor.updatePromptOrder(filePath, order);

      // Wait for metadata cache to update before reloading commands
      await waitForMetadataUpdate(filePath, COPILOT_COMMAND_CONTEXT_MENU_ORDER, order);

      // Reload commands to reflect the change (unless skipped for batch operations)
      if (!skipReload) {
        await loadCommands();
      }
    } catch (error) {
      console.error("Failed to update command order:", error);
    }
  };

  useEffect(() => {
    loadCommands();
  }, []);

  return {
    commands,
    updateContextMenuSetting,
    updateSlashCommandSetting,
    updateOrder,
    reloadCommands: loadCommands,
  };
}
