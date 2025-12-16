import { logFileManager } from "@/logFileManager";
import { FileCache } from "@/cache/fileCache";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { logError } from "@/logger";
import {
  clearRecordedPromptPayload,
  flushRecordedPromptPayloadToLog,
} from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";

import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { EMPTY_COMMAND, QUICK_COMMAND_CODE_BLOCK } from "@/commands/constants";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { removeQuickCommandBlocks } from "@/commands/customCommandUtils";
import { getCachedCustomCommands } from "@/commands/state";
import { ApplyCustomCommandModal } from "@/components/modals/ApplyCustomCommandModal";
import { YoutubeTranscriptModal } from "@/components/modals/YoutubeTranscriptModal";
import { checkIsPlusUser } from "@/plusUtils";
// Debug modals removed with search v3
import CopilotPlugin from "@/main";
import { getAllQAMarkdownContent } from "@/search/searchUtils";
import { CopilotSettings } from "@/settings/model";
import { SelectedTextContext } from "@/types/message";
import { ensureFolderExists, isSourceModeOn } from "@/utils";
import { Editor, MarkdownView, Notice, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { COMMAND_IDS, COMMAND_NAMES, CommandId } from "../constants";

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
      logError("Error counting tokens: ", error);
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
    clearRecordedPromptPayload();
    plugin.newChat();
  });

  addCheckCommand(plugin, COMMAND_IDS.TRIGGER_QUICK_COMMAND, (checking: boolean) => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (checking) {
      // Return true only if we're not in source mode
      return !!(!isSourceModeOn() && activeView && activeView.editor);
    }

    // Need to check this again because it can still be triggered via shortcut.
    if (isSourceModeOn()) {
      new Notice("Quick command is not available in source mode.");
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
    try {
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      await VectorStoreManager.getInstance().clearIndex();
      new Notice("Cleared local Copilot semantic index.");
    } catch (err) {
      logError("Error clearing semantic index:", err);
      new Notice("Failed to clear semantic index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.GARBAGE_COLLECT_COPILOT_INDEX, async () => {
    try {
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const removedCount = await VectorStoreManager.getInstance().garbageCollectVectorStore();
      new Notice(`Garbage collection completed. Removed ${removedCount} stale documents.`);
    } catch (err) {
      logError("Error during garbage collection:", err);
      new Notice("Failed to garbage collect semantic index.");
    }
  });

  // Removed legacy build-only command; use refresh and force reindex commands instead

  addCommand(plugin, COMMAND_IDS.INDEX_VAULT_TO_COPILOT_INDEX, async () => {
    try {
      const { getSettings } = await import("@/settings/model");
      const settings = getSettings();

      if (settings.enableSemanticSearchV3) {
        // Use VectorStoreManager for semantic search indexing
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
        new Notice(`Semantic search index refreshed with ${count} documents.`);
      } else {
        // V3 search builds indexes on demand
        new Notice("Lexical search builds indexes on demand. No manual indexing required.");
      }
    } catch (err) {
      logError("Error building index:", err);
      new Notice("An error occurred while building the index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.FORCE_REINDEX_VAULT_TO_COPILOT_INDEX, async () => {
    try {
      const { getSettings } = await import("@/settings/model");
      const settings = getSettings();

      if (settings.enableSemanticSearchV3) {
        // Use VectorStoreManager for semantic search indexing
        const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
        const count = await VectorStoreManager.getInstance().indexVaultToVectorStore(true);
        new Notice(`Semantic search index rebuilt with ${count} documents.`);
      } else {
        // V3 search builds indexes on demand
        new Notice("Lexical search builds indexes on demand. No manual indexing required.");
      }
    } catch (err) {
      logError("Error rebuilding index:", err);
      new Notice("An error occurred while rebuilding the index.");
    }
  });

  addCommand(plugin, COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION, () => {
    plugin.loadCopilotChatHistory();
  });

  addCommand(plugin, COMMAND_IDS.LIST_INDEXED_FILES, async () => {
    try {
      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const indexedPaths = await VectorStoreManager.getInstance().getIndexedFiles();

      // Get all markdown files from vault
      const { getMatchingPatterns, shouldIndexFile } = await import("@/search/searchUtils");
      const { inclusions, exclusions } = getMatchingPatterns();
      const allMarkdownFiles = plugin.app.vault.getMarkdownFiles();
      const emptyFiles = new Set<string>();
      const unindexedFiles = new Set<string>();
      const excludedFiles = new Set<string>();

      const indexedFiles = new Set<string>(indexedPaths);

      // Categorize files
      for (const file of allMarkdownFiles) {
        // Check if file should be indexed based on settings
        if (!shouldIndexFile(file, inclusions, exclusions)) {
          excludedFiles.add(file.path);
          continue;
        }

        const content = await plugin.app.vault.cachedRead(file);
        if (!content || content.trim().length === 0) {
          emptyFiles.add(file.path);
        } else if (!indexedFiles.has(file.path)) {
          unindexedFiles.add(file.path);
        }
      }

      // Create content for the file
      const content = [
        "# Copilot Files Status",
        `- Indexed files: ${indexedFiles.size}`,
        `- Unindexed files: ${unindexedFiles.size}`,
        `- Empty files: ${emptyFiles.size}`,
        `- Excluded files: ${excludedFiles.size}`,
        "",
        "## Indexed Files",
        ...(indexedFiles.size > 0
          ? Array.from(indexedFiles)
              .sort()
              .map((file) => `- [[${file}]]`)
          : ["No indexed files found."]),
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
        "",
        "## Excluded Files (based on settings)",
        ...(excludedFiles.size > 0
          ? Array.from(excludedFiles)
              .sort()
              .map((file) => `- [[${file}]]`)
          : ["No excluded files."]),
      ].join("\n");

      // Create or update the file in the vault
      const fileName = `Copilot-Indexed-Files-${new Date().toLocaleDateString().replace(/\//g, "-")}.md`;
      const folderPath = "copilot";
      const filePath = `${folderPath}/${fileName}`;

      // Ensure destination folder exists (supports mobile and nested)
      await ensureFolderExists(folderPath);

      const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
      if (existingFile) {
        await plugin.app.vault.modify(existingFile as TFile, content);
      } else {
        await plugin.app.vault.create(filePath, content);
      }

      // Open the file
      const file = plugin.app.vault.getAbstractFileByPath(filePath);
      if (file) {
        await plugin.app.workspace.getLeaf().openFile(file as TFile);
        new Notice(`Listed ${indexedFiles.size} indexed files`);
      }
    } catch (error) {
      logError("Error listing indexed files:", error);
      new Notice("Failed to list indexed files.");
    }
  });

  addCommand(plugin, COMMAND_IDS.INSPECT_COPILOT_INDEX_BY_NOTE_PATHS, async () => {
    try {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile) {
        new Notice("No active file. Please open a note first.");
        return;
      }

      const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
      const { DBOperations } = await import("@/search/dbOperations");
      const db = await VectorStoreManager.getInstance().getDb();
      const hits = await DBOperations.getDocsByPath(db, activeFile.path);

      if (!hits || hits.length === 0) {
        new Notice(`No embedding data found for: ${activeFile.path}`);
        return;
      }

      // Map hits to chunks (getDocsByPath returns {document, score} format)
      const chunks = hits.map((hit: any) => hit.document);
      const content = [
        `# Embedding Debug: ${activeFile.basename}`,
        "",
        `**Path:** ${activeFile.path}`,
        `**Chunks:** ${chunks.length}`,
        `**Embedding Model:** ${chunks[0]?.embeddingModel || "unknown"}`,
        "",
        ...chunks.flatMap((chunk: any, index: number) => {
          const embedding = chunk.embedding || [];
          const preview = embedding
            .slice(0, 10)
            .map((v: number) => v.toFixed(6))
            .join(", ");
          return [
            `## Chunk ${index + 1}`,
            `- **ID:** ${chunk.id}`,
            `- **Content Preview:** "${(chunk.content || "").substring(0, 200)}..."`,
            `- **Vector Length:** ${embedding.length}`,
            `- **Vector Preview:** [${preview}${embedding.length > 10 ? ", ..." : ""}]`,
            `- **Tags:** ${(chunk.tags || []).join(", ") || "none"}`,
            `- **Characters:** ${chunk.nchars || 0}`,
            "",
          ];
        }),
      ].join("\n");

      // Create the debug file
      const fileName = `Copilot-Embedding-Debug-${activeFile.basename.replace(/[\\/:*?"<>|]/g, "_")}.md`;
      const folderPath = "copilot";
      const filePath = `${folderPath}/${fileName}`;

      await ensureFolderExists(folderPath);

      const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
      if (existingFile) {
        await plugin.app.vault.modify(existingFile as TFile, content);
      } else {
        await plugin.app.vault.create(filePath, content);
      }

      const file = plugin.app.vault.getAbstractFileByPath(filePath);
      if (file) {
        await plugin.app.workspace.getLeaf().openFile(file as TFile);
        new Notice(`Embedding debug info for ${chunks.length} chunk(s)`);
      }
    } catch (error) {
      logError("Error inspecting embeddings:", error);
      new Notice("Failed to inspect embeddings. Is the index loaded?");
    }
  });

  // Add clear Copilot cache command
  addCommand(plugin, COMMAND_IDS.CLEAR_COPILOT_CACHE, async () => {
    try {
      await plugin.fileParserManager.clearPDFCache();

      // Clear project context cache
      await ProjectContextCache.getInstance().clearAllCache();

      // Clear file content cache (get FileCache instance and clear it)
      const fileCache = FileCache.getInstance<string>();
      await fileCache.clear();

      new Notice("All Copilot caches cleared successfully");
    } catch (error) {
      logError("Error clearing Copilot caches:", error);
      new Notice("Failed to clear Copilot caches");
    }
  });

  // Create Copilot log file
  addCommand(plugin, COMMAND_IDS.OPEN_LOG_FILE, async () => {
    try {
      await flushRecordedPromptPayloadToLog();
      await logFileManager.openLogFile();
    } catch (error) {
      logError("Error creating Copilot log file:", error);
      new Notice("Failed to create Copilot log file.");
    }
  });

  // Clear Copilot log file (delete on disk and clear in-memory buffer)
  addCommand(plugin, COMMAND_IDS.CLEAR_LOG_FILE, async () => {
    try {
      await logFileManager.clear();
      new Notice("Copilot log cleared.");
    } catch (error) {
      logError("Error clearing Copilot log file:", error);
      new Notice("Failed to clear Copilot log file.");
    }
  });

  // Add selection to chat context command (manual)
  addEditorCommand(plugin, COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT, async (editor: Editor) => {
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

    // Replace selected text contexts (consistent with auto mode behavior)
    const { setSelectedTextContexts } = await import("@/aiParams");
    setSelectedTextContexts([selectedTextContext]);

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

  // Add command to download YouTube script (Copilot Plus only)
  addCommand(plugin, COMMAND_IDS.DOWNLOAD_YOUTUBE_SCRIPT, async () => {
    const isPlusUser = await checkIsPlusUser();
    if (!isPlusUser) {
      new Notice("Download YouTube Script (plus) is a Copilot Plus feature");
      return;
    }

    const modal = new YoutubeTranscriptModal(plugin.app);
    modal.open();
  });
}
