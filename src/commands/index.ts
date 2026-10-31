import { logFileManager } from "@/logFileManager";
import { FileCache } from "@/cache/fileCache";
import { clearLegacyCaches } from "@/cache/legacyCaches";
import { logError } from "@/logger";
import {
  clearRecordedPromptPayload,
  flushRecordedPromptPayloadToLog,
} from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";

import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import { CustomCommand } from "@/commands/type";
import {
  QUICK_COMMAND_SYSTEM_PROMPT,
  appendIncludeNoteContextPlaceholders,
} from "@/commands/quickCommandPrompts";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import { ApplyCustomCommandModal } from "@/components/modals/ApplyCustomCommandModal";
import { YoutubeTranscriptModal } from "@/components/modals/YoutubeTranscriptModal";
import { checkIsPaidUser } from "@/plusUtils";
import type CopilotPlugin from "@/main";
import { MiyoRequestError } from "@/miyo/MiyoClient";
import { requestMiyoIndexRefresh } from "@/miyo/miyoIndex";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import { getAllQAMarkdownContent } from "@/search/searchUtils";
import { getSettings } from "@/settings/model";
import { WebSelectedTextContext } from "@/types/message";
import { isSourceModeOn } from "@/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { Editor, MarkdownView, Notice, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { COMMAND_IDS, COMMAND_ICONS, COMMAND_NAMES, CommandId } from "@/constants";
import { attachSelection } from "@/selection/selectionStore";
import { editorSelectionReport, webSelectionReport } from "@/selection/selectionWatcher";

type PublishFile = (file: TFile) => void;

function addCommand(plugin: CopilotPlugin, id: CommandId, callback: () => void | Promise<void>) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    icon: COMMAND_ICONS[id],
    callback: () => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch((err) => logError(`Command ${id} failed`, err));
      }
    },
  });
}

function addEditorCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (editor: Editor) => void | Promise<void>
) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    icon: COMMAND_ICONS[id],
    editorCallback: (editor) => {
      const result = callback(editor);
      if (result instanceof Promise) {
        result.catch((err) => logError(`Editor command ${id} failed`, err));
      }
    },
  });
}

function addCheckCommand(
  plugin: CopilotPlugin,
  id: CommandId,
  callback: (checking: boolean) => boolean | void
) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    icon: COMMAND_ICONS[id],
    checkCallback: callback,
  });
}

