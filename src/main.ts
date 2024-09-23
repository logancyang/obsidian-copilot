import ChainManager from "@/LLMProviders/chainManager";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { CustomModel, LangChainParams, SetChainOptions } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { registerBuiltInCommands } from "@/commands";
import { AddPromptModal } from "@/components/AddPromptModal";
import { AdhocPromptModal } from "@/components/AdhocPromptModal";
import { ChatNoteContextModal } from "@/components/ChatNoteContextModal";
import CopilotView from "@/components/CopilotView";
import { ListPromptModal } from "@/components/ListPromptModal";
import { LoadChatHistoryModal } from "@/components/LoadChatHistoryModal";
import { QAExclusionModal } from "@/components/QAExclusionModal";
import {
  AI_SENDER,
  BUILTIN_CHAT_MODELS,
  BUILTIN_EMBEDDING_MODELS,
  CHAT_VIEWTYPE,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  USER_SENDER,
  EVENT_NAMES,
  VAULT_VECTOR_STORE_STRATEGY,
} from "@/constants";
import { CustomPrompt, CustomPromptDB, CustomPromptProcessor } from "@/customPromptProcessor";
import EncryptionService from "@/encryptionService";
import { CopilotSettings, CopilotSettingTab } from "@/settings/SettingsPage";
import SharedState, { ChatMessage } from "@/sharedState";
import {
  areEmbeddingModelsSame,
  getAllNotesContent,
  isPathInList,
  sanitizeSettings,
} from "@/utils";
import VectorDBManager, { VectorStoreDocument } from "@/vectorDBManager";
import { MD5 } from "crypto-js";
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
import PouchDB from "pouchdb-browser";
import { CustomError } from "@/error";
import { TimestampUsageStrategy } from "@/PromptUsageStrategy";

export default class CopilotPlugin extends Plugin {
  settings: CopilotSettings;
  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  sharedState: SharedState;
  chainManager: ChainManager;
  activateViewPromise: Promise<void> | null = null;
  chatIsVisible = false;
  dbPrompts: PouchDB.Database;
  dbVectorStores: PouchDB.Database<VectorStoreDocument>;
  embeddingsManager: EmbeddingsManager;
  encryptionService: EncryptionService;
  userMessageHistory: string[] = [];

  isChatVisible = () => this.chatIsVisible;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    // Always have one instance of sharedState and chainManager in the plugin
    this.sharedState = new SharedState();
    const langChainParams = this.getChainManagerParams();
    this.encryptionService = new EncryptionService(this.settings);
    this.dbVectorStores = new PouchDB<VectorStoreDocument>(
      `copilot_vector_stores_${this.getVaultIdentifier()}`
    );

    this.mergeAllActiveModelsWithExisting();
    this.chainManager = new ChainManager(
      this.app,
      langChainParams,
      this.encryptionService,
      this.settings,
      () => this.dbVectorStores
    );

    if (this.settings.enableEncryption) {
      await this.saveSettings();
    }

