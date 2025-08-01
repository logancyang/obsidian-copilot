import { addSelectedTextContext, getChainType } from "@/aiParams";
import { FileCache } from "@/cache/fileCache";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { ChainType } from "@/chainFactory";

import { DebugSearchModal } from "@/components/modals/DebugSearchModal";
import { OramaSearchModal } from "@/components/modals/OramaSearchModal";
import { RemoveFromIndexModal } from "@/components/modals/RemoveFromIndexModal";
import CopilotPlugin from "@/main";
import { getAllQAMarkdownContent } from "@/search/searchUtils";
import { CopilotSettings, getSettings, updateSetting } from "@/settings/model";
import { SelectedTextContext } from "@/types/message";
import { Editor, Notice, TFile, MarkdownView } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { COMMAND_IDS, COMMAND_NAMES, CommandId } from "../constants";
import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { EMPTY_COMMAND } from "@/commands/constants";
import { getCachedCustomCommands } from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { QUICK_COMMAND_CODE_BLOCK } from "@/commands/constants";
import { removeQuickCommandBlocks } from "@/commands/customCommandUtils";
import { isLivePreviewModeOn } from "@/utils";
import { ApplyCustomCommandModal } from "@/components/modals/ApplyCustomCommandModal";

/**
 * Add a command to the plugin.
 */
export function addCommand(plugin: CopilotPlugin, id: CommandId, callback: () => void) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    callback,
  });
}

/**
 * Add an editor command to the plugin.
 */
function addEditorCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (editor: Editor) => void
) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    editorCallback: callback,
  });
}

/**
 * Add a check command to the plugin.
 */
export function addCheckCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (checking: boolean) => boolean | void
) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    checkCallback: callback,
  });
}

