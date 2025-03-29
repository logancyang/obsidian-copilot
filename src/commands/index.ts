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
import { Editor, Notice, TFile, MarkdownView } from "obsidian";
import { COMMAND_IDS, COMMAND_NAMES, CommandId } from "@/constants";
import { SELECTED_TEXT_PLACEHOLDER } from "@/commands/constants";
import {
  getCommandById,
  getCommandId,
  getInlineEditCommands,
} from "@/commands/inlineEditCommandUtils";
import { logError } from "@/logger";

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
 * Process an inline edit command.
 * If it's the "Add Smart Footnote" command, handle it specially.
 * Otherwise, display the standard modal.
 */
async function processInlineEditCommand(plugin: CopilotPlugin, editor: Editor, commandId: string) {
  const selectedText = editor.getSelection().trim();
  if (!selectedText) {
    return;
  }

  const command = getCommandById(commandId);
  if (!command) {
    logError(`Command not found for id ${commandId}`);
    return;
  }

  // Check if this is our specific command
  if (command.name === "Add Smart Footnote") {
    // Call our custom handler function (to be implemented)
    await handleSmartFootnote(plugin, editor, selectedText, command);
  } else {
    // Otherwise, use the default modal behavior
    new InlineEditModal(plugin.app, {
      selectedText,
      command,
    }).open();
  }
}

/**
 * Handles the Smart Footnote generation and insertion.
 * @param plugin The CopilotPlugin instance
 * @param editor The editor instance
 * @param selectedText The text selected by the user
 * @param command The command configuration object
 */
async function handleSmartFootnote(
  plugin: CopilotPlugin,
  editor: Editor,
  selectedText: string,
  command: InlineEditCommandSettings
) {
  console.log("Handling Smart Footnote for:", selectedText);

  // Get the active editor reliably before the async call
  const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!activeView) {
    new Notice("Cannot add footnote: No active Markdown editor found.");
    return;
  }
  const currentEditor = activeView.editor;
  const selectionEndPos = currentEditor.getCursor("to"); // Store position

  const notice = new Notice("Generating Smart Footnote...", 0);

  try {
    // 1. Format the AI prompt
    const prompt = command.prompt.replace(SELECTED_TEXT_PLACEHOLDER, selectedText);
    // Keep this log? It can be useful for debugging user prompts.
    // console.log("Formatted Prompt:", prompt);

    // 2. Call the AI service
    const chatModel = plugin.chainManager.chatModelManager.getChatModel();
    if (!chatModel) {
      throw new Error("Chat model is not available.");
    }
    const aiResult = await chatModel.invoke(prompt);
    const aiTextResult =
      typeof aiResult.content === "string" ? aiResult.content.trim() : JSON.stringify(aiResult);

    if (!aiTextResult) {
      throw new Error("AI returned empty content.");
    }

    // Remove Raw and Text AI Result logs
    // console.log("AI Result Raw:", aiResult);
    // console.log("AI Result Text:", aiTextResult);

    // --- Footnote Insertion Logic ---

    // 4. Determine unique footnote ID using UP-TO-DATE content
    const docContent = currentEditor.getValue(); // MOVED HERE, AFTER await
    // Remove ID Calculation logs
    // console.log("--- Footnote ID Calculation ---");
    // console.log("Document Content Length:", docContent.length);
    // const contentTail = docContent.substring(Math.max(0, docContent.length - 100));
    // console.log("Document Content Tail for Regex Check:", JSON.stringify(contentTail));

    let nextId = 1;
    const footnoteDefRegex = new RegExp("\\[\\^sn(\\d+)\\]:", "g");
    // console.log("Using Regex:", footnoteDefRegex);

    let match;
    let maxId = 0;
    // console.log("Initial maxId:", maxId);

    while ((match = footnoteDefRegex.exec(docContent)) !== null) {
      // console.log("Regex Match Found:", match[0], "| Extracted ID String:", match[1]);
      try {
        const idNum = parseInt(match[1], 10);
        // console.log("Parsed ID Number:", idNum);
        if (!isNaN(idNum)) {
          if (idNum > maxId) {
            maxId = idNum;
            // console.log("Updated maxId:", maxId);
          }
        } else {
          // Keep this warning? It indicates a malformed footnote ID in the doc.
          console.warn("Could not parse footnote ID string during calculation:", match[1]);
        }
      } catch (parseError) {
        console.error("Error parsing footnote ID string during calculation:", match[1], parseError);
      }
    }
    // console.log("Final maxId before increment:", maxId);

    nextId = maxId + 1;
    const footnoteId = `sn${nextId}`;
    // console.log("Calculated nextId:", nextId, "| footnoteId:", footnoteId);
    // console.log("--- End Footnote ID Calculation ---");

    // 5. Insert footnote marker "[^id]" after selection
    const marker = `[^${footnoteId}]`;
    // Use the stored position, as editor state might change during async call
    currentEditor.replaceRange(marker, selectionEndPos);

    // 6. Append footnote definition "[^id]: result" to end of doc
    // Ensure it starts on a new line, add extra newline if doc doesn't end with one
    // IMPORTANT: Use the same docContent read for ID calculation for prefix logic
    const definitionPrefix = docContent.endsWith("\n\n")
      ? ""
      : docContent.endsWith("\n")
        ? "\n"
        : "\n\n";
    const definition = `${definitionPrefix}[^${footnoteId}]: ${aiTextResult}`;
    const endOfDocPos = { line: currentEditor.lineCount(), ch: 0 };
    currentEditor.replaceRange(definition, endOfDocPos);

    // --- End Footnote Insertion ---

    notice.setMessage("Smart Footnote inserted!");
    // Remove inserted ID log
    // console.log(`Inserted footnote with ID: ${footnoteId}`);

    // Optional: Move cursor after the inserted marker
    const newCursorPos = { line: selectionEndPos.line, ch: selectionEndPos.ch + marker.length };
    currentEditor.setCursor(newCursorPos);
  } catch (error) {
    console.error("Error generating or inserting Smart Footnote:", error);
    notice.setMessage(`Error: ${error.message}`);
  } finally {
    setTimeout(() => notice.hide(), 5000);
  }
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
        processInlineEditCommand(plugin, editor, id);
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