    this.embeddingsManager = EmbeddingsManager.getInstance(
      () => langChainParams,
      this.encryptionService,
      this.settings.activeEmbeddingModels
    );
    this.dbPrompts = new PouchDB<CustomPrompt>("copilot_custom_prompts");

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
      id: "chat-toggle-window-note-area",
      name: "Toggle Copilot Chat Window in Note Area",
      callback: () => {
        this.toggleViewNoteArea();
      },
    });

    this.addRibbonIcon("message-square", "Copilot Chat", (evt: MouseEvent) => {
      this.toggleView();
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
      id: "clear-local-vector-store",
      name: "Clear local vector store",
      callback: async () => {
        try {
          // Clear the vectorstore db
          await this.dbVectorStores.destroy();
          // Reinitialize the database
          this.dbVectorStores = new PouchDB<VectorStoreDocument>(
            `copilot_vector_stores_${this.getVaultIdentifier()}`
          );
          new Notice("Local vector store cleared successfully.");
          console.log("Local vector store cleared successfully, new instance created.");
        } catch (err) {
          console.error("Error clearing the local vector store:", err);
          new Notice("An error occurred while clearing the local vector store.");
        }
      },
    });

    this.addCommand({
      id: "garbage-collect-vector-store",
      name: "Garbage collect vector store (remove files that no longer exist in vault)",
      callback: async () => {
        try {
          const files = this.app.vault.getMarkdownFiles();
          const filePaths = files.map((file) => file.path);
          const indexedFiles = await VectorDBManager.getNoteFiles(this.dbVectorStores);
          const indexedFilePaths = indexedFiles.map((file) => file.path);
          const filesToDelete = indexedFilePaths.filter(
            (filePath) => !filePaths.includes(filePath)
          );

          const deletePromises = filesToDelete.map(async (filePath) => {
            VectorDBManager.removeMemoryVectors(
              this.dbVectorStores,
              VectorDBManager.getDocumentHash(filePath)
            );
          });

          await Promise.all(deletePromises);

          new Notice("Local vector store garbage collected successfully.");
          console.log("Local vector store garbage collected successfully, new instance created.");
        } catch (err) {
          console.error("Error clearing the local vector store:", err);
          new Notice("An error occurred while clearing the local vector store.");
        }
      },
    });

    this.addCommand({
      id: "index-vault-to-vector-store",
      name: "Index (refresh) vault for QA",
      callback: async () => {
        try {
          const indexedFileCount = await this.indexVaultToVectorStore();

          new Notice(`${indexedFileCount} vault files indexed to vector store.`);
          console.log(`${indexedFileCount} vault files indexed to vector store.`);
        } catch (err) {
          console.error("Error indexing vault to vector store:", err);
          new Notice("An error occurred while indexing vault to vector store.");
        }
      },
    });

    this.addCommand({
      id: "force-reindex-vault-to-vector-store",
      name: "Force re-index vault for QA",
      callback: async () => {
        try {
          const indexedFileCount = await this.indexVaultToVectorStore(true);

          new Notice(`${indexedFileCount} vault files indexed to vector store.`);
          console.log(`${indexedFileCount} vault files indexed to vector store.`);
        } catch (err) {
          console.error("Error re-indexing vault to vector store:", err);
          new Notice("An error occurred while re-indexing vault to vector store.");
        }
      },
    });

    this.addCommand({
      id: "set-chat-note-context",
      name: "Set note context for Chat mode",
      callback: async () => {
        new ChatNoteContextModal(this.app, this.settings, async (path: string, tags: string[]) => {
          // Store the path in the plugin's settings, default to empty string
          this.settings.chatNoteContextPath = path;
          this.settings.chatNoteContextTags = tags;
          await this.saveSettings();
        }).open();
      },
    });

    this.addCommand({
      id: "set-vault-qa-exclusion",
      name: "Set exclusion for Vault QA mode",
      callback: async () => {
        new QAExclusionModal(this.app, this.settings, async (paths: string) => {
          // Store the path in the plugin's settings, default to empty string
          this.settings.qaExclusionPaths = paths;
          await this.saveSettings();
        }).open();
      },
    });

    this.addCommand({
      id: "load-copilot-chat-conversation",
      name: "Load Copilot Chat conversation",
      callback: () => {
        this.loadCopilotChatHistory();
      },
    });

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        const docHash = VectorDBManager.getDocumentHash(file.path);
        VectorDBManager.removeMemoryVectors(this.dbVectorStores, docHash);
      })
    );

    // Index vault to vector store on startup and after loading all commands
    // This can take a while, so we don't want to block the startup process
    if (this.settings.indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_STARTUP) {
      try {
        await this.indexVaultToVectorStore();
      } catch (err) {
        console.error("Error saving vault to vector store:", err);
        new Notice("An error occurred while saving vault to vector store.");
      }
    }

    // Temporary: Migrate Custom Prompts from PouchDB to Markdown files.
    this.addCommand({
      id: "dump-custom-prompts-to-markdown",
      name: "Dump custom prompts to markdown files",
      callback: async () => {
        await this.dumpCustomPrompts(promptProcessor);
      },
    });

    this.registerEvent(this.app.workspace.on("editor-menu", this.handleContextMenu));
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

  async dumpCustomPrompts(promptProcessor: CustomPromptProcessor): Promise<void> {
    const folder = this.settings.customPromptsFolder || DEFAULT_SETTINGS.customPromptsFolder;

    try {
      // Fetch all prompts
      const response = await this.dbPrompts.allDocs({ include_docs: true });

      for (const row of response.rows) {
        const doc = row.doc as CustomPromptDB;
        if (doc && doc._id && doc.prompt) {
          await promptProcessor.savePrompt(doc._id, doc.prompt);
        }
      }

      new Notice(`Custom prompts dumped to ${folder} folder`);
    } catch (error) {
      console.error("Error dumping custom prompts:", error);
      new Notice("Error dumping custom prompts. Check console for details.");
    }
  }

  private getVaultIdentifier(): string {
    const vaultName = this.app.vault.getName();
    return MD5(vaultName).toString();
  }

  async saveFileToVectorStore(file: TFile): Promise<void> {
    const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingInstance) {
      new Notice("Embedding instance not found.");
      return;
    }
    const fileContent = await this.app.vault.cachedRead(file);
    const fileMetadata = this.app.metadataCache.getFileCache(file);
    const noteFile = {
      basename: file.basename,
      path: file.path,
      mtime: file.stat.mtime,
      content: fileContent,
      metadata: fileMetadata?.frontmatter ?? {},
    };
    VectorDBManager.indexFile(this.dbVectorStores, embeddingInstance, noteFile);
  }

  async indexVaultToVectorStore(overwrite?: boolean): Promise<number> {
    const embeddingInstance = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingInstance) {
      throw new Error("Embedding instance not found.");
    }

    // Check if embedding model has changed
    const prevEmbeddingModel = await VectorDBManager.checkEmbeddingModel(this.dbVectorStores);
    // TODO: Remove this when Ollama model is dynamically set
    const currEmbeddingModel = EmbeddingsManager.getModelName(embeddingInstance);

    if (this.settings.debug)
      console.log("Prev vs Current embedding models:", prevEmbeddingModel, currEmbeddingModel);

    if (!areEmbeddingModelsSame(prevEmbeddingModel, currEmbeddingModel)) {
      // Model has changed, clear DB and reindex from scratch
      overwrite = true;
      // Clear the current vector store with mixed embeddings
      try {
        // Clear the vectorstore db
        await this.dbVectorStores.destroy();
        // Reinitialize the database
        this.dbVectorStores = new PouchDB<VectorStoreDocument>(
          `copilot_vector_stores_${this.getVaultIdentifier()}`
        );
        new Notice("Detected change in embedding model. Rebuild vector store from scratch.");
        console.log("Detected change in embedding model. Rebuild vector store from scratch.");
      } catch (err) {
        console.error("Error clearing vector store for reindexing:", err);
        new Notice("Error clearing vector store for reindexing.");
      }
    }

    const latestMtime = await VectorDBManager.getLatestFileMtime(this.dbVectorStores);

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        if (!latestMtime || overwrite) return true;
        return file.stat.mtime > latestMtime;
      })
      // file not in qaExclusionPaths
      .filter((file) => {
        if (!this.settings.qaExclusionPaths) return true;
        return !isPathInList(file.path, this.settings.qaExclusionPaths);
      });

    const fileContents: string[] = await Promise.all(
      files.map((file) => this.app.vault.cachedRead(file))
    );
    const fileMetadatas = files.map((file) => this.app.metadataCache.getFileCache(file));

    const totalFiles = files.length;
    if (totalFiles === 0) {
      new Notice("Copilot vault index is up-to-date.");
      return 0;
    }

    let indexedCount = 0;
    const indexNotice = new Notice(
      `Copilot is indexing your vault...\n0/${totalFiles} files processed.`,
      0
    );

    const errors: string[] = [];
    const loadPromises = files.map(async (file, index) => {
      try {
        const noteFile = {
          basename: file.basename,
          path: file.path,
          mtime: file.stat.mtime,
          content: fileContents[index],
          metadata: fileMetadatas[index]?.frontmatter ?? {},
        };
        const result = await VectorDBManager.indexFile(
          this.dbVectorStores,
          embeddingInstance,
          noteFile
        );

        indexedCount++;
        indexNotice.setMessage(
          `Copilot is indexing your vault...\n${indexedCount}/${totalFiles} files processed.`
        );
        return result;
      } catch (err) {
        console.error("Error indexing file:", err);
        errors.push(`Error indexing file: ${file.basename}`);
      }
    });

    await Promise.all(loadPromises);
    setTimeout(() => {
      indexNotice.hide();
    }, 2000);

    if (errors.length > 0) {
      new Notice(`Indexing completed with errors. Check the console for details.`);
      console.log("Indexing Errors:", errors.join("\n"));
    }
    return files.length;
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

  processChatIsVisible(chatIsVisible: boolean) {
    if (this.chatIsVisible === chatIsVisible) {
      return;
    }

    this.chatIsVisible = chatIsVisible;

    const activeCopilotView = this.app.workspace
      .getLeavesOfType(CHAT_VIEWTYPE)
      .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;

    if (activeCopilotView) {
      const event = new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE, {
        detail: { chatIsVisible: this.chatIsVisible },
      });
      activeCopilotView.emitter.dispatchEvent(event);
    }
  }

  initActiveLeafChangeHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        this.processChatIsVisible(leaf.getViewState().type === CHAT_VIEWTYPE);
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
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    this.activateViewPromise = this.app.workspace.getRightLeaf(false).setViewState({
      type: CHAT_VIEWTYPE,
      active: true,
    });
    await this.activateViewPromise;
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]);
    this.processChatIsVisible(true);
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    this.processChatIsVisible(false);
  }

  async toggleViewNoteArea() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    leaves.length > 0 ? this.deactivateView() : this.activateViewNoteArea();
  }

  async activateViewNoteArea() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    this.activateViewPromise = this.app.workspace.getLeaf(true).setViewState({
      type: CHAT_VIEWTYPE,
      active: true,
    });
    await this.activateViewPromise;
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]);
    this.processChatIsVisible(true);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Ensure activeModels always includes builtInModels
    this.mergeAllActiveModelsWithExisting();
  }

  mergeActiveModels(
    existingActiveModels: CustomModel[],
    builtInModels: CustomModel[]
  ): CustomModel[] {
    const modelMap = new Map<string, CustomModel>();

    // Create a unique key for each model, it's model (name + provider)
    const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

    // Add built-in models to the map
    builtInModels.forEach((model) => {
      modelMap.set(getModelKey(model), { ...model, isBuiltIn: true });
    });

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
        modelMap.set(key, { ...model, isBuiltIn: false });
      }
    });

    return Array.from(modelMap.values());
  }

  mergeAllActiveModelsWithExisting(): void {
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

    // Ensure activeModels is merged before saving
    this.mergeAllActiveModelsWithExisting();

    await this.saveData(this.settings);
  }

  async countTotalTokens(): Promise<number> {
    try {
      const allContent = await getAllNotesContent(this.app.vault);
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

  getChainManagerParams(): LangChainParams {
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
      chainType: ChainType.LLM_CHAIN, // Set LLM_CHAIN as default ChainType
      options: { forceNewCreation: true } as SetChainOptions,
      openAIProxyBaseUrl: this.settings.openAIProxyBaseUrl,
      openAIEmbeddingProxyBaseUrl: this.settings.openAIEmbeddingProxyBaseUrl,
    };
  }

  getLangChainParams(): LangChainParams {
    return this.getChainManagerParams();
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
    const messages = this.parseChatContent(content);
    this.sharedState.clearChatHistory();
    messages.forEach((message) => this.sharedState.addMessage(message));

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

  parseChatContent(content: string): ChatMessage[] {
    const lines = content.split("\n");
    const messages: ChatMessage[] = [];
    let currentSender = "";
    let currentMessage = "";

    for (const line of lines) {
      if (line.startsWith("**user**:") || line.startsWith("**ai**:")) {
        if (currentSender && currentMessage) {
          messages.push({
            sender: currentSender === USER_SENDER ? USER_SENDER : AI_SENDER,
            message: currentMessage.trim(),
            isVisible: true,
          });
        }
        currentSender = line.startsWith("**user**:") ? USER_SENDER : AI_SENDER;
        currentMessage = line.substring(line.indexOf(":") + 1).trim();
      } else {
        currentMessage += "\n" + line;
      }
    }

    if (currentSender && currentMessage) {
      messages.push({
        sender: currentSender === USER_SENDER ? USER_SENDER : AI_SENDER,
        message: currentMessage.trim(),
        isVisible: true,
      });
    }

    return messages;
  }
}