export function registerCommands(
  plugin: CopilotPlugin,
  prev: CopilotSettings | undefined,
  next: CopilotSettings
) {
  addEditorCommand(plugin, COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION, async (editor: Editor) => {
    const selectedText = await editor.getSelection();
    const wordCount = selectedText.split(" ").length;
    const tokenCount = await plugin.projectManager
      .getCurrentChainManager()
      .chatModelManager.countTokens(selectedText);
    new Notice(`Selected text contains ${wordCount} words and ${tokenCount} tokens.`);
  });

  addCommand(plugin, COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS, async () => {
    try {
      const allContent = await getAllQAMarkdownContent(plugin.app);
      const totalTokens = await plugin.projectManager
        .getCurrentChainManager()
        .chatModelManager.countTokens(allContent);
      new Notice(`Total tokens in your vault: ${totalTokens}`);
    } catch (error) {
      console.error("Error counting tokens: ", error);
      new Notice("An error occurred while counting tokens.");
    }
  });

  addCommand(plugin, COMMAND_IDS.TOGGLE_COPILOT_CHAT_WINDOW, () => {
    plugin.toggleView();
  });

  addCommand(plugin, COMMAND_IDS.OPEN_COPILOT_CHAT_WINDOW, () => {
    plugin.activateView();
  });

  addCommand(plugin, COMMAND_IDS.NEW_CHAT, () => {
    plugin.newChat();
  });

  addCheckCommand(plugin, COMMAND_IDS.TRIGGER_QUICK_COMMAND, (checking: boolean) => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (checking) {
      // Return true only if we're in live preview mode
      return !!(isLivePreviewModeOn() && activeView && activeView.editor);
    }

    // Need to check this again because it can still be triggered via shortcut.
    if (!isLivePreviewModeOn()) {
      new Notice("Quick commands are only available in live preview mode.");
      return false;
    }

    // When not checking, execute the command
    if (!activeView || !activeView.editor) {
      new Notice("No active editor found.");
      return false;
    }

    const editor = activeView.editor;
    const selectedText = editor.getSelection();

    if (!selectedText.trim()) {
      new Notice("Please select some text first. Selected text is required for quick commands.");
      return false;
    }

    removeQuickCommandBlocks(editor);

    // Get the current cursor/selection position (after potential content update)
    const cursor = editor.getCursor("from");
    const line = cursor.line;

    // Insert the quick command code block above the selected text
    const codeBlock = `\`\`\`${QUICK_COMMAND_CODE_BLOCK}\n\`\`\`\n`;
    editor.replaceRange(codeBlock, { line, ch: 0 });

    return true;
  });

  addCommand(plugin, COMMAND_IDS.CLEAR_LOCAL_COPILOT_INDEX, async () => {
    await plugin.vectorStoreManager.clearIndex();
  });

  addCommand(plugin, COMMAND_IDS.GARBAGE_COLLECT_COPILOT_INDEX, async () => {
    try {
      const removedDocs = await plugin.vectorStoreManager.garbageCollectVectorStore();
      new Notice(`${removedDocs} documents removed from Copilot index.`);
    } catch (err) {
      console.error("Error garbage collecting the Copilot index:", err);
      new Notice("An error occurred while garbage collecting the Copilot index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.INDEX_VAULT_TO_COPILOT_INDEX, async () => {
    try {
      const indexedFileCount = await plugin.vectorStoreManager.indexVaultToVectorStore();

      new Notice(`${indexedFileCount} vault files indexed to Copilot index.`);
    } catch (err) {
      console.error("Error indexing vault to Copilot index:", err);
      new Notice("An error occurred while indexing vault to Copilot index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.FORCE_REINDEX_VAULT_TO_COPILOT_INDEX, async () => {
    try {
      const indexedFileCount = await plugin.vectorStoreManager.indexVaultToVectorStore(true);

      new Notice(`${indexedFileCount} vault files re-indexed to Copilot index.`);
    } catch (err) {
      console.error("Error re-indexing vault to Copilot index:", err);
      new Notice("An error occurred while re-indexing vault to Copilot index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION, () => {
    plugin.loadCopilotChatHistory();
  });

  addCommand(plugin, COMMAND_IDS.LIST_INDEXED_FILES, async () => {
    try {
      const indexedFiles = await plugin.vectorStoreManager.getIndexedFiles();
      const indexedFilePaths = new Set(indexedFiles);
      const allMarkdownFiles = plugin.app.vault.getMarkdownFiles();
      const emptyFiles = new Set<string>();
      const unindexedFiles = new Set<string>();
      const filesWithoutEmbeddings = new Set<string>();

      // Get dbOps for checking embeddings
      const dbOps = await plugin.vectorStoreManager.getDbOps();

      // Categorize files
      for (const file of allMarkdownFiles) {
        const content = await plugin.app.vault.cachedRead(file);
        if (!content || content.trim().length === 0) {
          emptyFiles.add(file.path);
        } else if (!indexedFilePaths.has(file.path)) {
          unindexedFiles.add(file.path);
        } else {
          // Check if file has embeddings
          const hasEmbeddings = await dbOps.hasEmbeddings(file.path);
          if (!hasEmbeddings) {
            filesWithoutEmbeddings.add(file.path);
          }
        }
      }

      if (indexedFiles.length === 0 && emptyFiles.size === 0 && unindexedFiles.size === 0) {
        new Notice("No files found to list.");
        return;
      }

      // Create content for the file
      const content = [
        "# Copilot Files Status",
        `- Indexed files: ${indexedFiles.length}`,
        `	- Files missing embeddings: ${filesWithoutEmbeddings.size}`,
        `- Unindexed files: ${unindexedFiles.size}`,
        `- Empty files: ${emptyFiles.size}`,
        "",
        "## Indexed Files",
        ...indexedFiles.map((file) => {
          const noEmbedding = filesWithoutEmbeddings.has(file);
          return `- [[${file}]]${noEmbedding ? " *(embedding missing)*" : ""}`;
        }),
        "",
        "## Unindexed Files",
        ...(unindexedFiles.size > 0
          ? Array.from(unindexedFiles)
              .sort()
              .map((file) => `- [[${file}]]`)
          : ["No unindexed files found."]),
        "",
        "## Empty Files",
        ...(emptyFiles.size > 0
          ? Array.from(emptyFiles)
              .sort()
              .map((file) => `- [[${file}]]`)
          : ["No empty files found."]),
      ].join("\n");

      // Create or update the file in the vault
      const fileName = `Copilot-Indexed-Files-${new Date().toLocaleDateString().replace(/\//g, "-")}.md`;
      const filePath = `${fileName}`;

      const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        await plugin.app.vault.modify(existingFile, content);
      } else {
        await plugin.app.vault.create(filePath, content);
      }

      // Open the file
      const file = plugin.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await plugin.app.workspace.getLeaf().openFile(file);
        new Notice(`Listed ${indexedFiles.length} indexed files`);
      }
    } catch (error) {
      console.error("Error listing indexed files:", error);
      new Notice("Failed to list indexed files.");
    }
  });

  // Debug commands (only when debug mode is enabled)
  if (next.debug) {
    addCommand(plugin, COMMAND_IDS.INSPECT_COPILOT_INDEX_BY_NOTE_PATHS, () => {
      new OramaSearchModal(plugin.app, plugin).open();
    });

    addCommand(plugin, COMMAND_IDS.SEARCH_ORAMA_DB, () => {
      new DebugSearchModal(plugin.app, plugin).open();
    });

    addCommand(plugin, COMMAND_IDS.REMOVE_FILES_FROM_COPILOT_INDEX, async () => {
      new RemoveFromIndexModal(plugin.app, async (filePaths: string[]) => {
        const dbOps = await plugin.vectorStoreManager.getDbOps();
        try {
          for (const path of filePaths) {
            await dbOps.removeDocs(path);
          }
          await dbOps.saveDB();
          new Notice(`Successfully removed ${filePaths.length} files from the index.`);
        } catch (err) {
          console.error("Error removing files from index:", err);
          new Notice("An error occurred while removing files from the index.");
        }
      }).open();
    });
  }

  // Add clear Copilot cache command
  addCommand(plugin, COMMAND_IDS.CLEAR_COPILOT_CACHE, async () => {
    try {
      await plugin.fileParserManager.clearPDFCache();

      // Clear project context cache
      await ProjectContextCache.getInstance().clearAllCache();

      // Clear file content cache (get FileCache instance and clear it)
      const fileCache = FileCache.getInstance<string>();
      await fileCache.clear();

      // Clear autocomplete cache
      const { AutocompleteCache } = await import("@/cache/autocompleteCache");
      AutocompleteCache.getInstance().clear();

      new Notice("All Copilot caches cleared successfully");
    } catch (error) {
      console.error("Error clearing Copilot caches:", error);
      new Notice("Failed to clear Copilot caches");
    }
  });

  // Add toggle autocomplete command
  addCommand(plugin, COMMAND_IDS.TOGGLE_AUTOCOMPLETE, () => {
    const currentSettings = getSettings();
    const newValue = !currentSettings.enableAutocomplete;
    updateSetting("enableAutocomplete", newValue);
    new Notice(`Copilot autocomplete ${newValue ? "enabled" : "disabled"}`);
  });

  // Add selection to chat context command
  addEditorCommand(plugin, COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT, async (editor: Editor) => {
    // Check if we're in Copilot Plus mode
    const currentChainType = getChainType();
    if (
      currentChainType !== ChainType.COPILOT_PLUS_CHAIN &&
      currentChainType !== ChainType.PROJECT_CHAIN
    ) {
      new Notice("Selected text context is only available in Copilot Plus and Project modes");
      return;
    }

    const selectedText = editor.getSelection();
    if (!selectedText) {
      new Notice("No text selected");
      return;
    }

    const activeFile = plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    // Get selection range to determine line numbers
    const selectionRange = editor.listSelections()[0];
    if (!selectionRange) {
      new Notice("Could not determine selection range");
      return;
    }

    const startLine = selectionRange.anchor.line + 1; // Convert to 1-based line numbers
    const endLine = selectionRange.head.line + 1;

    // Create selected text context
    const selectedTextContext: SelectedTextContext = {
      id: uuidv4(),
      content: selectedText,
      noteTitle: activeFile.basename,
      notePath: activeFile.path,
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
    };

    // Add to selected text contexts atom
    addSelectedTextContext(selectedTextContext);

    // Open chat window to show the context was added
    plugin.activateView();
  });

  // Add command to create a new custom command
  addCommand(plugin, COMMAND_IDS.ADD_CUSTOM_COMMAND, async () => {
    const commands = getCachedCustomCommands();
    const newCommand = { ...EMPTY_COMMAND };
    const modal = new CustomCommandSettingsModal(
      plugin.app,
      commands,
      newCommand,
      async (updatedCommand) => {
        await CustomCommandManager.getInstance().createCommand(updatedCommand);
      }
    );
    modal.open();
  });

  // Add command to apply a custom command
  addCommand(plugin, COMMAND_IDS.APPLY_CUSTOM_COMMAND, () => {
    const modal = new ApplyCustomCommandModal(plugin.app);
    modal.open();
  });
}
