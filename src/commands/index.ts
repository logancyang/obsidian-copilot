import { AddPromptModal } from "@/components/modals/AddPromptModal";
import { AdhocPromptModal } from "@/components/modals/AdhocPromptModal";
import { DebugSearchModal } from "@/components/modals/DebugSearchModal";
import { InlineEditModal } from "@/components/modals/InlineEditModal";
import { ListPromptModal } from "@/components/modals/ListPromptModal";
import { OramaSearchModal } from "@/components/modals/OramaSearchModal";
import { RemoveFromIndexModal } from "@/components/modals/RemoveFromIndexModal";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import CopilotPlugin from "@/main";
import { getAllQAMarkdownContent } from "@/search/searchUtils";
import { CopilotSettings, InlineEditCommandSettings } from "@/settings/model";
import { err2String } from "@/utils";
import { Editor, Notice, TFile } from "obsidian";
import { CHAT_VIEWTYPE, COMMAND_IDS, COMMAND_NAMES, CommandId, EVENT_NAMES } from "../constants";
import {
  getCommandById,
  getCommandId,
  getInlineEditCommands,
} from "@/commands/inlineEditCommandUtils";
import { logError } from "@/logger";
import CopilotView from "@/components/CopilotView";

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

/**
 * Process an inline edit command and display a modal with the processed prompt.
 */
async function processInlineEditCommand(editor: Editor, commandId: string) {
  const selectedText = editor.getSelection().trim();
  if (!selectedText) {
    return;
  }

  const command = getCommandById(commandId);
  if (!command) {
    logError(`Command not found for id ${commandId}`);
    return;
  }

  new InlineEditModal(app, {
    selectedText,
    command,
  }).open();
}

export function registerInlineEditCommands(
  plugin: CopilotPlugin,
  prevCommands: InlineEditCommandSettings[],
  nextCommands: InlineEditCommandSettings[]
) {
  prevCommands.forEach((command) => {
    const id = getCommandId(command.name);
    if (id) {
      // removeCommand is not available in TypeScript for some reasons
      // https://docs.obsidian.md/Reference/TypeScript+API/Plugin/removeCommand
      (plugin as any).removeCommand(id);
    }
  });

  nextCommands.forEach((command) => {
    const id = getCommandId(command.name);
    plugin.addCommand({
      id,
      name: command.name,
      editorCallback: (editor) => {
        processInlineEditCommand(editor, id);
      },
    });
  });
}

