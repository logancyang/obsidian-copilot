import { CustomModel, LangChainParams, SetChainOptions } from "@/aiParams";
import ChainFactory, { ChainType, Document } from "@/chainFactory";
import { ABORT_REASON, AI_SENDER, BUILTIN_CHAT_MODELS, USER_SENDER } from "@/constants";
import EncryptionService from "@/encryptionService";
import { HybridRetriever } from "@/search/hybridRetriever";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatMessage } from "@/sharedState";
import {
  extractChatHistory,
  extractUniqueTitlesFromDocs,
  formatDateTime,
  isSupportedChain,
} from "@/utils";
import VectorDBManager, { MemoryVector, NoteFile, VectorStoreDocument } from "@/vectorDBManager";
import { RunnableSequence } from "@langchain/core/runnables";
import { BaseChatMemory } from "langchain/memory";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
} from "langchain/prompts";
import { MultiQueryRetriever } from "langchain/retrievers/multi_query";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { App, Notice } from "obsidian";
import ChatModelManager from "./chatModelManager";
import EmbeddingsManager from "./embeddingManager";
import MemoryManager from "./memoryManager";
import PromptManager from "./promptManager";

export default class ChainManager {
  private static chain: RunnableSequence;
  private static retrievalChain: RunnableSequence;
  private static retrievedDocuments: Document[] = [];

  private app: App;
  private settings: CopilotSettings;
  private vectorStore: MemoryVectorStore;
  private promptManager: PromptManager;
  private embeddingsManager: EmbeddingsManager;
  private encryptionService: EncryptionService;
  public chatModelManager: ChatModelManager;
  public langChainParams: LangChainParams;
  public memoryManager: MemoryManager;
  private getDbVectorStores: () => PouchDB.Database<VectorStoreDocument>;

  /**
   * Constructor for initializing langChainParams and instantiating singletons.
   *
   * @param {LangChainParams} langChainParams - the parameters for language chaining
   * @return {void}
   */
  constructor(
    app: App,
    langChainParams: LangChainParams,
    encryptionService: EncryptionService,
    settings: CopilotSettings,
    // Ensure ChainManager always has the up-to-date dbVectorStores
    getDbVectorStores: () => PouchDB.Database<VectorStoreDocument>
  ) {
    // Instantiate singletons
    this.app = app;
    this.langChainParams = langChainParams;
    this.settings = settings;
    this.memoryManager = MemoryManager.getInstance(this.langChainParams);
    this.encryptionService = encryptionService;
    this.chatModelManager = ChatModelManager.getInstance(
      () => this.langChainParams,
      encryptionService,
      this.settings.activeModels
    );
    this.promptManager = PromptManager.getInstance(this.langChainParams);
    this.getDbVectorStores = getDbVectorStores;
    this.createChainWithNewModel(this.langChainParams.modelKey);
  }

  private setNoteFile(noteFile: NoteFile): void {
    this.langChainParams.options.noteFile = noteFile;
  }

  private validateChainType(chainType: ChainType): void {
    if (chainType === undefined || chainType === null) throw new Error("No chain type set");
  }

  private findCustomModel(modelKey: string): CustomModel | undefined {
    const [name, provider] = modelKey.split("|");
    return this.settings.activeModels.find(
      (model) => model.name === name && model.provider === provider
    );
  }

  static storeRetrieverDocuments(documents: Document[]) {
    ChainManager.retrievedDocuments = documents;
  }

  /**
   * Update the active model and create a new chain
   * with the specified model name.
   *
   * @param {string} newModel - the name of the new model in the dropdown
   * @return {void}
   */
  createChainWithNewModel(newModelKey: string): void {
    try {
      let customModel = this.findCustomModel(newModelKey);
      if (!customModel) {
        // Reset default model if no model is found
        console.error("Resetting default model. No model configuration found for: ", newModelKey);
        customModel = BUILTIN_CHAT_MODELS[0];
        newModelKey = customModel.name + "|" + customModel.provider;
      }
      this.langChainParams.modelKey = newModelKey;
      this.chatModelManager.setChatModel(customModel);
      // Must update the chatModel for chain because ChainFactory always
      // retrieves the old chain without the chatModel change if it exists!
      // Create a new chain with the new chatModel
      this.createChain(this.langChainParams.chainType, {
        ...this.langChainParams.options,
        forceNewCreation: true,
      });
      console.log(`Setting model to ${newModelKey}`);
    } catch (error) {
      console.error("createChainWithNewModel failed: ", error);
      console.log("modelKey:", this.langChainParams.modelKey);
    }
  }

