import {
  getChainType,
  getModelKey,
  SetChainOptions,
  setChainType,
  subscribeToChainTypeChange,
  subscribeToModelKeyChange,
} from "@/aiParams";
import ChainFactory, { ChainType, Document } from "@/chainFactory";
import { BUILTIN_CHAT_MODELS, USER_SENDER, VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import {
  ChainRunner,
  CopilotPlusChainRunner,
  LLMChainRunner,
  VaultQAChainRunner,
} from "@/LLMProviders/chainRunner";
import { logError, logInfo } from "@/logger";
import { HybridRetriever } from "@/search/hybridRetriever";
import VectorStoreManager from "@/search/vectorStoreManager";
import { getSettings, getSystemPrompt, subscribeToSettingsChange } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { findCustomModel, isOSeriesModel, isSupportedChain } from "@/utils";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { App, Notice } from "obsidian";
import ChatModelManager from "./chatModelManager";
import MemoryManager from "./memoryManager";
import PromptManager from "./promptManager";

export default class ChainManager {
  private static chain: RunnableSequence;
  private static retrievalChain: RunnableSequence;

  public app: App;
  public vectorStoreManager: VectorStoreManager;
  public chatModelManager: ChatModelManager;
  public memoryManager: MemoryManager;
  public promptManager: PromptManager;
  public static retrievedDocuments: Document[] = [];

  constructor(app: App, vectorStoreManager: VectorStoreManager) {
    // Instantiate singletons
    this.app = app;
    this.vectorStoreManager = vectorStoreManager;
    this.memoryManager = MemoryManager.getInstance();
    this.chatModelManager = ChatModelManager.getInstance();
    this.promptManager = PromptManager.getInstance();

    // Initialize async operations
    this.initialize();

    // Set up subscriptions
    subscribeToModelKeyChange(async () => await this.createChainWithNewModel());
    subscribeToChainTypeChange(() =>
      this.setChain(getChainType(), {
        refreshIndex:
          getSettings().indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH &&
          (getChainType() === ChainType.VAULT_QA_CHAIN ||
            getChainType() === ChainType.COPILOT_PLUS_CHAIN),
      })
    );
    subscribeToSettingsChange(async () => await this.createChainWithNewModel());
  }

  private async initialize() {
    await this.createChainWithNewModel();
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
      console.error("Chain is not initialized properly, re-initializing chain: ", getChainType());
      this.setChain(getChainType());
    }
  }

  static storeRetrieverDocuments(documents: Document[]) {
    ChainManager.retrievedDocuments = documents;
  }

  /**
   * Update the active model and create a new chain with the specified model
   * name.
   */
  async createChainWithNewModel(): Promise<void> {
    let newModelKey = getModelKey();
    try {
      let customModel = findCustomModel(newModelKey, getSettings().activeModels);
      if (!customModel) {
        // Reset default model if no model is found
        console.error("Resetting default model. No model configuration found for: ", newModelKey);
        customModel = BUILTIN_CHAT_MODELS[0];
        newModelKey = customModel.name + "|" + customModel.provider;
      }
      await this.chatModelManager.setChatModel(customModel);
      // Must update the chatModel for chain because ChainFactory always
      // retrieves the old chain without the chatModel change if it exists!
      // Create a new chain with the new chatModel
      this.setChain(getChainType());
      logInfo(`Setting model to ${newModelKey}`);
    } catch (error) {
      logError(`createChainWithNewModel failed: ${error}`);
      logInfo(`modelKey: ${newModelKey}`);
    }
  }

  async setChain(chainType: ChainType, options: SetChainOptions = {}): Promise<void> {
    if (!this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
      console.error("setChain failed: No chat model set.");
      return;
    }

    this.validateChainType(chainType);

    // Get chatModel, memory, prompt, and embeddingAPI from respective managers
    const chatModel = this.chatModelManager.getChatModel();
    const memory = this.memoryManager.getMemory();
    const chatPrompt = this.promptManager.getChatPrompt();

    switch (chainType) {
      case ChainType.LLM_CHAIN: {
        ChainManager.chain = ChainFactory.createNewLLMChain({
          llm: chatModel,
          memory: memory,
          prompt: options.prompt || chatPrompt,
          abortController: options.abortController,
        }) as RunnableSequence;

        setChainType(ChainType.LLM_CHAIN);
        break;
      }

      case ChainType.VAULT_QA_CHAIN: {
        await this.initializeQAChain(options);

        const retriever = new HybridRetriever({
          minSimilarityScore: 0.01,
          maxK: getSettings().maxSourceChunks,
          salientTerms: [],
        });

        // Create new conversational retrieval chain
        ChainManager.retrievalChain = ChainFactory.createConversationalRetrievalChain(
          {
            llm: chatModel,
            retriever: retriever,
            systemMessage: getSystemPrompt(),
          },
          ChainManager.storeRetrieverDocuments.bind(ChainManager),
          getSettings().debug
        );

        setChainType(ChainType.VAULT_QA_CHAIN);
        if (getSettings().debug) {
          console.log("New Vault QA chain with hybrid retriever created for entire vault");
          console.log("Set chain:", ChainType.VAULT_QA_CHAIN);
        }
        break;
      }

      case ChainType.COPILOT_PLUS_CHAIN: {
        // For initial load of the plugin
        await this.initializeQAChain(options);
        ChainManager.chain = ChainFactory.createNewLLMChain({
          llm: chatModel,
          memory: memory,
          prompt: options.prompt || chatPrompt,
          abortController: options.abortController,
        }) as RunnableSequence;

        setChainType(ChainType.COPILOT_PLUS_CHAIN);
        break;
      }

      default:
        this.validateChainType(chainType);
        break;
    }
  }

  private getChainRunner(): ChainRunner {
    const chainType = getChainType();
    switch (chainType) {
      case ChainType.LLM_CHAIN:
        return new LLMChainRunner(this);
      case ChainType.VAULT_QA_CHAIN:
        return new VaultQAChainRunner(this);
      case ChainType.COPILOT_PLUS_CHAIN:
        return new CopilotPlusChainRunner(this);
      default:
        throw new Error(`Unsupported chain type: ${chainType}`);
    }
  }

  private async initializeQAChain(options: SetChainOptions) {
    // Handle index refresh if needed
    if (options.refreshIndex) {
      await this.vectorStoreManager.indexVaultToVectorStore();
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

    const chatModel = this.chatModelManager.getChatModel();

    // Handle ignoreSystemMessage
    if (ignoreSystemMessage || isOSeriesModel(chatModel)) {
      let effectivePrompt = ChatPromptTemplate.fromMessages([
        new MessagesPlaceholder("history"),
        HumanMessagePromptTemplate.fromTemplate("{input}"),
      ]);

      // TODO: hack for o-series models, to be removed when langchainjs supports system prompt
      // https://github.com/langchain-ai/langchain/issues/28895
      if (isOSeriesModel(chatModel)) {
        effectivePrompt = ChatPromptTemplate.fromMessages([
          [USER_SENDER, getSystemPrompt() || ""],
          effectivePrompt,
        ]);
      }

      this.setChain(getChainType(), {
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