export function registerCommands(
  plugin: CopilotPlugin,
  prev: CopilotSettings | undefined,
  next: CopilotSettings
) {
  registerInlineEditCommands(
    plugin,
    prev?.inlineEditCommands ?? [],
    // If a user comes from a legacy version and doesn't have inlineEditCommands
    // in settings, we use the default commands.
    next.inlineEditCommands ?? getInlineEditCommands()
  );
  const promptProcessor = CustomPromptProcessor.getInstance(plugin.app.vault);

  addEditorCommand(plugin, COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION, async (editor: Editor) => {
    const selectedText = await editor.getSelection();
    const wordCount = selectedText.split(" ").length;
    const tokenCount = await plugin.chainManager.chatModelManager.countTokens(selectedText);
    new Notice(`Selected text contains ${wordCount} words and ${tokenCount} tokens.`);
  });

  addEditorCommand(plugin, COMMAND_IDS.ADD_PARAGRAPHS_TO_REFERENCE, async (editor: Editor) => {
    const from = await editor.getCursor("from");
    const to = await editor.getCursor("to");
    const fileName = this.app.workspace.getActiveFile()?.basename;
    const startLine = Math.min(from.line, to.line);
    const endLine = Math.max(from.line, to.line);
    plugin.activateView();
    const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
    chatView.eventTarget.dispatchEvent(
      new CustomEvent(EVENT_NAMES.NEW_TEXT_TO_ADD, {
        // for add lineNum + 1 is for human-readable
        detail: { text: `[[${fileName}#${startLine + 1}#${endLine + 1}]]` },
      })
    );
  });

  addCommand(plugin, COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS, async () => {
    try {
      const allContent = await getAllQAMarkdownContent(plugin.app);
      const totalTokens = await plugin.chainManager.chatModelManager.countTokens(allContent);
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

  addCommand(plugin, COMMAND_IDS.ADD_CUSTOM_PROMPT, () => {
    new AddPromptModal(plugin.app, async (title: string, prompt: string) => {
      try {
        await promptProcessor.savePrompt(title, prompt);
        new Notice("Custom prompt saved successfully.");
      } catch (e) {
        const msg = "An error occurred while saving the custom prompt: " + err2String(e);
        console.error(msg);
        throw new Error(msg);
      }
    }).open();
  });

  addCommand(plugin, COMMAND_IDS.APPLY_CUSTOM_PROMPT, async () => {
    const prompts = await promptProcessor.getAllPrompts();
    const promptTitles = prompts.map((p) => p.title);
    new ListPromptModal(plugin.app, promptTitles, async (promptTitle: string) => {
      if (!promptTitle) {
        new Notice("Please select a prompt title.");
        return;
      }
      try {
        const prompt = await promptProcessor.getPrompt(promptTitle);
        if (!prompt) {
          new Notice(`No prompt found with the title "${promptTitle}".`);
          return;
        }
        plugin.processCustomPrompt(COMMAND_IDS.APPLY_CUSTOM_PROMPT, prompt.content);
      } catch (err) {
        console.error(err);
        new Notice("An error occurred.");
      }
    }).open();
  });

  addCommand(plugin, COMMAND_IDS.APPLY_ADHOC_PROMPT, async () => {
    const modal = new AdhocPromptModal(plugin.app, async (adhocPrompt: string) => {
      try {
        plugin.processCustomPrompt(COMMAND_IDS.APPLY_ADHOC_PROMPT, adhocPrompt);
      } catch (err) {
        console.error(err);
        new Notice("An error occurred.");
      }
    });

    modal.open();
  });

  addCheckCommand(plugin, COMMAND_IDS.DELETE_CUSTOM_PROMPT, (checking: boolean) => {
    if (checking) {
      return true;
    }

    promptProcessor.getAllPrompts().then((prompts) => {
      const promptTitles = prompts.map((p) => p.title);
      new ListPromptModal(plugin.app, promptTitles, async (promptTitle: string) => {
        if (!promptTitle) {
          new Notice("Please select a prompt title.");
          return;
        }

        try {
          await promptProcessor.deletePrompt(promptTitle);
          new Notice(`Prompt "${promptTitle}" has been deleted.`);
        } catch (err) {
          console.error(err);
          new Notice("An error occurred while deleting the prompt.");
        }
      }).open();
    });
    return true;
  });

  addCheckCommand(plugin, COMMAND_IDS.EDIT_CUSTOM_PROMPT, (checking: boolean) => {
    if (checking) {
      return true;
    }

    promptProcessor.getAllPrompts().then((prompts) => {
      const promptTitles = prompts.map((p) => p.title);
      new ListPromptModal(plugin.app, promptTitles, async (promptTitle: string) => {
        if (!promptTitle) {
          new Notice("Please select a prompt title.");
          return;
        }

        try {
          const prompt = await promptProcessor.getPrompt(promptTitle);
          if (prompt) {
            new AddPromptModal(
              plugin.app,
              async (title: string, newPrompt: string) => {
                try {
                  await promptProcessor.updatePrompt(promptTitle, title, newPrompt);
                  new Notice(`Prompt "${title}" has been updated.`);
                } catch (err) {
                  const msg =
                    "An error occurred while updating the custom prompt: " + err2String(err);
                  console.error(msg);
                  throw new Error(msg);
                }
              },
              prompt.title,
              prompt.content,
              false
            ).open();
          } else {
            new Notice(`No prompt found with the title "${promptTitle}".`);
          }
        } catch (err) {
          console.error(err);
          new Notice("An error occurred.");
        }
      }).open();
    });
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

  addCommand(plugin, COMMAND_IDS.INSPECT_COPILOT_INDEX_BY_NOTE_PATHS, () => {
    new OramaSearchModal(plugin.app, plugin).open();
  });

  addCommand(plugin, COMMAND_IDS.SEARCH_ORAMA_DB, () => {
    new DebugSearchModal(plugin.app, plugin).open();
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

  // Add clear Copilot cache command
  addCommand(plugin, COMMAND_IDS.CLEAR_COPILOT_CACHE, async () => {
    try {
      await plugin.fileParserManager.clearPDFCache();
      new Notice("Copilot cache cleared successfully");
    } catch (error) {
      console.error("Error clearing Copilot cache:", error);
      new Notice("Failed to clear Copilot cache");
    }
  });
}
