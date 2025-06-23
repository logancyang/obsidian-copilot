import {
  getChainType,
  getCurrentProject,
  getModelKey,
  SetChainOptions,
  setChainType,
} from "@/aiParams";
import ChainFactory, { ChainType, Document } from "@/chainFactory";
import { BUILTIN_CHAT_MODELS, USER_SENDER } from "@/constants";
import {
  ChainRunner,
  CopilotPlusChainRunner,
  LLMChainRunner,
  ProjectChainRunner,
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
  // TODO: These chains are deprecated since we now use direct chat model calls in chain runners
  // Consider removing after verifying no dependencies remain
  private chain: RunnableSequence;
  private retrievalChain: RunnableSequence;
  private retrievedDocuments: Document[] = [];

  public getRetrievedDocuments(): Document[] {
    return this.retrievedDocuments;
  }

  public app: App;
  public vectorStoreManager: VectorStoreManager;
  public chatModelManager: ChatModelManager;
  public memoryManager: MemoryManager;
  public promptManager: PromptManager;

  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  private chatMessages: ChatMessage[] = [];

  constructor(app: App, vectorStoreManager: VectorStoreManager) {
    this.chatMessages = [];

    // Instantiate singletons
    this.app = app;
    this.vectorStoreManager = vectorStoreManager;
    this.memoryManager = MemoryManager.getInstance();
    this.chatModelManager = ChatModelManager.getInstance();
    this.promptManager = PromptManager.getInstance();

    // Initialize async operations
    this.initialize();

    subscribeToSettingsChange(async () => {
      await this.createChainWithNewModel();
    });
  }

  private async initialize() {
    await this.createChainWithNewModel();
  }

  // TODO: These methods are deprecated - chain runners now use direct chat model calls
  // Remove after confirming no usage remains
  public getChain(): RunnableSequence {
    return this.chain;
  }

  public getRetrievalChain(): RunnableSequence {
    return this.retrievalChain;
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

  // TODO: This method is deprecated - chain validation no longer needed
  // Remove after confirming no dependencies
  private validateChainInitialization() {
    if (!this.chain || !isSupportedChain(this.chain)) {
      console.error("Chain is not initialized properly, re-initializing chain: ", getChainType());
      this.createChainWithNewModel({}, false);
      // this.setChain(getChainType());
    }
  }

  public storeRetrieverDocuments(documents: Document[]) {
    this.retrievedDocuments = documents;
  }

  /**
   * Update the active model and create a new chain with the specified model
   * name.
   */
  async createChainWithNewModel(
    options: SetChainOptions = {},
    neededReInitChatMode: boolean = true
  ): Promise<void> {
    const chainType = getChainType();
    const currentProject = getCurrentProject();

    if (chainType === ChainType.PROJECT_CHAIN && !currentProject) {
      return;
    }

    let newModelKey =
      chainType === ChainType.PROJECT_CHAIN ? currentProject?.projectModelKey : getModelKey();

    if (!newModelKey) {
      new Notice("No model key found");
      throw new Error("No model key found");
    }

    try {
      if (neededReInitChatMode) {
        let customModel = findCustomModel(newModelKey, getSettings().activeModels);
        if (!customModel) {
          // Reset default model if no model is found
          console.error("Resetting default model. No model configuration found for: ", newModelKey);
          customModel = BUILTIN_CHAT_MODELS[0];
          newModelKey = customModel.name + "|" + customModel.provider;
        }

        // Add validation for project mode
        if (chainType === ChainType.PROJECT_CHAIN && !customModel.projectEnabled) {
          // If the model is not project-enabled, find the first project-enabled model
          const projectEnabledModel = getSettings().activeModels.find(
            (m) => m.enabled && m.projectEnabled
          );
          if (projectEnabledModel) {
            customModel = projectEnabledModel;
            newModelKey = projectEnabledModel.name + "|" + projectEnabledModel.provider;
            new Notice(
              `Model ${customModel.name} is not available in project mode. Switching to ${projectEnabledModel.name}.`
            );
          } else {
            throw new Error(
              "No project-enabled models available. Please enable a model for project mode in settings."
            );
          }
        }

        const mergedModel = {
          ...customModel,
          ...currentProject?.modelConfigs,
        };
        await this.chatModelManager.setChatModel(mergedModel);
      }

      // Must update the chatModel for chain because ChainFactory always
      // retrieves the old chain without the chatModel change if it exists!
      // Create a new chain with the new chatModel
      this.setChain(chainType, options);
      logInfo(`Setting model to ${newModelKey}`);
    } catch (error) {
      logError(`createChainWithNewModel failed: ${error}`);
      logInfo(`modelKey: ${newModelKey}`);
    }
  }

  // TODO: This method is deprecated - chain runners now handle chain logic directly
  // Remove after confirming no usage remains
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
        // TODO: LLMChainRunner now handles this directly without chains
        this.chain = ChainFactory.createNewLLMChain({
          llm: chatModel,
          memory: memory,
          prompt: options.prompt || chatPrompt,
          abortController: options.abortController,
        }) as RunnableSequence;

        setChainType(ChainType.LLM_CHAIN);
        break;
      }

      case ChainType.VAULT_QA_CHAIN: {
        // TODO: VaultQAChainRunner now handles this directly without chains
        await this.initializeQAChain(options);

        const retriever = new HybridRetriever({
          minSimilarityScore: 0.01,
          maxK: getSettings().maxSourceChunks,
          salientTerms: [],
        });

        // Create new conversational retrieval chain
        this.retrievalChain = ChainFactory.createConversationalRetrievalChain(
          {
            llm: chatModel,
            retriever: retriever,
            systemMessage: getSystemPrompt(),
          },
          this.storeRetrieverDocuments.bind(this),
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
        this.chain = ChainFactory.createNewLLMChain({
          llm: chatModel,
          memory: memory,
          prompt: options.prompt || chatPrompt,
          abortController: options.abortController,
        }) as RunnableSequence;

        setChainType(ChainType.COPILOT_PLUS_CHAIN);
        break;
      }

      case ChainType.PROJECT_CHAIN: {
        // For initial load of the plugin
        await this.initializeQAChain(options);
        this.chain = ChainFactory.createNewLLMChain({
          llm: chatModel,
          memory: memory,
          prompt: options.prompt || chatPrompt,
          abortController: options.abortController,
        }) as RunnableSequence;
        setChainType(ChainType.PROJECT_CHAIN);
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
      case ChainType.PROJECT_CHAIN:
        return new ProjectChainRunner(this);
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

      this.createChainWithNewModel({ prompt: effectivePrompt }, false);
      /*this.setChain(getChainType(), {
        prompt: effectivePrompt,
      });*/
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

  public clearHistory() {
    this.chatMessages = [];
  }

  public getChatMessages(): ChatMessage[] {
    return this.chatMessages;
  }

  public setChatMessages(messages: ChatMessage[]) {
    this.chatMessages = [...messages];
  }

  public addChatMessage(message: ChatMessage) {
    this.chatMessages.push(message);
  }
}
