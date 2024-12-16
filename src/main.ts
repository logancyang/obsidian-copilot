import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ChainManager from "@/LLMProviders/chainManager";
import VectorStoreManager from "@/VectorStoreManager";
import { CustomModel } from "@/aiParams";
import { parseChatContent, updateChatMemory } from "@/chatUtils";
import { registerBuiltInCommands } from "@/commands";
import CopilotView from "@/components/CopilotView";
import { AddPromptModal } from "@/components/modals/AddPromptModal";
import { AdhocPromptModal } from "@/components/modals/AdhocPromptModal";
import { ListPromptModal } from "@/components/modals/ListPromptModal";
import { LoadChatHistoryModal } from "@/components/modals/LoadChatHistoryModal";
import { OramaSearchModal } from "@/components/modals/OramaSearchModal";
import { SimilarNotesModal } from "@/components/modals/SimilarNotesModal";
import { CHAT_VIEWTYPE, CHUNK_SIZE, DEFAULT_OPEN_AREA, EVENT_NAMES } from "@/constants";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { encryptAllKeys } from "@/encryptionService";
import { CustomError } from "@/error";
import { HybridRetriever } from "@/search/hybridRetriever";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import {
  getSettings,
  sanitizeSettings,
  setSettings,
  subscribeToSettingsChange,
} from "@/settings/model";
import SharedState from "@/sharedState";
import { FileParserManager } from "@/tools/FileParserManager";
import { Embeddings } from "@langchain/core/embeddings";

import { search } from "@orama/orama";
import { get_encoding } from "@dqbd/tiktoken";
import {
  Editor,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  requestUrl,
} from "obsidian";

interface EnhancedDocument extends Document {
  score?: number;
  pageContent: string;
  metadata: Record<string, any>;
}

export default class CopilotPlugin extends Plugin {
  sharedState: SharedState;
  chainManager: ChainManager;
  brevilabsClient: BrevilabsClient;
  userMessageHistory: string[] = [];
  vectorStoreManager: VectorStoreManager;
  fileParserManager: FileParserManager;
  settingsUnsubscriber?: () => void;

  async onload(): Promise<void> {
    await this.checkForUpdates();
    await this.loadSettings();
    this.settingsUnsubscriber = subscribeToSettingsChange(() => {
      const settings = getSettings();
      if (settings.enableEncryption) {
        this.saveData(encryptAllKeys(settings));
      } else {
        this.saveData(settings);
      }
      registerBuiltInCommands(this);
    });

    this.addSettingTab(new CopilotSettingTab(this.app, this));
    this.sharedState = new SharedState();

    this.vectorStoreManager = new VectorStoreManager(this.app);
    this.vectorStoreManager.initializeEventListeners();

    this.brevilabsClient = BrevilabsClient.getInstance();
    this.chainManager = new ChainManager(this.app, this.vectorStoreManager, this.brevilabsClient);
    this.fileParserManager = new FileParserManager(this.brevilabsClient);

    this.registerView(CHAT_VIEWTYPE, (leaf: WorkspaceLeaf) => new CopilotView(leaf, this));

    this.initActiveLeafChangeHandler();

    // Register all commands
    await this.registerCommands();

    // Add ribbon icon
    this.addRibbonIcon("message-square", "Open Copilot Chat", (evt: MouseEvent) => {
      this.activateView();
    });

    // Register context menu
    this.registerEvent(this.app.workspace.on("editor-menu", this.handleContextMenu));
  }

  private async registerCommands(): Promise<void> {
    // Core chat commands
    this.addCommand({
      id: "chat-toggle-window",
      name: "Toggle Copilot Chat Window",
      callback: () => this.toggleView(),
    });

    this.addCommand({
      id: "chat-open-window",
      name: "Open Copilot Chat Window",
      callback: async () => {
        this.activateView();
        await this.checkForUpdates();
      },
    });

    // Register built-in commands
    registerBuiltInCommands(this);

    // Setup custom prompt handling
    const promptProcessor = CustomPromptProcessor.getInstance(this.app.vault);
    await this.setupPromptCommands(promptProcessor);

    // Setup indexing commands
    await this.setupIndexingCommands();

    // Setup search commands
    await this.setupSearchCommands();
  }

