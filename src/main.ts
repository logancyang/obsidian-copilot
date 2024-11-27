import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ChainManager from "@/LLMProviders/chainManager";
import VectorStoreManager from "@/VectorStoreManager";
import { CustomModel, LangChainParams, SetChainOptions } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { parseChatContent, updateChatMemory } from "@/chatUtils";
import { registerBuiltInCommands } from "@/commands";
import CopilotView from "@/components/CopilotView";
import { AddPromptModal } from "@/components/modals/AddPromptModal";
import { AdhocPromptModal } from "@/components/modals/AdhocPromptModal";
import { IndexedFilesModal } from "@/components/modals/IndexedFilesModal";
import { ListPromptModal } from "@/components/modals/ListPromptModal";
import { LoadChatHistoryModal } from "@/components/modals/LoadChatHistoryModal";
import { OramaSearchModal } from "@/components/modals/OramaSearchModal";
import { SimilarNotesModal } from "@/components/modals/SimilarNotesModal";
import {
  BUILTIN_CHAT_MODELS,
  BUILTIN_EMBEDDING_MODELS,
  CHAT_VIEWTYPE,
  CHUNK_SIZE,
  DEFAULT_OPEN_AREA,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  EVENT_NAMES,
  VAULT_VECTOR_STORE_STRATEGY,
} from "@/constants";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import EncryptionService from "@/encryptionService";
import { CustomError } from "@/error";
import { TimestampUsageStrategy } from "@/promptUsageStrategy";
import { HybridRetriever } from "@/search/hybridRetriever";
import { CopilotSettings, CopilotSettingTab } from "@/settings/SettingsPage";
import SharedState from "@/sharedState";
import { FileParserManager } from "@/tools/FileParserManager";
import { sanitizeSettings } from "@/utils";
import VectorDBManager from "@/vectorDBManager";
import { Embeddings } from "@langchain/core/embeddings";
import { search } from "@orama/orama";
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

export default class CopilotPlugin extends Plugin {
  settings: CopilotSettings;
  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  sharedState: SharedState;
  chainManager: ChainManager;
  brevilabsClient: BrevilabsClient;
  encryptionService: EncryptionService;
  userMessageHistory: string[] = [];
  vectorStoreManager: VectorStoreManager;
  langChainParams: LangChainParams;
  fileParserManager: FileParserManager;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    // Always have one instance of sharedState and chainManager in the plugin
    this.sharedState = new SharedState();
    this.langChainParams = this.getLangChainParams();

    this.encryptionService = new EncryptionService(this.settings);
    this.vectorStoreManager = new VectorStoreManager(
      this.app,
      this.settings,
      this.encryptionService,
      () => this.langChainParams
    );

    // Initialize event listeners for the VectorStoreManager, e.g. onModify triggers reindexing
    await this.vectorStoreManager.initializeEventListeners();

    if (this.settings.enableEncryption) {
      await this.saveSettings();
    }

    // Initialize the rate limiter
    VectorDBManager.initialize({
      getEmbeddingRequestsPerSecond: () => this.settings.embeddingRequestsPerSecond,
      debug: this.settings.debug,
    });

    // Initialize BrevilabsClient
    this.brevilabsClient = BrevilabsClient.getInstance(this.settings.plusLicenseKey, {
      debug: this.settings.debug,
    });

    // Ensure activeModels always includes core models
    this.mergeAllActiveModelsWithCoreModels();
    this.chainManager = new ChainManager(
      this.app,
      () => this.langChainParams,
      this.encryptionService,
      this.settings,
      this.vectorStoreManager,
      this.brevilabsClient
    );

    // Initialize FileParserManager early with other core services
    this.fileParserManager = new FileParserManager(this.brevilabsClient);

    this.registerView(CHAT_VIEWTYPE, (leaf: WorkspaceLeaf) => new CopilotView(leaf, this));

    this.initActiveLeafChangeHandler();

    this.addCommand({
      id: "chat-toggle-window",
      name: "Toggle Copilot Chat Window",
      callback: () => {
        this.toggleView();
      },
    });

    this.addCommand({
      id: "chat-open-window",
      name: "Open Copilot Chat Window",
      callback: () => {
        this.activateView();
      },
    });

    this.addRibbonIcon("message-square", "Copilot Chat", (evt: MouseEvent) => {
      this.activateView();
    });

    registerBuiltInCommands(this);

    const promptProcessor = CustomPromptProcessor.getInstance(
      this.app.vault,
      this.settings,
      new TimestampUsageStrategy(this.settings, () => this.saveSettings())
    );