export function registerCommands(plugin: CopilotPlugin, publish: PublishFile) {
  addCheckCommand(plugin, COMMAND_IDS.PUBLISH_FILE_TO_OPENARTIFACTS, (checking) => {
    const activeFile = plugin.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
      return false;
    }

    if (!checking) {
      publish(activeFile);
    }
    return true;
  });

  addEditorCommand(plugin, COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION, async (editor: Editor) => {
    const selectedText = editor.getSelection();
    const wordCount = selectedText.split(" ").length;
    const tokenCount = await plugin.chainOwner
      .getCurrentChainManager()
      .chatModelManager.countTokens(selectedText);
    new Notice(`Selected text contains ${wordCount} words and ${tokenCount} tokens.`);
  });

  addCommand(plugin, COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS, async () => {
    try {
      const allContent = await getAllQAMarkdownContent(plugin.app);
      const totalTokens = await plugin.chainOwner
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

  addCommand(plugin, COMMAND_IDS.OPEN_COPILOT_CHAT_WINDOW, async () => {
    await plugin.activateView();
  });

  addCommand(plugin, COMMAND_IDS.OPEN_RELEVANT_NOTES_VIEW, async () => {
    await plugin.activateRelevantNotesView();
  });

  addCommand(plugin, COMMAND_IDS.NEW_CHAT, async () => {
    clearRecordedPromptPayload();
    await plugin.newChat();
  });

  if (isDesktopRuntime()) {
    addCommand(plugin, COMMAND_IDS.OPEN_AGENT_CHAT_WINDOW, () => {
      void plugin.activateAgentView();
    });
    addCommand(plugin, COMMAND_IDS.TOGGLE_AGENT_CHAT_WINDOW, () => {
      void plugin.toggleAgentView();
    });
    addCommand(plugin, COMMAND_IDS.NEW_AGENT_CHAT, () => {
      void plugin.newAgentChat();
    });
  }

  addCheckCommand(plugin, COMMAND_IDS.TRIGGER_QUICK_COMMAND, (checking: boolean) => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (checking) {
      return !!(!isSourceModeOn(plugin.app) && activeView && activeView.editor);
    }

    if (isSourceModeOn(plugin.app)) {
      new Notice("Quick command is not available in source mode.");
      return false;
    }

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

    const quickCommand: CustomCommand = {
      title: "Quick Command",
      content: "",
      showInContextMenu: false,
      showInSlashMenu: false,
      order: 0,
      modelKey: "",
      lastUsedMs: Date.now(),
    };

    const modal = new CustomCommandChatModal(plugin.app, {
      selectedText,
      command: quickCommand,
      systemPrompt: QUICK_COMMAND_SYSTEM_PROMPT,
      behaviorConfig: {
        autoExecuteOnOpen: false,
        hideContentAreaOnIdle: true,
        commandLabel: "Quick Command",
        commandIcon: null,
        showIncludeNoteContext: true,
        firstSubmitTransform: (input, includeNoteContext) =>
          appendIncludeNoteContextPlaceholders(input, includeNoteContext),
      },
    });
    modal.open();

    return true;
  });

  // The palette reflects connection intent at plugin load. Reachability is
  // checked when the command runs so a stopped or remote Miyo fails visibly.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/282
  if (getSettings().enableMiyo) {
    addCommand(plugin, COMMAND_IDS.REFRESH_MIYO_INDEX, async () => {
      const settings = getSettings();
      if (!settings.enableMiyo) {
        new Notice("Miyo is disconnected. Connect it in Copilot settings, then retry.");
        return;
      }
      const customUrl = getMiyoCustomUrl(settings);
      // Mobile cannot discover a service on localhost, so this state needs a
      // concrete recovery action instead of the generic unavailable message.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/282
      if (!isDesktopRuntime() && !customUrl) {
        new Notice("A remote Miyo connection is required on mobile.");
        return;
      }
      try {
        await requestMiyoIndexRefresh(plugin.app);
        new Notice("Miyo vault scan started. Open Miyo to check indexing progress.");
      } catch (error) {
        logError("Failed to refresh the Miyo index:", error);
        if (error instanceof MiyoRequestError && error.status === 404) {
          new Notice("This vault is not registered with Miyo. Register it in Miyo, then retry.");
          return;
        }
        new Notice("Miyo is unavailable. Open Miyo, then retry the refresh.");
      }
    });
  }

  addCommand(plugin, COMMAND_IDS.LOAD_COPILOT_CHAT_CONVERSATION, async () => {
    await plugin.loadCopilotChatHistory();
  });

  addCommand(plugin, COMMAND_IDS.CLEAR_COPILOT_CACHE, async () => {
    try {
      await FileCache.getInstance<string>().clear(plugin.app.vault);
      await clearLegacyCaches(plugin.app);

      new Notice("All Copilot caches cleared successfully");
    } catch (error) {
      logError("Error clearing Copilot caches:", error);
      new Notice("Failed to clear Copilot caches");
    }
  });

  addCommand(plugin, COMMAND_IDS.OPEN_LOG_FILE, async () => {
    try {
      await flushRecordedPromptPayloadToLog();
      await logFileManager.openLogFile();
    } catch (error) {
      logError("Error creating Copilot log file:", error);
      new Notice("Failed to create Copilot log file.");
    }
  });

  addCommand(plugin, COMMAND_IDS.CLEAR_LOG_FILE, async () => {
    try {
      await logFileManager.clear();
      new Notice("Copilot log cleared.");
    } catch (error) {
      logError("Error clearing Copilot log file:", error);
      new Notice("Failed to clear Copilot log file.");
    }
  });

  addEditorCommand(plugin, COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT, async (editor: Editor) => {
    const file = plugin.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return;
    }

    const report = editorSelectionReport({ editor, file });
    if (!report?.context) {
      new Notice("No text selected");
      return;
    }

    attachSelection(report);

    await plugin.activateChatViewForContext();
  });

  addCommand(plugin, COMMAND_IDS.ADD_WEB_SELECTION_TO_CHAT_CONTEXT, async () => {
    if (!isDesktopRuntime()) {
      new Notice("Web selection is only available on desktop");
      return;
    }

    const { getWebViewerService } =
      await import("@/services/webViewerService/webViewerServiceSingleton");

    try {
      const service = getWebViewerService(plugin.app);
      const leaf = service.getActiveLeaf() ?? service.getLastActiveLeaf();

      if (!leaf) {
        new Notice("No active web tab found");
        return;
      }

      const selectedMarkdown = await service.getSelectedMarkdown(leaf);
      if (!selectedMarkdown.trim()) {
        new Notice("No text selected in the web tab");
        return;
      }

      const pageInfo = service.getPageInfo(leaf);

      const webSelectedTextContext: WebSelectedTextContext = {
        id: uuidv4(),
        content: selectedMarkdown,
        sourceType: "web",
        title: pageInfo.title || "Untitled",
        url: pageInfo.url,
        faviconUrl: pageInfo.faviconUrl || undefined,
      };

      attachSelection(webSelectionReport(webSelectedTextContext));

      await plugin.activateChatViewForContext();
    } catch (error) {
      logError("Error adding web selection to context:", error);
      new Notice("Failed to get web selection");
    }
  });

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

  addCommand(plugin, COMMAND_IDS.APPLY_CUSTOM_COMMAND, () => {
    const modal = new ApplyCustomCommandModal(plugin.app);
    modal.open();
  });

  addCommand(plugin, COMMAND_IDS.DOWNLOAD_YOUTUBE_SCRIPT, async () => {
    const isPaidUser = await checkIsPaidUser(plugin.app, { trigger: "tool_call" });
    if (!isPaidUser) {
      new Notice("Download YouTube transcript is a Copilot Plus feature");
      return;
    }

    const modal = new YoutubeTranscriptModal(plugin.app);
    modal.open();
  });

  addCheckCommand(plugin, COMMAND_IDS.TRIGGER_QUICK_ASK, (checking: boolean) => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (checking) {
      return !!(!isSourceModeOn(plugin.app) && activeView && activeView.editor);
    }

    if (isSourceModeOn(plugin.app)) {
      new Notice("Quick Ask is not available in source mode.");
      return false;
    }

    if (!activeView || !activeView.editor) {
      new Notice("No active editor found.");
      return false;
    }

    const view = activeView.editor.cm;
    if (!view) {
      new Notice("Could not access CodeMirror editor.");
      return false;
    }

    plugin.quickAskController.show(activeView, view);
    return true;
  });
}
