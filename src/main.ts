import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ProjectManager from "@/LLMProviders/projectManager";
import { CustomModel, getCurrentProject } from "@/aiParams";
import { AutocompleteService } from "@/autocomplete/autocompleteService";
import { registerCommands } from "@/commands";
import CopilotView from "@/components/CopilotView";
import { APPLY_VIEW_TYPE, ApplyView } from "@/components/composer/ApplyView";
import { LoadChatHistoryModal } from "@/components/modals/LoadChatHistoryModal";

import { QUICK_COMMAND_CODE_BLOCK } from "@/commands/constants";
import { registerContextMenu } from "@/commands/contextMenu";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import { migrateCommands, suggestDefaultCommands } from "@/commands/migrator";
import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { SystemPromptRegister } from "@/system-prompts/systemPromptRegister";
import { createQuickCommandContainer } from "@/components/QuickCommand";
import { ABORT_REASON, CHAT_VIEWTYPE, DEFAULT_OPEN_AREA, EVENT_NAMES } from "@/constants";
import { ChatManager } from "@/core/ChatManager";
import { MessageRepository } from "@/core/MessageRepository";
import { encryptAllKeys } from "@/encryptionService";
import { logInfo } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { clearRecordedPromptPayload } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { checkIsPlusUser } from "@/plusUtils";
import VectorStoreManager from "@/search/vectorStoreManager";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import {
  getModelKeyFromModel,
  getSettings,
  sanitizeSettings,
  setSettings,
  subscribeToSettingsChange,
} from "@/settings/model";
import { ChatUIState } from "@/state/ChatUIState";
import { VaultDataManager } from "@/state/vaultDataAtoms";
import { FileParserManager } from "@/tools/FileParserManager";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import {
  Editor,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import { IntentAnalyzer } from "./LLMProviders/intentAnalyzer";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { extractChatTitle, extractChatDate } from "@/utils/chatHistoryUtils";

// Removed unused FileTrackingState interface

export default class CopilotPlugin extends Plugin {
  // Plugin components
  projectManager: ProjectManager;
  brevilabsClient: BrevilabsClient;
  userMessageHistory: string[] = [];
  vectorStoreManager: VectorStoreManager;
  fileParserManager: FileParserManager;
  customCommandRegister: CustomCommandRegister;
  systemPromptRegister: SystemPromptRegister;
  settingsUnsubscriber?: () => void;
  private autocompleteService: AutocompleteService;
  chatUIState: ChatUIState;
  userMemoryManager: UserMemoryManager;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.settingsUnsubscriber = subscribeToSettingsChange(async (prev, next) => {
      if (next.enableEncryption) {
        await this.saveData(await encryptAllKeys(next));
      } else {
        await this.saveData(next);
      }
      registerCommands(this, prev, next);
    });
    this.addSettingTab(new CopilotSettingTab(this.app, this));

    // Core plugin initialization

    // Initialize built-in tools with vault access
    initializeBuiltinTools(this.app.vault);

    // Initialize BrevilabsClient
    this.brevilabsClient = BrevilabsClient.getInstance();
    this.brevilabsClient.setPluginVersion(this.manifest.version);
    checkIsPlusUser();

    // Initialize ProjectManager
    this.projectManager = ProjectManager.getInstance(this.app, this);

    // Always construct VectorStoreManager; it internally no-ops when semantic search is disabled
    this.vectorStoreManager = VectorStoreManager.getInstance();

    // Initialize VaultDataManager for centralized vault data (notes, folders, tags)
    // Note: VaultDataManager tracks ALL data; hooks filter based on parameters
    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.initialize();

    // Initialize FileParserManager early with other core services
    this.fileParserManager = new FileParserManager(this.brevilabsClient, this.app.vault);

    // Initialize ChatUIState with new architecture
    const messageRepo = new MessageRepository();
    const chainManager = this.projectManager.getCurrentChainManager();
    const chatManager = new ChatManager(messageRepo, chainManager, this.fileParserManager, this);
    this.chatUIState = new ChatUIState(chatManager);

    // Initialize UserMemoryManager
    this.userMemoryManager = new UserMemoryManager(this.app);

    this.registerView(CHAT_VIEWTYPE, (leaf: WorkspaceLeaf) => new CopilotView(leaf, this));
    this.registerView(APPLY_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ApplyView(leaf));

    this.initActiveLeafChangeHandler();

    this.addRibbonIcon("message-square", "Open Copilot Chat", (evt: MouseEvent) => {
      this.activateView();
    });

    registerCommands(this, undefined, getSettings());

    this.registerMarkdownCodeBlockProcessor(QUICK_COMMAND_CODE_BLOCK, (_, el) => {
      createQuickCommandContainer({
        plugin: this,
        element: el,
      });

      // Remove parent element class names to clear default code block styling
      if (el.parentElement) {
        el.parentElement.className = "";
      }
    });

    IntentAnalyzer.initTools(this.app.vault);

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu) => {
        return registerContextMenu(menu);
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof MarkdownView) {
          const file = leaf.view.file;
          if (file) {
            // Note: File tracking and real-time reindexing removed for simplicity
            // Semantic search indexes are rebuilt manually or on startup as needed
            const activeCopilotView = this.app.workspace
              .getLeavesOfType(CHAT_VIEWTYPE)
              .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;

            if (activeCopilotView) {
              const event = new CustomEvent(EVENT_NAMES.ACTIVE_LEAF_CHANGE);
              activeCopilotView.eventTarget.dispatchEvent(event);
            }
          }
        }
      })
    );

    // Initialize autocomplete service
    this.autocompleteService = AutocompleteService.getInstance(this);
    this.customCommandRegister = new CustomCommandRegister(this, this.app.vault);
    this.systemPromptRegister = new SystemPromptRegister(this, this.app.vault);

    this.app.workspace.onLayoutReady(() => {
      // Initialize custom commands
      this.customCommandRegister.initialize().then(migrateCommands).then(suggestDefaultCommands);

      // Initialize system prompts (independent from custom commands)
      this.systemPromptRegister
        .initialize()
        .then(() => migrateSystemPromptsFromSettings(this.app.vault));
    });
  }

  async onunload() {
    if (this.projectManager) {
      this.projectManager.onunload();
    }

    // Cleanup VaultDataManager event listeners
    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.cleanup();

    this.customCommandRegister.cleanup();
    this.systemPromptRegister.cleanup();
    this.settingsUnsubscriber?.();
    this.autocompleteService?.destroy();

    // Best-effort flush of log file
    await logFileManager.flush();
    logInfo("Copilot plugin unloaded");
  }

  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  async autosaveCurrentChat() {
    if (getSettings().autosaveChat) {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView) {
        await chatView.saveChat();
      }
    }
  }

  async processText(
    editor: Editor,
    eventType: string,
    eventSubtype?: string,
    checkSelectedText = true
  ) {
    const selectedText = await editor.getSelection();

    const isChatWindowActive = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE).length > 0;

    if (!isChatWindowActive) {
      await this.activateView();
    }

    // Without the timeout, the view is not yet active
    setTimeout(() => {
      const activeCopilotView = this.app.workspace
        .getLeavesOfType(CHAT_VIEWTYPE)
        .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;
      if (activeCopilotView && (!checkSelectedText || selectedText)) {
        const event = new CustomEvent(eventType, { detail: { selectedText, eventSubtype } });
        activeCopilotView.eventTarget.dispatchEvent(event);
      }
    }, 0);
  }

  processSelection(editor: Editor, eventType: string, eventSubtype?: string) {
    this.processText(editor, eventType, eventSubtype);
  }

  emitChatIsVisible() {
    const activeCopilotView = this.app.workspace
      .getLeavesOfType(CHAT_VIEWTYPE)
      .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;

    if (activeCopilotView) {
      const event = new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE);
      activeCopilotView.eventTarget.dispatchEvent(event);
    }
  }

  initActiveLeafChangeHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        if (leaf.getViewState().type === CHAT_VIEWTYPE) {
          this.emitChatIsVisible();
        }
      })
    );
  }

  private getCurrentEditorOrDummy(): Editor {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return {
      getSelection: () => {
        const selection = activeView?.editor?.getSelection();
        if (selection) return selection;
        // Default to the entire active file if no selection
        const activeFile = this.app.workspace.getActiveFile();
        return activeFile ? this.app.vault.cachedRead(activeFile) : "";
      },
      replaceSelection: activeView?.editor?.replaceSelection.bind(activeView.editor) || (() => {}),
    } as Partial<Editor> as Editor;
  }

  processCustomPrompt(eventType: string, customPrompt: string) {
    const editor = this.getCurrentEditorOrDummy();
    this.processText(editor, eventType, customPrompt, false);
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length > 0) {
      this.deactivateView();
    } else {
      this.activateView();
    }
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length === 0) {
      if (getSettings().defaultOpenArea === DEFAULT_OPEN_AREA.VIEW) {
        await this.app.workspace.getRightLeaf(false).setViewState({
          type: CHAT_VIEWTYPE,
          active: true,
        });
      } else {
        await this.app.workspace.getLeaf(true).setViewState({
          type: CHAT_VIEWTYPE,
          active: true,
        });
      }
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
    this.emitChatIsVisible();
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
  }

  async loadSettings() {
    const savedSettings = await this.loadData();
    const sanitizedSettings = sanitizeSettings(savedSettings);
    setSettings(sanitizedSettings);
  }

  mergeActiveModels(
    existingActiveModels: CustomModel[],
    builtInModels: CustomModel[]
  ): CustomModel[] {
    const modelMap = new Map<string, CustomModel>();

    // Create a unique key for each model, it's model (name + provider)

    // Add or update existing models in the map
    existingActiveModels.forEach((model) => {
      const key = getModelKeyFromModel(model);
      const existingModel = modelMap.get(key);
      if (existingModel) {
        // If it's a built-in model, preserve the built-in status
        modelMap.set(key, {
          ...model,
          isBuiltIn: existingModel.isBuiltIn || model.isBuiltIn,
        });
      } else {
        modelMap.set(key, model);
      }
    });

    return Array.from(modelMap.values());
  }

  async loadCopilotChatHistory() {
    const chatFiles = await this.getChatHistoryFiles();
    if (chatFiles.length === 0) {
      new Notice("No chat history found.");
      return;
    }
    new LoadChatHistoryModal(this.app, chatFiles, this.loadChatHistory.bind(this)).open();
  }

  async getChatHistoryFiles(): Promise<TFile[]> {
    const folder = this.app.vault.getAbstractFileByPath(getSettings().defaultSaveFolder);
    if (!(folder instanceof TFolder)) {
      return [];
    }

    const files = this.app.vault.getMarkdownFiles();
    const folderFiles = files.filter((file) => file.path.startsWith(folder.path));

    // Get current project ID if in a project
    const currentProject = getCurrentProject();
    const currentProjectId = currentProject?.id;

    if (currentProjectId) {
      // In project mode: return only files with this project's ID prefix
      const projectPrefix = `${currentProjectId}__`;
      return folderFiles.filter((file) => file.basename.startsWith(projectPrefix));
    } else {
      // In non-project mode: return only files without any project ID prefix
      // This assumes project IDs always use the format projectId__ as prefix
      return folderFiles.filter((file) => {
        // Check if the filename has any projectId__ prefix pattern
        return !file.basename.match(/^[a-zA-Z0-9-]+__/);
      });
    }
  }

  async getChatHistoryItems(): Promise<ChatHistoryItem[]> {
    const files = await this.getChatHistoryFiles();
    return files.map((file) => ({
      id: file.path,
      title: extractChatTitle(file),
      createdAt: extractChatDate(file),
    }));
  }

  async loadChatHistory(file: TFile) {
    // First autosave the current chat if the setting is enabled
    await this.autosaveCurrentChat();

    // Check if the Copilot view is already active
    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (!existingView) {
      // Only activate the view if it's not already open
      this.activateView();
    }

    // Load messages using ChatUIState (which now uses ChatPersistenceManager internally)
    await this.chatUIState.loadChatHistory(file);

    // Update the view
    const copilotView = (existingView || this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0])
      ?.view as CopilotView;
    if (copilotView) {
      copilotView.updateView();
    }
  }

  async loadChatById(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.loadChatHistory(file);
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async openChatSourceFile(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter.topic = newTitle;
      });

      // Wait for metadata cache to update with improved error handling
      // This ensures that subsequent calls to extractChatTitle will get the updated data
      await new Promise<void>((resolve) => {
        const handler = (updatedFile: TFile) => {
          if (updatedFile.path === fileId) {
            this.app.metadataCache.off("changed", handler);
            clearTimeout(timeoutId);
            resolve();
          }
        };

        this.app.metadataCache.on("changed", handler);

        // Fallback timeout with shorter duration and better error handling
        const timeoutId = setTimeout(() => {
          this.app.metadataCache.off("changed", handler);
          // Don't reject, just resolve - the frontmatter update might have worked
          // even if we didn't catch the event
          resolve();
        }, 500); // Reduced timeout for better performance
      });

      new Notice("Chat title updated.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async deleteChatHistory(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
      new Notice("Chat deleted.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async handleNewChat() {
    clearRecordedPromptPayload();

    // Analyze chat messages for memory if enabled
    if (getSettings().enableRecentConversations) {
      try {
        // Get the current chat model from the chain manager
        const chainManager = this.projectManager.getCurrentChainManager();
        const chatModel = chainManager.chatModelManager.getChatModel();
        this.userMemoryManager.addRecentConversation(this.chatUIState.getMessages(), chatModel);
      } catch (error) {
        logInfo("Failed to analyze chat messages for memory:", error);
      }
    }

    // First autosave the current chat if the setting is enabled
    await this.autosaveCurrentChat();

    // Abort any ongoing streams before clearing chat
    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      // Dispatch abort event to stop any ongoing streams
      const abortEvent = new CustomEvent(EVENT_NAMES.ABORT_STREAM, {
        detail: { reason: ABORT_REASON.NEW_CHAT },
      });
      copilotView.eventTarget.dispatchEvent(abortEvent);
    }

    // Clear messages through ChatUIState (which also clears chain memory)
    this.chatUIState.clearMessages();

    // Update view if it exists
    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      copilotView.updateView();
    } else {
      // If view doesn't exist, open it
      await this.activateView();
    }

    // Note: UI-specific state like includeActiveNote setting is handled in the Chat component
    // This ensures proper separation of concerns between plugin logic and UI state
  }

  async newChat() {
    // Just delegate to the shared method
    await this.handleNewChat();
  }

  async customSearchDB(query: string, salientTerms: string[], textWeight: number): Promise<any[]> {
    const settings = getSettings();
    const retriever = settings.enableSemanticSearchV3
      ? new (await import("@/search/v3/MergedSemanticRetriever")).MergedSemanticRetriever(
          this.app,
          {
            minSimilarityScore: 0.3,
            maxK: 20,
            salientTerms: salientTerms,
            textWeight: textWeight,
            returnAll: false,
          }
        )
      : new (await import("@/search/v3/TieredLexicalRetriever")).TieredLexicalRetriever(this.app, {
          minSimilarityScore: 0.3,
          maxK: 20,
          salientTerms: salientTerms,
          textWeight: textWeight,
          timeRange: undefined,
          returnAll: false,
          useRerankerThreshold: undefined,
        });

    const results = await retriever.getRelevantDocuments(query);
    return results.map((doc) => ({
      content: doc.pageContent,
      metadata: doc.metadata,
    }));
  }
}