    this.addCommand({
      id: "add-custom-prompt",
      name: "Add custom prompt",
      callback: () => {
        new AddPromptModal(this.app, async (title: string, prompt: string) => {
          try {
            await promptProcessor.savePrompt(title, prompt);
            new Notice("Custom prompt saved successfully.");
          } catch (e) {
            new Notice("Error saving custom prompt. Please check if the title already exists.");
            console.error(e);
          }
        }).open();
      },
    });

    this.addCommand({
      id: "apply-custom-prompt",
      name: "Apply custom prompt",
      callback: async () => {
        const prompts = await promptProcessor.getAllPrompts();
        const promptTitles = prompts.map((p) => p.title);
        new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
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
            this.processCustomPrompt("applyCustomPrompt", prompt.content);
          } catch (err) {
            console.error(err);
            new Notice("An error occurred.");
          }
        }).open();
      },
    });

    this.addCommand({
      id: "apply-adhoc-prompt",
      name: "Apply ad-hoc custom prompt",
      callback: async () => {
        const modal = new AdhocPromptModal(this.app, async (adhocPrompt: string) => {
          try {
            this.processCustomPrompt("applyAdhocPrompt", adhocPrompt);
          } catch (err) {
            console.error(err);
            new Notice("An error occurred.");
          }
        });

        modal.open();
      },
    });

    this.addCommand({
      id: "delete-custom-prompt",
      name: "Delete custom prompt",
      checkCallback: (checking: boolean) => {
        if (checking) {
          return true;
        }

        promptProcessor.getAllPrompts().then((prompts) => {
          const promptTitles = prompts.map((p) => p.title);
          new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
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
      },
    });

    this.addCommand({
      id: "edit-custom-prompt",
      name: "Edit custom prompt",
      checkCallback: (checking: boolean) => {
        if (checking) {
          return true;
        }

        promptProcessor.getAllPrompts().then((prompts) => {
          const promptTitles = prompts.map((p) => p.title);
          new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
            if (!promptTitle) {
              new Notice("Please select a prompt title.");
              return;
            }

            try {
              const prompt = await promptProcessor.getPrompt(promptTitle);
              if (prompt) {
                new AddPromptModal(
                  this.app,
                  async (title: string, newPrompt: string) => {
                    try {
                      await promptProcessor.updatePrompt(promptTitle, title, newPrompt);
                      new Notice(`Prompt "${title}" has been updated.`);
                    } catch (err) {
                      console.error(err);
                      if (err instanceof CustomError) {
                        new Notice(err.msg);
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
      },
    });

    this.addCommand({
      id: "clear-local-copilot-index",
      name: "Clear Copilot index",
      callback: async () => {
        await this.vectorStoreManager.clearIndex();
      },
    });

    this.addCommand({
      id: "garbage-collect-copilot-index",
      name: "Garbage collect Copilot index (remove files that no longer exist in vault)",
      callback: async () => {
        await this.vectorStoreManager.garbageCollectVectorStore();
      },
    });

    this.addCommand({
      id: "index-vault-to-copilot-index",
      name: "Index (refresh) vault for QA",
      callback: async () => {
        try {
          const indexedFileCount = await this.vectorStoreManager.indexVaultToVectorStore();

          new Notice(`${indexedFileCount} vault files indexed to Copilot index.`);
          console.log(`${indexedFileCount} vault files indexed to Copilot index.`);
        } catch (err) {
          console.error("Error indexing vault to Copilot index:", err);
          new Notice("An error occurred while indexing vault to Copilot index.");
        }
      },
    });

    this.addCommand({
      id: "force-reindex-vault-to-copilot-index",
      name: "Force re-index vault for QA",
      callback: async () => {
        try {
          await this.vectorStoreManager.clearIndex();
          const indexedFileCount = await this.vectorStoreManager.indexVaultToVectorStore(true);

          new Notice(`${indexedFileCount} vault files re-indexed to Copilot index.`);
          console.log(`${indexedFileCount} vault files re-indexed to Copilot index.`);
        } catch (err) {
          console.error("Error re-indexing vault to Copilot index:", err);
          new Notice("An error occurred while re-indexing vault to Copilot index.");
        }
      },
    });

    this.addCommand({
      id: "load-copilot-chat-conversation",
      name: "Load Copilot Chat conversation",
      callback: () => {
        this.loadCopilotChatHistory();
      },
    });

    this.addCommand({
      id: "find-similar-notes",
      name: "Find similar notes to active note",
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice("No active file");
          return;
        }

        const activeNoteContent = await this.app.vault.cachedRead(activeFile);
        const similarChunks = await this.findSimilarNotes(activeNoteContent, activeFile.path);
        new SimilarNotesModal(this.app, similarChunks).open();
      },
    });

    this.addCommand({
      id: "copilot-db-search",
      name: "CopilotDB Search",
      callback: () => {
        new OramaSearchModal(this.app, this).open();
      },
    });

    this.addCommand({
      id: "list-indexed-files",
      name: "List all indexed files",
      callback: async () => {
        try {
          const indexedFiles = await this.vectorStoreManager.getIndexedFiles();
          if (indexedFiles.length === 0) {
            new Notice("No indexed files found.");
            return;
          }
          new IndexedFilesModal(this.app, indexedFiles).open();
        } catch (error) {
          console.error("Error listing indexed files:", error);
          new Notice("Failed to list indexed files.");
        }
      },
    });

    // Index vault to Copilot index on startup and after loading all commands
    // This can take a while, so we don't want to block the startup process
    if (this.settings.indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_STARTUP) {
      try {
        await this.vectorStoreManager.indexVaultToVectorStore();
      } catch (err) {
        console.error("Error saving vault to Copilot index:", err);
        new Notice("An error occurred while saving vault to Copilot index.");
      }
    }

    this.registerEvent(this.app.workspace.on("editor-menu", this.handleContextMenu));
  }

  async onunload() {
    // Clean up VectorStoreManager
    if (this.vectorStoreManager) {
      this.vectorStoreManager.onunload();
    }

    console.log("Copilot plugin unloaded");
  }

  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  async autosaveCurrentChat() {
    if (this.settings.autosaveChat) {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView && chatView.sharedState.chatHistory.length > 0) {
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
        activeCopilotView.emitter.dispatchEvent(event);
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
      activeCopilotView.emitter.dispatchEvent(event);
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
    leaves.length > 0 ? this.deactivateView() : this.activateView();
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length === 0) {
      if (this.settings.defaultOpenArea === DEFAULT_OPEN_AREA.VIEW) {
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
    }
    this.app.workspace.revealLeaf(leaves[0]);
    this.emitChatIsVisible();
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Ensure activeModels always includes core models
    this.mergeAllActiveModelsWithCoreModels();
  }

  mergeActiveModels(
    existingActiveModels: CustomModel[],
    builtInModels: CustomModel[]
  ): CustomModel[] {
    const modelMap = new Map<string, CustomModel>();

    // Create a unique key for each model, it's model (name + provider)
    const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

    // Add or update existing models in the map
    existingActiveModels.forEach((model) => {
      const key = getModelKey(model);
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

  mergeAllActiveModelsWithCoreModels(): void {
    this.settings.activeModels = this.mergeActiveModels(
      this.settings.activeModels,
      BUILTIN_CHAT_MODELS
    );
    this.settings.activeEmbeddingModels = this.mergeActiveModels(
      this.settings.activeEmbeddingModels,
      BUILTIN_EMBEDDING_MODELS
    );
  }

  async saveSettings(): Promise<void> {
    if (this.settings.enableEncryption) {
      // Encrypt all API keys before saving
      this.encryptionService.encryptAllKeys();
    }
    // Ensure activeModels always includes core models
    this.mergeAllActiveModelsWithCoreModels();
    await this.saveData(this.settings);
  }

  async countTotalTokens(): Promise<number> {
    try {
      const allContent = await this.vectorStoreManager.getAllQAMarkdownContent();
      const totalTokens = await this.chainManager.chatModelManager.countTokens(allContent);
      return totalTokens;
    } catch (error) {
      console.error("Error counting tokens: ", error);
      return 0;
    }
  }

  handleContextMenu = (menu: Menu, editor: Editor): void => {
    this.addContextMenu(menu, editor, this);
  };

  addContextMenu = (menu: Menu, editor: Editor, plugin: this): void => {
    menu.addItem((item) => {
      item
        .setTitle("Copilot: Summarize Selection")
        .setIcon("bot")
        .onClick(async (e) => {
          plugin.processSelection(editor, "summarizeSelection");
        });
    });
  };

  getLangChainParams(): LangChainParams {
    if (!this.settings) {
      throw new Error("Settings are not loaded");
    }

    const {
      openAIApiKey,
      openAIOrgId,
      huggingfaceApiKey,
      cohereApiKey,
      anthropicApiKey,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      googleApiKey,
      openRouterAiApiKey,
      embeddingModelKey,
      temperature,
      maxTokens,
      contextTurns,
      groqApiKey,
    } = sanitizeSettings(this.settings);
    return {
      openAIApiKey,
      openAIOrgId,
      huggingfaceApiKey,
      cohereApiKey,
      anthropicApiKey,
      groqApiKey,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      googleApiKey,
      openRouterAiApiKey,
      modelKey: this.settings.defaultModelKey,
      embeddingModelKey: embeddingModelKey || DEFAULT_SETTINGS.embeddingModelKey,
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      systemMessage: this.settings.userSystemPrompt || DEFAULT_SYSTEM_PROMPT,
      chatContextTurns: Number(contextTurns),
      chainType: this.settings.defaultChainType || ChainType.LLM_CHAIN,
      options: { forceNewCreation: true, debug: this.settings.debug } as SetChainOptions,
      openAIProxyBaseUrl: this.settings.openAIProxyBaseUrl,
      openAIEmbeddingProxyBaseUrl: this.settings.openAIEmbeddingProxyBaseUrl,
    };
  }

  getEncryptionService(): EncryptionService {
    return this.encryptionService;
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
    const folder = this.app.vault.getAbstractFileByPath(this.settings.defaultSaveFolder);
    if (!(folder instanceof TFolder)) {
      return [];
    }
    const files = await this.app.vault.getMarkdownFiles();
    return files.filter((file) => file.path.startsWith(folder.path));
  }

  async loadChatHistory(file: TFile) {
    const content = await this.app.vault.read(file);
    const messages = parseChatContent(content);
    this.sharedState.clearChatHistory();
    messages.forEach((message) => this.sharedState.addMessage(message));

    // Update the chain's memory with the loaded messages
    await updateChatMemory(messages, this.chainManager.memoryManager);

    // Check if the Copilot view is already active
    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (!existingView) {
      // Only activate the view if it's not already open
      this.activateView();
    } else {
      // If the view is already open, just update its content
      const copilotView = existingView.view as CopilotView;
      copilotView.updateView();
    }
  }

  async findSimilarNotes(content: string, activeFilePath: string): Promise<any> {
    // Wait for the VectorStoreManager to initialize
    await this.vectorStoreManager.waitForInitialization();

    const db = this.vectorStoreManager.getDb();
    if (!db) {
      throw new CustomError("Orama database not found.");
    }

    // Check if the index is empty
    const singleDoc = await search(db, {
      term: "",
      limit: 1,
    });

    if (singleDoc.hits.length === 0) {
      // Index is empty, trigger indexing
      new Notice("Index does not exist, indexing vault for similarity search...");
      await this.vectorStoreManager.indexVaultToVectorStore();
    }

    const hybridRetriever = new HybridRetriever(
      db,
      this.app.vault,
      this.chainManager.chatModelManager.getChatModel(),
      this.vectorStoreManager.getEmbeddingsManager().getEmbeddingsAPI() as Embeddings,
      this.chainManager.brevilabsClient,
      {
        minSimilarityScore: 0.3,
        maxK: 20,
        salientTerms: [],
      },
      this.settings.debug
    );

    const truncatedContent = content.length > CHUNK_SIZE ? content.slice(0, CHUNK_SIZE) : content;
    const similarDocs = await hybridRetriever.getRelevantDocuments(truncatedContent, {
      runName: "no_hyde",
    });
    return similarDocs
      .filter((doc) => doc.metadata.path !== activeFilePath)
      .map((doc) => ({
        chunk: doc,
        score: doc.metadata.score || 0,
      }))
      .sort((a, b) => b.score - a.score);
  }

  async customSearchDB(query: string, salientTerms: string[], textWeight: number): Promise<any[]> {
    await this.vectorStoreManager.waitForInitialization();
    const db = this.vectorStoreManager.getDb();
    if (!db) {
      throw new CustomError("Orama database not found.");
    }
    const hybridRetriever = new HybridRetriever(
      db,
      this.app.vault,
      this.chainManager.chatModelManager.getChatModel(),
      this.vectorStoreManager.getEmbeddingsManager().getEmbeddingsAPI() as Embeddings,
      this.chainManager.brevilabsClient,
      {
        minSimilarityScore: 0.3,
        maxK: 20,
        salientTerms: salientTerms,
        textWeight: textWeight,
      },
      this.settings.debug
    );

    const results = await hybridRetriever.getOramaChunks(query, salientTerms);
    return results.map((doc) => ({
      content: doc.pageContent,
      metadata: doc.metadata,
    }));
  }
}
