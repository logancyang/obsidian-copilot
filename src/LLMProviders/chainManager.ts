import {
  getChainType,
  getModelKey,
  SetChainOptions,
  setChainType,
  subscribeToChainTypeChange,
  subscribeToModelKeyChange,
} from "@/aiParams";
import ChainFactory, { ChainType, Document } from "@/chainFactory";
import {
  AI_SENDER,
  BUILTIN_CHAT_MODELS,
  ChatModelProviders,
  USER_SENDER,
  VAULT_VECTOR_STORE_STRATEGY,
} from "@/constants";
import {
  ChainRunner,
  CopilotPlusChainRunner,
  LLMChainRunner,
  VaultQAChainRunner,
} from "@/LLMProviders/chainRunner";
import { HybridRetriever } from "@/search/hybridRetriever";
import VectorStoreManager from "@/search/vectorStoreManager";
import {
  getSettings,
  getSystemPrompt,
  subscribeToSettingsChange,
} from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { findCustomModel, isSupportedChain } from "@/utils";
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
import { ChatOpenAI } from "@langchain/openai";
import { Embeddings } from "@langchain/core/embeddings";

export default class ChainManager {
  private static chain: RunnableSequence;
  private static retrievalChain: RunnableSequence;

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
    vectorStoreManager: VectorStoreManager,
    brevilabsClient: BrevilabsClient
  ) {
    // Instantiate singletons
    this.app = app;
    this.vectorStoreManager = vectorStoreManager;
    this.memoryManager = MemoryManager.getInstance();
    this.chatModelManager = ChatModelManager.getInstance();
    this.embeddingsManager = EmbeddingsManager.getInstance();
    this.promptManager = PromptManager.getInstance();
    this.brevilabsClient = brevilabsClient;
    this.createChainWithNewModel();
    subscribeToModelKeyChange(() => this.createChainWithNewModel());
    subscribeToChainTypeChange(() =>
      this.setChain(getChainType(), {
        refreshIndex:
          getSettings().indexVaultToVectorStore ===
            VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH &&
          (getChainType() === ChainType.VAULT_QA_CHAIN ||
            getChainType() === ChainType.COPILOT_PLUS_CHAIN),
      })
    );
    subscribeToSettingsChange(() => this.createChainWithNewModel());
  }

  static getChain(): RunnableSequence {
    return ChainManager.chain;
  }

  static getRetrievalChain(): RunnableSequence {
    return ChainManager.retrievalChain;
  }

  private validateChainType(chainType: ChainType): void {
    if (chainType === undefined || chainType === null)
      throw new Error("No chain type set");
  }

  private validateChatModel() {
    if (
      !this.chatModelManager.validateChatModel(
        this.chatModelManager.getChatModel()
      )
    ) {
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
        getChainType()
      );
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
  createChainWithNewModel(): void {
    let newModelKey = getModelKey();
    try {
      let customModel = findCustomModel(
        newModelKey,
        getSettings().activeModels
      );
      if (!customModel) {
        // Reset default model if no model is found
        console.error(
          "Resetting default model. No model configuration found for: ",
          newModelKey
        );
        customModel = BUILTIN_CHAT_MODELS[0];
        newModelKey = customModel.name + "|" + customModel.provider;
      }

      if (customModel.provider === ChatModelProviders.AZURE_OPENAI) {
        const settings = getSettings();
        let deploymentName = "";
        if (newModelKey.startsWith("o1-preview")) {
          deploymentName = newModelKey.split("|")[1] || "";
        }

        const deployment = settings.azureOpenAIApiDeployments?.find(
          (d) => d.deploymentName === deploymentName
        );

        if (deployment) {
          customModel = {
            ...customModel,
            provider: ChatModelProviders.AZURE_OPENAI,
          };
        }
      }

      this.chatModelManager.setChatModel(customModel);
      // Must update the chatModel for chain because ChainFactory always
      // retrieves the old chain without the chatModel change if it exists!
      // Create a new chain with the new chatModel
      this.setChain(getChainType());
      console.log(`Setting model to ${newModelKey}`);
    } catch (error) {
      console.error("createChainWithNewModel failed: ", error);
      console.log("modelKey:", newModelKey);
    }
  }

  async setChain(
    chainType: ChainType,
    options: SetChainOptions = {}
  ): Promise<void> {
    if (
      !this.chatModelManager.validateChatModel(
        this.chatModelManager.getChatModel()
      )
    ) {
      console.error("setChain failed: No chat model set.");
      return;
    }

    this.validateChainType(chainType);

    // Get chatModel, memory, prompt, and embeddingAPI from respective managers
    const chatModel = this.chatModelManager.getChatModel();
    const memory = this.memoryManager.getMemory();
    const chatPrompt = this.promptManager.getChatPrompt();

    // Check if the model is an Azure OpenAI model
    if (
      chatModel instanceof ChatOpenAI &&
      chatModel.provider === ChatModelProviders.AZURE_OPENAI
    ) {
      const modelKey = getModelKey();
      let deploymentName = "";
      if (modelKey.startsWith("o1-preview")) {
        deploymentName = modelKey.split("|")[1] || "";
      }

      const deployment = getSettings().azureOpenAIApiDeployments?.find(
        (d) => d.deploymentName === deploymentName
      );

      if (deployment) {
        // Update the chatModel with the correct deployment settings
        chatModel.azureOpenAIApiDeploymentName = deployment.deploymentName;
        chatModel.azureOpenAIApiInstanceName = deployment.instanceName;
        chatModel.azureOpenAIApiKey = deployment.apiKey;
        chatModel.azureOpenAIApiVersion = deployment.apiVersion;
      }
    }

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
        const { embeddingsAPI } = await this.initializeQAChain(options);

        const retriever = new HybridRetriever(
          this.vectorStoreManager.dbOps,
          this.app.vault,
          chatModel,
          embeddingsAPI,
          this.brevilabsClient,
          {
            minSimilarityScore: 0.01,
            maxK: getSettings().maxSourceChunks,
            salientTerms: [],
          },
          getSettings().debug
        );

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
          console.log(
            "New Vault QA chain with hybrid retriever created for entire vault"
          );
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
    const embeddingsAPI = this.embeddingsManager.getEmbeddingsAPI();
    if (!embeddingsAPI) {
      throw new Error(
        "Error getting embeddings API. Please check your settings."
      );
    }

    const modelKey = getModelKey();
    if (modelKey.startsWith("o1-preview")) {
      const settings = getSettings();
      const deploymentName = modelKey.split("|")[1] || "";
      const deployment = settings.azureOpenAIApiDeployments?.find(
        (d) => d.deploymentName === deploymentName
      );

      if (deployment) {
        const embeddingsModel = {
          ...embeddingsAPI,
          modelName: deployment.deploymentName,
          provider: ChatModelProviders.AZURE_OPENAI,
          azureOpenAIApiKey: deployment.apiKey,
          azureOpenAIApiInstanceName: deployment.instanceName,
          azureOpenAIApiDeploymentName: deployment.deploymentName,
          azureOpenAIApiVersion: deployment.apiVersion,
        } as unknown as Embeddings;

        const db = await this.vectorStoreManager.getOrInitializeDb(
          embeddingsModel
        );

        // Handle index refresh if needed
        if (options.refreshIndex) {
          await this.vectorStoreManager.indexVaultToVectorStore();
        }

        return { embeddingsAPI: embeddingsModel, db };
      } else {
        throw new Error("Deployment not found for o1-preview model.");
      }
    }

    const db = await this.vectorStoreManager.getOrInitializeDb(embeddingsAPI);

    // Handle index refresh if needed
    if (options.refreshIndex) {
      await this.vectorStoreManager.indexVaultToVectorStore();
    }

    return { embeddingsAPI, db };
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

    if (debug)
      console.log("==== Step 0: Initial user message ====\n", userMessage);

    this.validateChatModel();
    this.validateChainInitialization();

    const chatModel = this.chatModelManager.getChatModel();
    const modelName =
      (chatModel as any).modelName || (chatModel as any).model || "";
    const isO1Model = modelName.startsWith("o1");

    // Handle ignoreSystemMessage
    if (ignoreSystemMessage || isO1Model) {
      let effectivePrompt = ChatPromptTemplate.fromMessages([
        new MessagesPlaceholder("history"),
        HumanMessagePromptTemplate.fromTemplate("{input}"),
      ]);

      // TODO: hack for o1 models, to be removed when they support system prompt
      if (isO1Model) {
        //  Temporary fix：for o1-xx model need to covert systemMessage to aiMessage
        effectivePrompt = ChatPromptTemplate.fromMessages([
          [AI_SENDER, getSystemPrompt() || ""],
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
