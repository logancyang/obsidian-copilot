import ChainManager from "@/LLMProviders/chainManager";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { LangChainParams, SetChainOptions } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { registerBuiltInCommands } from "@/commands";
import { AddPromptModal } from "@/components/AddPromptModal";
import { AdhocPromptModal } from "@/components/AdhocPromptModal";
import { ChatNoteContextModal } from "@/components/ChatNoteContextModal";
import CopilotView from "@/components/CopilotView";
import { ListPromptModal } from "@/components/ListPromptModal";
import { QAExclusionModal } from "@/components/QAExclusionModal";
import {
  CHAT_VIEWTYPE,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  VAULT_VECTOR_STORE_STRATEGY,
} from "@/constants";
import { CustomPrompt } from "@/customPromptProcessor";
import EncryptionService from "@/encryptionService";
import { CopilotSettingTab, CopilotSettings } from "@/settings/SettingsPage";
import SharedState from "@/sharedState";
import {
  areEmbeddingModelsSame,
  getAllNotesContent,
  isPathInList,
  sanitizeSettings,
} from "@/utils";
import VectorDBManager, { VectorStoreDocument } from "@/vectorDBManager";
import { MD5 } from "crypto-js";
import { Editor, MarkdownView, Menu, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import PouchDB from "pouchdb";

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

    this.embeddingsManager = EmbeddingsManager.getInstance(langChainParams, this.encryptionService);
    this.dbPrompts = new PouchDB<CustomPrompt>("copilot_custom_prompts");

    this.registerView(CHAT_VIEWTYPE, (leaf: WorkspaceLeaf) => new CopilotView(leaf, this));

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

    this.addCommand({
      id: "add-custom-prompt",
      name: "Add custom prompt",
      callback: () => {
        new AddPromptModal(this.app, async (title: string, prompt: string) => {
          try {
            // Save the prompt to the database
            await this.dbPrompts.put({ _id: title, prompt: prompt });
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
      callback: () => {
        this.fetchPromptTitles().then((promptTitles: string[]) => {
          new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
            if (!promptTitle) {
              new Notice("Please select a prompt title.");
              return;
            }
            try {
              const doc = (await this.dbPrompts.get(promptTitle)) as CustomPrompt;
              if (!doc.prompt) {
                new Notice(`No prompt found with the title "${promptTitle}".`);
                return;
              }
              this.processCustomPrompt("applyCustomPrompt", doc.prompt);
            } catch (err) {
              if (err.name === "not_found") {
                new Notice(`No prompt found with the title "${promptTitle}".`);
              } else {
                console.error(err);
                new Notice("An error occurred.");
              }
            }
          }).open();
        });
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

        this.fetchPromptTitles().then((promptTitles: string[]) => {
          new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
            if (!promptTitle) {
              new Notice("Please select a prompt title.");
              return;
            }

            try {
              const doc = await this.dbPrompts.get(promptTitle);
              if (doc._rev) {
                await this.dbPrompts.remove(doc as PouchDB.Core.RemoveDocument);
                new Notice(`Prompt "${promptTitle}" has been deleted.`);
              } else {
                new Notice(`Failed to delete prompt "${promptTitle}": No revision found.`);
              }
            } catch (err) {
              if (err.name === "not_found") {
                new Notice(`No prompt found with the title "${promptTitle}".`);
              } else {
                console.error(err);
                new Notice("An error occurred while deleting the prompt.");
              }
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

        this.fetchPromptTitles().then((promptTitles: string[]) => {
          new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
            if (!promptTitle) {
              new Notice("Please select a prompt title.");
              return;
            }

            try {
              const doc = (await this.dbPrompts.get(promptTitle)) as CustomPrompt;
              if (doc.prompt) {
                new AddPromptModal(
                  this.app,
                  (title: string, newPrompt: string) => {
                    this.dbPrompts.put({
                      ...doc,
                      prompt: newPrompt,
                    });
                    new Notice(`Prompt "${title}" has been updated.`);
                  },
                  doc._id,
                  doc.prompt,
                  true
                ).open();
              } else {
                new Notice(`No prompt found with the title "${promptTitle}".`);
              }
            } catch (err) {
              if (err.name === "not_found") {
                new Notice(`No prompt found with the title "${promptTitle}".`);
              } else {
                console.error(err);
                new Notice("An error occurred.");
              }
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

    this.registerEvent(this.app.workspace.on("editor-menu", this.handleContextMenu));
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

  async activateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    this.activateViewPromise = this.app.workspace.getRightLeaf(false).setViewState({
      type: CHAT_VIEWTYPE,
      active: true,
    });
    await this.activateViewPromise;
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]);
    this.chatIsVisible = true;
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    this.chatIsVisible = false;
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
    this.chatIsVisible = true;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    if (this.settings.enableEncryption) {
      // Encrypt all API keys before saving
      this.encryptionService.encryptAllKeys();
    }
    await this.saveData(this.settings);
  }

  async fetchPromptTitles(): Promise<string[]> {
    const response = await this.dbPrompts.allDocs({ include_docs: true });
    return response.rows.map((row) => (row.doc as CustomPrompt)?._id).filter(Boolean) as string[];
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
      openAICustomModel,
      huggingfaceApiKey,
      cohereApiKey,
      anthropicApiKey,
      anthropicModel,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      googleApiKey,
      googleCustomModel,
      openRouterAiApiKey,
      openRouterModel,
      embeddingModel,
      temperature,
      maxTokens,
      contextTurns,
      ollamaModel,
      ollamaBaseUrl,
      lmStudioBaseUrl,
      groqApiKey,
      groqModel,
    } = sanitizeSettings(this.settings);
    return {
      openAIApiKey,
      openAIOrgId,
      openAICustomModel,
      huggingfaceApiKey,
      cohereApiKey,
      anthropicApiKey,
      anthropicModel: anthropicModel || DEFAULT_SETTINGS.anthropicModel,
      groqApiKey,
      groqModel,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      googleApiKey,
      googleCustomModel,
      openRouterAiApiKey,
      openRouterModel: openRouterModel || DEFAULT_SETTINGS.openRouterModel,
      ollamaModel: ollamaModel || DEFAULT_SETTINGS.ollamaModel,
      ollamaBaseUrl: ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl,
      lmStudioBaseUrl: lmStudioBaseUrl || DEFAULT_SETTINGS.lmStudioBaseUrl,
      model: this.settings.defaultModel,
      modelDisplayName: this.settings.defaultModelDisplayName,
      embeddingModel: embeddingModel || DEFAULT_SETTINGS.embeddingModel,
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      systemMessage: this.settings.userSystemPrompt || DEFAULT_SYSTEM_PROMPT,
      chatContextTurns: Number(contextTurns),
      chainType: ChainType.LLM_CHAIN, // Set LLM_CHAIN as default ChainType
      options: { forceNewCreation: true } as SetChainOptions,
      openAIProxyBaseUrl: this.settings.openAIProxyBaseUrl,
      useOpenAILocalProxy: this.settings.useOpenAILocalProxy,
      openAIProxyModelName: this.settings.openAIProxyModelName,
      openAIEmbeddingProxyBaseUrl: this.settings.openAIEmbeddingProxyBaseUrl,
      openAIEmbeddingProxyModelName: this.settings.openAIEmbeddingProxyModelName,
    };
  }
}