  /* Create a new chain, or update chain with new model */
  createChain(chainType: ChainType, options?: SetChainOptions): void {
    this.validateChainType(chainType);
    try {
      this.setChain(chainType, options);
    } catch (error) {
      new Notice("Error creating chain:", error);
      console.error("Error creating chain:", error);
    }
  }

  async setChain(chainType: ChainType, options: SetChainOptions = {}): Promise<void> {
    if (!this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
      // No need to throw error and trigger multiple Notices to user
      console.error("setChain failed: No chat model set.");
      return;
    }
    this.validateChainType(chainType);
    // MUST set embeddingsManager when switching to QA mode
    if (chainType === ChainType.LONG_NOTE_QA_CHAIN || chainType === ChainType.VAULT_QA_CHAIN) {
      this.embeddingsManager = EmbeddingsManager.getInstance(
        () => this.langChainParams,
        this.encryptionService,
        this.settings.activeEmbeddingModels
      );
    }

    // Get chatModel, memory, prompt, and embeddingAPI from respective managers
    const chatModel = this.chatModelManager.getChatModel();
    const memory = this.memoryManager.getMemory();
    const chatPrompt = this.promptManager.getChatPrompt();

    switch (chainType) {
      case ChainType.LLM_CHAIN: {
        // For initial load of the plugin
        if (options.forceNewCreation) {
          ChainManager.chain = ChainFactory.createNewLLMChain({
            llm: chatModel,
            memory: memory,
            prompt: options.prompt || chatPrompt,
            abortController: options.abortController,
          }) as RunnableSequence;
        } else {
          // For navigating back to the plugin view
          ChainManager.chain = ChainFactory.getLLMChainFromMap({
            llm: chatModel,
            memory: memory,
            prompt: options.prompt || chatPrompt,
            abortController: options.abortController,
          }) as RunnableSequence;
        }

        this.langChainParams.chainType = ChainType.LLM_CHAIN;
        break;
      }
      case ChainType.LONG_NOTE_QA_CHAIN: {
        if (!options.noteFile) {
          new Notice("No note content provided");
          throw new Error("No note content provided");
        }

        this.setNoteFile(options.noteFile);
        const docHash = VectorDBManager.getDocumentHash(options.noteFile.path);
        const parsedMemoryVectors: MemoryVector[] | undefined =
          await VectorDBManager.getMemoryVectors(this.getDbVectorStores(), docHash);
        const embeddingsAPI = this.embeddingsManager.getEmbeddingsAPI();
        if (!embeddingsAPI) {
          console.error("Error getting embeddings API. Please check your settings.");
          return;
        }
        if (parsedMemoryVectors) {
          // Index already exists
          const vectorStore = await VectorDBManager.rebuildMemoryVectorStore(
            parsedMemoryVectors,
            embeddingsAPI
          );

          // Create new conversational retrieval chain
          ChainManager.retrievalChain = ChainFactory.createConversationalRetrievalChain(
            {
              llm: chatModel,
              retriever: vectorStore.asRetriever(undefined, (doc) => {
                return doc.metadata.path === options.noteFile?.path;
              }),
            },
            ChainManager.storeRetrieverDocuments.bind(ChainManager),
            options.debug
          );
          console.log("Existing vector store for document hash: ", docHash);
        } else {
          // Index doesn't exist
          const vectorStoreDoc = await this.indexFile(options.noteFile);
          this.vectorStore = await VectorDBManager.getMemoryVectorStore(
            this.getDbVectorStores(),
            embeddingsAPI,
            vectorStoreDoc?._id
          );
          if (!this.vectorStore) {
            console.error("Error creating vector store.");
            return;
          }

          const retriever = MultiQueryRetriever.fromLLM({
            llm: chatModel,
            retriever: this.vectorStore.asRetriever(undefined, (doc) => {
              return doc.metadata.path === options.noteFile?.path;
            }),
            verbose: false,
          });

          ChainManager.retrievalChain = ChainFactory.createConversationalRetrievalChain(
            {
              llm: chatModel,
              retriever: retriever,
            },
            ChainManager.storeRetrieverDocuments.bind(ChainManager),
            options.debug
          );
          console.log(
            "New Long Note QA chain with multi-query retriever created for " + "document hash: ",
            docHash
          );
        }

        this.langChainParams.chainType = ChainType.LONG_NOTE_QA_CHAIN;
        console.log("Set chain:", ChainType.LONG_NOTE_QA_CHAIN);
        break;
      }

      case ChainType.VAULT_QA_CHAIN: {
        const embeddingsAPI = this.embeddingsManager.getEmbeddingsAPI();
        if (!embeddingsAPI) {
          console.error("Error getting embeddings API. Please check your settings.");
          return;
        }
        const vectorStore = await VectorDBManager.getMemoryVectorStore(
          this.getDbVectorStores(),
          embeddingsAPI
        );
        const retriever = new HybridRetriever(
          this.getDbVectorStores(),
          this.app.vault,
          {
            vectorStore: vectorStore,
            minSimilarityScore: 0.3, // TODO: Make this a setting
            maxK: this.settings.maxSourceChunks, // The maximum number of docs (chunks) to retrieve
            kIncrement: 2,
          },
          options.debug
        );

        // Create new conversational retrieval chain
        ChainManager.retrievalChain = ChainFactory.createConversationalRetrievalChain(
          {
            llm: chatModel,
            retriever: retriever,
          },
          ChainManager.storeRetrieverDocuments.bind(ChainManager),
          options.debug
        );
        console.log("New Vault QA chain with hybrid retriever created for entire vault");

        this.langChainParams.chainType = ChainType.VAULT_QA_CHAIN;
        console.log("Set chain:", ChainType.VAULT_QA_CHAIN);
        break;
      }

      default:
        this.validateChainType(chainType);
        break;
    }
  }