  // Enhanced RAG functionality
  async enhanceRetrievalWithRAG(query: string): Promise<{ context: string; sources: string[] }> {
    await this.vectorStoreManager.waitForInitialization();

    const db = this.vectorStoreManager.getDb();
    if (!db) {
      throw new CustomError("Database not initialized");
    }

    const hybridRetriever = new HybridRetriever(
      db,
      this.app.vault,
      this.chainManager.chatModelManager.getChatModel(),
      this.vectorStoreManager.getEmbeddingsManager().getEmbeddingsAPI() as Embeddings,
      this.chainManager.brevilabsClient,
      {
        minSimilarityScore: 0.4,
        maxK: 10,
        salientTerms: await this.extractSalientTerms(query),
        textWeight: 0.7,
      },
      getSettings().debug
    );

    const relevantDocs = await hybridRetriever.getRelevantDocuments(query, {
      runName: "rag_enhanced",
    });

    const rerankedDocs = await this.rerankDocuments(query, relevantDocs as EnhancedDocument[]);
    return this.combineContext(rerankedDocs);
  }

  private async extractSalientTerms(query: string): Promise<string[]> {
    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const response = await chatModel.call([
      {
        role: "system",
        content:
          "Extract 3-5 key search terms from the following query. Respond only with the terms, separated by commas.",
      },
      {
        role: "user",
        content: query,
      },
    ]);

    // Safer content type handling
    let contentStr = "";
    if (typeof response.content === "string") {
      contentStr = response.content;
    } else if (Array.isArray(response.content)) {
      // Handle array of MessageContentComplex
      contentStr = response.content
        .map((content) => {
          if ("type" in content && content.type === "text") {
            return content.text;
          }
          return "";
        })
        .join("");
    }

    return contentStr.split(",").map((term: string) => term.trim());
  }

