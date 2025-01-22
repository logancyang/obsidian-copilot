import { COMMAND_PROMPT_MAP } from "@/commands/promptUtils";
import { AddPromptModal } from "@/components/modals/AddPromptModal";
import { AdhocPromptModal } from "@/components/modals/AdhocPromptModal";
import { DebugSearchModal } from "@/components/modals/DebugSearchModal";
import { InlineEditModal } from "@/components/modals/InlineEditModal";
import { LanguageModal } from "@/components/modals/LanguageModal";
import { ListPromptModal } from "@/components/modals/ListPromptModal";
import { OramaSearchModal } from "@/components/modals/OramaSearchModal";
import { RemoveFromIndexModal } from "@/components/modals/RemoveFromIndexModal";
import { ToneModal } from "@/components/modals/ToneModal";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { CustomError } from "@/error";
import CopilotPlugin from "@/main";
import { getAllQAMarkdownContent } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { formatDateTime } from "@/utils";
import { Editor, Notice, TFile } from "obsidian";
import {
  COMMAND_IDS,
  COMMAND_NAMES,
  CommandId,
  DISABLEABLE_COMMANDS,
  PROCESS_SELECTION_COMMANDS,
  USER_SENDER,
} from "../constants";

/**
 * Check if a command is enabled.
 * @returns - True if the command is enabled or not set, false otherwise
 */
export function isCommandEnabled(id: CommandId) {
  const commandSettings = getSettings().enabledCommands[id];
  return commandSettings?.enabled !== false;
}

/**
 * Add a command to the plugin.
 */
export function addCommand(plugin: CopilotPlugin, id: CommandId, callback: () => void) {
  if (isCommandEnabled(id)) {
    plugin.addCommand({
      id,
      name: COMMAND_NAMES[id],
      callback,
    });
  }
}

/**
 * Add an editor command to the plugin.
 */
function addEditorCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (editor: Editor) => void
) {
  if (isCommandEnabled(id)) {
    plugin.addCommand({
      id,
      name: COMMAND_NAMES[id],
      editorCallback: callback,
    });
  }
}

/**
 * Add a check command to the plugin.
 */
export function addCheckCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (checking: boolean) => boolean | void
) {
  if (isCommandEnabled(id)) {
    plugin.addCommand({
      id,
      name: COMMAND_NAMES[id],
      checkCallback: callback,
    });
  }
}

/**
 * Process an inline edit command and display a modal with the processed prompt.
 */
async function processInlineEditCommand(
  plugin: CopilotPlugin,
  editor: Editor,
  commandId: (typeof PROCESS_SELECTION_COMMANDS)[number],
  eventSubtype?: string
) {
  const selectedText = editor.getSelection().trim();
  if (!selectedText) {
    return;
  }

  const promptFn = COMMAND_PROMPT_MAP[commandId];
  const messageWithPrompt = await promptFn(selectedText, eventSubtype);

  const promptMessage: ChatMessage = {
    message: messageWithPrompt,
    sender: USER_SENDER,
    isVisible: false,
    timestamp: formatDateTime(new Date()),
  };

  if (selectedText) {
    new InlineEditModal(app, {
      selectedText,
      commandId,
      promptMessage,
      chainManager: plugin.chainManager,
    }).open();
  }
}

export function registerBuiltInCommands(plugin: CopilotPlugin) {
  // Remove all built in commands first
  DISABLEABLE_COMMANDS.forEach((id) => {
    // removeCommand is not available in TypeScript for some reasons
    // https://docs.obsidian.md/Reference/TypeScript+API/Plugin/removeCommand
    (plugin as any).removeCommand(id);
  });

  const promptProcessor = CustomPromptProcessor.getInstance(plugin.app.vault);

  addEditorCommand(plugin, COMMAND_IDS.FIX_GRAMMAR, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.FIX_GRAMMAR);
  });

  addEditorCommand(plugin, COMMAND_IDS.SUMMARIZE, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.SUMMARIZE);
  });

  addEditorCommand(plugin, COMMAND_IDS.GENERATE_TOC, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.GENERATE_TOC);
  });

  addEditorCommand(plugin, COMMAND_IDS.GENERATE_GLOSSARY, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.GENERATE_GLOSSARY);
  });

  addEditorCommand(plugin, COMMAND_IDS.SIMPLIFY, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.SIMPLIFY);
  });

  addEditorCommand(plugin, COMMAND_IDS.EMOJIFY, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.EMOJIFY);
  });

  addEditorCommand(plugin, COMMAND_IDS.REMOVE_URLS, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.REMOVE_URLS);
  });

  addEditorCommand(plugin, COMMAND_IDS.REWRITE_TWEET, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.REWRITE_TWEET);
  });

  addEditorCommand(plugin, COMMAND_IDS.REWRITE_TWEET_THREAD, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.REWRITE_TWEET_THREAD);
  });

  addEditorCommand(plugin, COMMAND_IDS.MAKE_SHORTER, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.MAKE_SHORTER);
  });

  addEditorCommand(plugin, COMMAND_IDS.MAKE_LONGER, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.MAKE_LONGER);
  });

  addEditorCommand(plugin, COMMAND_IDS.ELI5, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.ELI5);
  });

  addEditorCommand(plugin, COMMAND_IDS.PRESS_RELEASE, (editor) => {
    processInlineEditCommand(plugin, editor, COMMAND_IDS.PRESS_RELEASE);
  });

  addEditorCommand(plugin, COMMAND_IDS.TRANSLATE, (editor) => {
    new LanguageModal(plugin.app, (language) => {
      if (!language) {
        new Notice("Please select a language.");
        return;
      }
      processInlineEditCommand(plugin, editor, COMMAND_IDS.TRANSLATE, language);
    }).open();
  });

  addEditorCommand(plugin, COMMAND_IDS.CHANGE_TONE, (editor) => {
    new ToneModal(plugin.app, (tone) => {
      if (!tone) {
        new Notice("Please select a tone.");
        return;
      }
      processInlineEditCommand(plugin, editor, COMMAND_IDS.CHANGE_TONE, tone);
    }).open();
  });

  addEditorCommand(plugin, COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION, async (editor: Editor) => {
    const selectedText = await editor.getSelection();
    const wordCount = selectedText.split(" ").length;
    const tokenCount = await plugin.chainManager.chatModelManager.countTokens(selectedText);
    new Notice(`Selected text contains ${wordCount} words and ${tokenCount} tokens.`);
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
        new Notice("Error saving custom prompt. Please check if the title already exists.");
        console.error(e);
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
                  console.error(err);
                  if (err instanceof CustomError) {
                    new Notice(err.message);
                  } else {
                    new Notice("An error occurred.");
                  }
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
}