  async runChain(
    userMessage: string,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
    } = {}
  ) {
    const { debug = false, ignoreSystemMessage = false } = options;

    // Check if chat model is initialized
    if (!this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
      const errorMsg =
        "Chat model is not initialized properly, check your API key in Copilot setting and make sure you have API access.";
      new Notice(errorMsg);
      console.error(errorMsg);
      return;
    }
    // Check if chain is initialized properly
    if (!ChainManager.chain || !isSupportedChain(ChainManager.chain)) {
      console.error(
        "Chain is not initialized properly, re-initializing chain: ",
        this.langChainParams.chainType
      );
      this.setChain(this.langChainParams.chainType, this.langChainParams.options);
    }

    const { temperature, maxTokens, systemMessage, chatContextTurns, chainType } =
      this.langChainParams;

    const memory = this.memoryManager.getMemory();
    const chatPrompt = this.promptManager.getChatPrompt();
    const systemPrompt = ignoreSystemMessage ? "" : systemMessage;
    // Whether to ignore system prompt (for commands)
    if (ignoreSystemMessage) {
      const effectivePrompt = ignoreSystemMessage
        ? ChatPromptTemplate.fromMessages([
            new MessagesPlaceholder("history"),
            HumanMessagePromptTemplate.fromTemplate("{input}"),
          ])
        : chatPrompt;

      this.setChain(chainType, {
        ...this.langChainParams.options,
        prompt: effectivePrompt,
      });
    } else {
      this.setChain(chainType, this.langChainParams.options);
    }

    let fullAIResponse = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatModel = (ChainManager.chain as any).last.bound;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatStream = await ChainManager.chain.stream({
      input: userMessage,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    try {
      switch (chainType) {
        case ChainType.LLM_CHAIN:
          if (debug) {
            console.log(
              `*** DEBUG INFO ***\n` +
                `user message: ${userMessage}\n` +
                // ChatOpenAI has modelName, some other ChatModels like ChatOllama have model
                `model: ${chatModel.modelName || chatModel.model}\n` +
                `chain type: ${chainType}\n` +
                `temperature: ${temperature}\n` +
                `maxTokens: ${maxTokens}\n` +
                `system prompt: ${systemPrompt}\n` +
                `chat context turns: ${chatContextTurns}\n`
            );
            console.log("chain RunnableSequence:", ChainManager.chain);
            console.log("Chat memory:", memory);
          }

          for await (const chunk of chatStream) {
            if (abortController.signal.aborted) break;
            fullAIResponse += chunk.content;
            updateCurrentAiMessage(fullAIResponse);
          }
          break;
        case ChainType.LONG_NOTE_QA_CHAIN:
        case ChainType.VAULT_QA_CHAIN:
          if (debug) {
            console.log(
              `*** DEBUG INFO ***\n` +
                `user message: ${userMessage}\n` +
                `model: ${chatModel.modelName || chatModel.model}\n` +
                `chain type: ${chainType}\n` +
                `temperature: ${temperature}\n` +
                `maxTokens: ${maxTokens}\n` +
                `system prompt: ${systemPrompt}\n` +
                `chat context turns: ${chatContextTurns}\n`
            );
            console.log("chain RunnableSequence:", ChainManager.chain);
            console.log("embedding model:", this.langChainParams.embeddingModelKey);
          }
          fullAIResponse = await this.runRetrievalChain(
            userMessage,
            memory,
            updateCurrentAiMessage,
            abortController,
            { debug }
          );
          break;
        default:
          console.error("Chain type not supported:", this.langChainParams.chainType);
      }
    } catch (error) {
      const errorData = error?.response?.data?.error || error;
      const errorCode = errorData?.code || error;
      if (errorCode === "model_not_found") {
        const modelNotFoundMsg =
          "You do not have access to this model or the model does not exist, please check with your API provider.";
        new Notice(modelNotFoundMsg);
        console.error(modelNotFoundMsg);
      } else {
        new Notice(`LangChain error: ${errorCode}`);
        console.error(errorData);
      }
    } finally {
      // note: pls Check Abort Reason
      if (fullAIResponse && abortController.signal.reason !== ABORT_REASON.NEW_CHAT) {
        // This line is a must for memory to work with RunnableSequence!
        await memory.saveContext({ input: userMessage }, { output: fullAIResponse });
        addMessage({
          message: fullAIResponse,
          sender: AI_SENDER,
          isVisible: true,
          timestamp: formatDateTime(new Date()),
        });
      }
      updateCurrentAiMessage("");
    }
    return fullAIResponse;
  }

  private async runRetrievalChain(
    userMessage: string,
    memory: BaseChatMemory,
    updateCurrentAiMessage: (message: string) => void,
    abortController: AbortController,
    options: {
      debug?: boolean;
    } = {}
  ): Promise<string> {
    const memoryVariables = await memory.loadMemoryVariables({});
    const chatHistory = extractChatHistory(memoryVariables);
    const qaStream = await ChainManager.retrievalChain.stream({
      question: userMessage,
      chat_history: chatHistory,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    let fullAIResponse = "";

    for await (const chunk of qaStream) {
      if (abortController.signal.aborted) break;
      fullAIResponse += chunk.content;
      updateCurrentAiMessage(fullAIResponse);
    }

    if (options.debug) {
      console.log("Max source chunks:", this.settings.maxSourceChunks);
      console.log("Retrieved chunks:", ChainManager.retrievedDocuments);
    }

    // TODO: This only returns unique note titles, but actual retrieved docs are chunks.
    // That means multiple chunks can be from the same note. A more advanced logic is needed
    // to show specific chunks in the future. E.g. collapsed note title when clicked,
    // expand and reveal the chunk
    if (this.langChainParams.chainType === ChainType.VAULT_QA_CHAIN) {
      const docTitles = extractUniqueTitlesFromDocs(ChainManager.retrievedDocuments);
      const markdownLinks = docTitles
        .map(
          (title) =>
            `[${title}](obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(
              title
            )})`
        )
        .join("\n");
      fullAIResponse += "\n\n**Sources**:\n" + markdownLinks;
    }

    return fullAIResponse;
  }

  async indexFile(noteFile: NoteFile): Promise<VectorStoreDocument | undefined> {
    const embeddingsAPI = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingsAPI) {
      const errorMsg =
        "Failed to load file, embedding API is not set correctly, please check your settings.";
      new Notice(errorMsg);
      console.error(errorMsg);
      return;
    }
    return await VectorDBManager.indexFile(this.getDbVectorStores(), embeddingsAPI, noteFile);
  }

  async updateMemoryWithLoadedMessages(messages: ChatMessage[]) {
    await this.memoryManager.clearChatMemory();
    for (let i = 0; i < messages.length; i += 2) {
      const userMsg = messages[i];
      const aiMsg = messages[i + 1];
      if (userMsg && aiMsg && userMsg.sender === USER_SENDER) {
        await this.memoryManager
          .getMemory()
          .saveContext({ input: userMsg.message }, { output: aiMsg.message });
      }
    }
  }
}