  private async rerankDocuments(
    query: string,
    docs: EnhancedDocument[]
  ): Promise<EnhancedDocument[]> {
    const chatModel = this.chainManager.chatModelManager.getChatModel();

    const scoredDocs = await Promise.all(
      docs.map(async (doc) => {
        const score = await this.scoreRelevance(query, doc.pageContent, chatModel);
        return { ...doc, score };
      })
    );

    return scoredDocs.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  private async scoreRelevance(query: string, content: string, chatModel: any): Promise<number> {
    const response = await chatModel.call([
      {
        role: "system",
        content:
          "Score the relevance of the following content to the query on a scale of 0-1. Respond only with the numeric score.",
      },
      {
        role: "user",
        content: `Query: ${query}\nContent: ${content}`,
      },
    ]);

    return parseFloat(typeof response.content === "string" ? response.content : "0");
  }

  private async countTokens(text: string): Promise<number> {
    const enc = await get_encoding("cl100k_base");
    const tokens = enc.encode(text);
    enc.free();
    return tokens.length;
  }

  private combineContext(docs: EnhancedDocument[]): { context: string; sources: string[] } {
    const maxTokens = 3000;
    const contexts: string[] = [];
    const sources: string[] = [];
    let currentTokens = 0;

    for (const doc of docs) {
      const tokens = doc.pageContent.length / 4; // Rough estimation
      if (currentTokens + tokens > maxTokens) break;

      contexts.push(doc.pageContent);
      sources.push(doc.metadata.path);
      currentTokens += tokens;
    }

    return {
      context: contexts.join("\n\n"),
      sources: [...new Set(sources)],
    };
  }

  async generateChatResponse(prompt: string, context: string[] = []): Promise<string> {
    const { context: relevantContext, sources } = await this.enhanceRetrievalWithRAG(prompt);

    const enhancedPrompt = `
Context from vault:
${relevantContext}

Sources: ${sources.join(", ")}

User question: ${prompt}

Please provide a response based on the context above while maintaining consistency with the existing worldbuilding. If you reference specific information, note which source it came from.`;

    const response = await this.chainManager.chatModelManager.getChatModel().call([
      {
        role: "user",
        content: enhancedPrompt,
      },
    ]);

    // Safer content type handling
    if (typeof response.content === "string") {
      return response.content;
    } else if (Array.isArray(response.content)) {
      return response.content
        .map((content) => {
          if ("type" in content && content.type === "text") {
            return content.text;
          }
          return "";
        })
        .join("");
    }
    return ""; // Fallback empty string if no valid content
  }
  private async setupPromptCommands(promptProcessor: CustomPromptProcessor): Promise<void> {
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
        new AdhocPromptModal(this.app, async (adhocPrompt: string) => {
          try {
            this.processCustomPrompt("applyAdhocPrompt", adhocPrompt);
          } catch (err) {
            console.error(err);
            new Notice("An error occurred.");
          }
        }).open();
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
      },
    });
  }

  private async setupIndexingCommands(): Promise<void> {
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
      id: "list-indexed-files",
      name: "List all indexed files",
      callback: async () => {
        try {
          const indexedFiles = await this.vectorStoreManager.getIndexedFiles();
          if (indexedFiles.length === 0) {
            new Notice("No indexed files found.");
            return;
          }

          // Create content for the new file
          const content = [
            "# Copilot Indexed Files",
            `Total files indexed: ${indexedFiles.length}`,
            "",
            "## Files",
            ...indexedFiles.map((file) => `- [[${file}]]`),
          ].join("\n");

          const fileName = `Copilot-Indexed-Files-${new Date().toLocaleDateString().replace(/\//g, "-")}.md`;
          const filePath = `${fileName}`;

          if (!this.app.vault.getAbstractFileByPath(filePath)) {
            await this.app.vault.create(filePath, content);
          }

          const createdFile = this.app.vault.getAbstractFileByPath(filePath);
          if (createdFile instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(createdFile);
            new Notice(`Created list of ${indexedFiles.length} indexed files`);
          }
        } catch (error) {
          console.error("Error listing indexed files:", error);
          new Notice("Failed to list indexed files.");
        }
      },
    });
  }

  private async setupSearchCommands(): Promise<void> {
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
  }
  // View Management Methods
  async toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    leaves.length > 0 ? this.deactivateView() : this.activateView();
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
        if (!leaf) return;
        if (leaf.getViewState().type === CHAT_VIEWTYPE) {
          this.emitChatIsVisible();
        }
      })
    );
  }

  // Text Processing Methods
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

  processCustomPrompt(eventType: string, customPrompt: string) {
    const editor = this.getCurrentEditorOrDummy();
    this.processText(editor, eventType, customPrompt, false);
  }

  private getCurrentEditorOrDummy(): Editor {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return {
      getSelection: () => {
        const selection = activeView?.editor?.getSelection();
        if (selection) return selection;
        const activeFile = this.app.workspace.getActiveFile();
        return activeFile ? this.app.vault.cachedRead(activeFile) : "";
      },
      replaceSelection: activeView?.editor?.replaceSelection.bind(activeView.editor) || (() => {}),
    } as Partial<Editor> as Editor;
  }

  // State management methods
  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  async autosaveCurrentChat() {
    if (getSettings().autosaveChat) {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView && chatView.sharedState.chatHistory.length > 0) {
        await chatView.saveChat();
      }
    }
  }
  // Chat History Management
  async loadChatHistory(file: TFile) {
    const content = await this.app.vault.read(file);
    const messages = parseChatContent(content);
    this.sharedState.clearChatHistory();
    messages.forEach((message) => this.sharedState.addMessage(message));
    await updateChatMemory(messages, this.chainManager.memoryManager);

    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (!existingView) {
      this.activateView();
    } else {
      const copilotView = existingView.view as CopilotView;
      copilotView.updateView();
    }
  }

  async getChatHistoryFiles(): Promise<TFile[]> {
    const folder = this.app.vault.getAbstractFileByPath(getSettings().defaultSaveFolder);
    if (!(folder instanceof TFolder)) {
      return [];
    }
    const files = await this.app.vault.getMarkdownFiles();
    return files.filter((file) => file.path.startsWith(folder.path));
  }

  async loadCopilotChatHistory() {
    const chatFiles = await this.getChatHistoryFiles();
    if (chatFiles.length === 0) {
      new Notice("No chat history found.");
      return;
    }
    new LoadChatHistoryModal(this.app, chatFiles, this.loadChatHistory.bind(this)).open();
  }

  // Context Menu Methods
  handleContextMenu = (menu: Menu, editor: Editor): void => {
    this.addContextMenu(menu, editor, this);
  };

  addContextMenu = (menu: Menu, editor: Editor, plugin: this): void => {
    menu.addItem((item) => {
      item
        .setTitle("Copilot: Summarize Selection")
        .setIcon("bot")
        .onClick(async () => {
          plugin.processSelection(editor, "summarizeSelection");
        });
    });
  };

  // DB Search Methods
  async findSimilarNotes(content: string, activeFilePath: string): Promise<any> {
    await this.vectorStoreManager.waitForInitialization();

    const db = this.vectorStoreManager.getDb();
    if (!db) {
      throw new CustomError("Orama database not found.");
    }

    const singleDoc = await search(db, {
      term: "",
      limit: 1,
    });

    if (singleDoc.hits.length === 0) {
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
      getSettings().debug
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

  async customSearchDB(
    query: string,
    salientTerms: string[],
    textWeight: number
  ): Promise<Array<{ content: string; metadata: Record<string, any> }>> {
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
      getSettings().debug
    );

    const results = await hybridRetriever.getOramaChunks(query, salientTerms);
    return results.map((doc) => ({
      content: doc.pageContent,
      metadata: doc.metadata,
    }));
  }
  // Settings Management
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
    const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

    existingActiveModels.forEach((model) => {
      const key = getModelKey(model);
      const existingModel = modelMap.get(key);
      if (existingModel) {
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

  // Update Checking Methods
  private async checkForUpdates(): Promise<void> {
    try {
      const response = await requestUrl({
        url: "https://api.github.com/repos/logancyang/obsidian-copilot/releases/latest",
        method: "GET",
      });

      const latestVersion = response.json.tag_name.replace("v", "");
      if (this.isNewerVersion(latestVersion, this.manifest.version)) {
        new Notice(
          `A newer version (${latestVersion}) of Obsidian Copilot is available. You are currently on version ${this.manifest.version}. Please update to the latest version.`,
          10000
        );
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    }
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split(".").map(Number);
    const currentParts = current.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      if (latestParts[i] > currentParts[i]) return true;
      if (latestParts[i] < currentParts[i]) return false;
    }
    return false;
  }

  // Error handling for command callbacks
  private wrapCommand(callback: () => Promise<void>): () => Promise<void> {
    return async () => {
      try {
        await callback();
      } catch (error) {
        console.error("Command execution failed:", error);
        new Notice("An error occurred while executing the command");
        throw error;
      }
    };
  }

  // Cleanup Method
  async onunload() {
    try {
      if (this.vectorStoreManager) {
        await this.vectorStoreManager.onunload();
      }
      this.settingsUnsubscriber?.();

      // Clean up event listeners
      this.app.workspace.off("active-leaf-change", this.handleActiveLeafChange);
      this.app.workspace.off("editor-menu", this.handleContextMenu);

      // Clean up views
      this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);

      // Final cleanup message
      console.log("Copilot plugin unloaded successfully");
    } catch (error) {
      console.error("Error during plugin cleanup:", error);
    }
  }

  private handleActiveLeafChange = (leaf: WorkspaceLeaf | null) => {
    if (!leaf) return;
    if (leaf.getViewState().type === CHAT_VIEWTYPE) {
      this.emitChatIsVisible();
    }
  };
}
