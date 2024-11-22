import { CustomModel, LangChainParams, SetChainOptions } from "@/aiParams";
import ChainFactory, { ChainType, Document } from "@/chainFactory";
import { BUILTIN_CHAT_MODELS, USER_SENDER } from "@/constants";
import EncryptionService from "@/encryptionService";
import {
  ChainRunner,
  CopilotPlusChainRunner,
  LLMChainRunner,
  VaultQAChainRunner,
} from "@/LLMProviders/chainRunner";
import { HybridRetriever } from "@/search/hybridRetriever";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatMessage } from "@/sharedState";
import { isSupportedChain } from "@/utils";
import VectorStoreManager from "@/VectorStoreManager";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { App, Notice } from "obsidian";
import { BrevilabsClient } from "./brevilabsClient";
import ChatModelManager from "./chatModelManager";
import EmbeddingsManager from "./embeddingManager";
import MemoryManager from "./memoryManager";
import PromptManager from "./promptManager";

export default class ChainManager {
  private static chain: RunnableSequence;
  private static retrievalChain: RunnableSequence;

  private settings: CopilotSettings;
  private encryptionService: EncryptionService;
  private langChainParams: LangChainParams;

  public app: App;
  public vectorStoreManager: VectorStoreManager;
  public chatModelManager: ChatModelManager;
  public memoryManager: MemoryManager;
  public embeddingsManager: EmbeddingsManager;
  public promptManager: PromptManager;
  public brevilabsClient: BrevilabsClient;
  public static retrievedDocuments: Document[] = [];

  constructor(
    app: App,
    getLangChainParams: () => LangChainParams,
    encryptionService: EncryptionService,
    settings: CopilotSettings,
    vectorStoreManager: VectorStoreManager,
    brevilabsClient: BrevilabsClient
  ) {
    // Instantiate singletons
    this.app = app;
    this.langChainParams = getLangChainParams();
    this.settings = settings;
    this.vectorStoreManager = vectorStoreManager;
    this.memoryManager = MemoryManager.getInstance(this.getLangChainParams(), settings.debug);
    this.encryptionService = encryptionService;
    this.chatModelManager = ChatModelManager.getInstance(
      () => this.getLangChainParams(),
      encryptionService,
      this.settings.activeModels
    );
    this.embeddingsManager = this.vectorStoreManager.getEmbeddingsManager();
    this.promptManager = PromptManager.getInstance(this.getLangChainParams());
    this.brevilabsClient = brevilabsClient;
    this.createChainWithNewModel(this.getLangChainParams().modelKey);
  }

  public getLangChainParams(): LangChainParams {
    return this.langChainParams;
  }

  public setLangChainParam<K extends keyof LangChainParams>(
    key: K,
    value: LangChainParams[K]
  ): void {
    this.langChainParams[key] = value;
  }

  static getChain(): RunnableSequence {
    return ChainManager.chain;
  }

  static getRetrievalChain(): RunnableSequence {
    return ChainManager.retrievalChain;
  }

  private validateChainType(chainType: ChainType): void {
    if (chainType === undefined || chainType === null) throw new Error("No chain type set");
  }

  private validateChatModel() {
    if (!this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
      const errorMsg =
        "Chat model is not initialized properly, check your API key in Copilot setting and make sure you have API access.";
      new Notice(errorMsg);
      throw new Error(errorMsg);
    }
  }

  private validateChainInitialization() {
    if (!ChainManager.chain || !isSupportedChain(ChainManager.chain)) {
      console.error(
        "Chain is not initialized properly, re-initializing chain: ",
        this.getLangChainParams().chainType
      );
      this.setChain(this.getLangChainParams().chainType, this.getLangChainParams().options);
    }
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
      this.setLangChainParam("modelKey", newModelKey);
      this.chatModelManager.setChatModel(customModel);
      // Must update the chatModel for chain because ChainFactory always
      // retrieves the old chain without the chatModel change if it exists!
      // Create a new chain with the new chatModel
      this.createChain(this.getLangChainParams().chainType, {
        ...this.getLangChainParams().options,
        forceNewCreation: true,
      });
      console.log(`Setting model to ${newModelKey}`);
    } catch (error) {
      console.error("createChainWithNewModel failed: ", error);
      console.log("modelKey:", this.getLangChainParams().modelKey);
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
    if (chainType === ChainType.VAULT_QA_CHAIN) {
      this.embeddingsManager = EmbeddingsManager.getInstance(
        () => this.getLangChainParams(),
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

        this.setLangChainParam("chainType", ChainType.LLM_CHAIN);
        break;
      }

      case ChainType.VAULT_QA_CHAIN: {
        const embeddingsAPI = this.embeddingsManager.getEmbeddingsAPI();
        if (!embeddingsAPI) {
          console.error("Error getting embeddings API. Please check your settings.");
          return;
        }

        const db = this.vectorStoreManager.getDb();
        if (!db) {
          console.error("Copilot index is not loaded. Please check your settings.");
          return;
        }

        const retriever = new HybridRetriever(
          db,
          this.app.vault,
          chatModel,
          embeddingsAPI,
          this.brevilabsClient,
          {
            minSimilarityScore: 0.01,
            maxK: this.settings.maxSourceChunks,
            salientTerms: [],
          },
          options.debug
        );

        // Create new conversational retrieval chain
        ChainManager.retrievalChain = ChainFactory.createConversationalRetrievalChain(
          {
            llm: chatModel,
            retriever: retriever,
            systemMessage: this.getLangChainParams().systemMessage,
          },
          ChainManager.storeRetrieverDocuments.bind(ChainManager),
          options.debug
        );

        this.setLangChainParam("chainType", ChainType.VAULT_QA_CHAIN);
        if (options.debug) {
          console.log("New Vault QA chain with hybrid retriever created for entire vault");
          console.log("Set chain:", ChainType.VAULT_QA_CHAIN);
        }
        break;
      }

      case ChainType.COPILOT_PLUS_CHAIN: {
        // TODO: Create new copilotPlusChain with retriever
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

        this.setLangChainParam("chainType", ChainType.COPILOT_PLUS_CHAIN);
        break;
      }

      default:
        this.validateChainType(chainType);
        break;
    }
  }

  private getChainRunner(): ChainRunner {
    switch (this.getLangChainParams().chainType) {
      case ChainType.LLM_CHAIN:
        return new LLMChainRunner(this);
      case ChainType.VAULT_QA_CHAIN:
        return new VaultQAChainRunner(this);
      case ChainType.COPILOT_PLUS_CHAIN:
        return new CopilotPlusChainRunner(this);
      default:
        throw new Error(`Unsupported chain type: ${this.getLangChainParams().chainType}`);
    }
  }

  async runChain(
    userMessage: ChatMessage,
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

    if (debug) console.log("==== Step 0: Initial user message ====\n", userMessage);

    this.validateChatModel();
    this.validateChainInitialization();

    // Handle ignoreSystemMessage
    if (ignoreSystemMessage) {
      const effectivePrompt = ChatPromptTemplate.fromMessages([
        new MessagesPlaceholder("history"),
        HumanMessagePromptTemplate.fromTemplate("{input}"),
      ]);
      this.setChain(this.getLangChainParams().chainType, {
        ...this.getLangChainParams().options,
        prompt: effectivePrompt,
      });
    }

    const chainRunner = this.getChainRunner();
    return await chainRunner.run(
      userMessage,
      abortController,
      updateCurrentAiMessage,
      addMessage,
      options
    );
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
