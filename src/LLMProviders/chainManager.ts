import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { CustomModel, SetChainOptions, setChainType } from "@/aiParams";
import ChainFactory, { ChainType, Document } from "@/chainFactory";
import { AI_SENDER, BUILTIN_CHAT_MODELS, USER_SENDER } from "@/constants";
import {
  ChainRunner,
  CopilotPlusChainRunner,
  LLMChainRunner,
  VaultQAChainRunner,
} from "@/LLMProviders/chainRunner";
import { HybridRetriever } from "@/search/hybridRetriever";
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
import {
  getModelKey,
  getChainType,
  subscribeToModelKeyChange,
  subscribeToChainTypeChange,
} from "@/aiParams";
import { getSettings, subscribeToSettingsChange, getSystemPrompt } from "@/settings/model";

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

  constructor(app: App, vectorStoreManager: VectorStoreManager, brevilabsClient: BrevilabsClient) {
    // Instantiate singletons
    this.app = app;
    this.vectorStoreManager = vectorStoreManager;
    this.memoryManager = MemoryManager.getInstance();
    this.chatModelManager = ChatModelManager.getInstance();
    this.embeddingsManager = this.vectorStoreManager.getEmbeddingsManager();
    this.promptManager = PromptManager.getInstance();
    this.brevilabsClient = brevilabsClient;
    this.createChainWithNewModel();
    subscribeToModelKeyChange(() => this.createChainWithNewModel());
    subscribeToChainTypeChange(() =>
      this.setChain(getChainType(), {
        refreshIndex:
          getSettings().indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH &&
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

  private findCustomModel(modelKey: string): CustomModel | undefined {
    const [name, provider] = modelKey.split("|");
    return getSettings().activeModels.find(
      (model) => model.name === name && model.provider === provider
    );
  }

  static storeRetrieverDocuments(documents: Document[]) {
    ChainManager.retrievedDocuments = documents;
  }

  createChainWithNewModel(): void {
    let newModelKey = getModelKey();
    try {
      let customModel = this.findCustomModel(newModelKey);

      if (!customModel) {
        console.error("Resetting to default model. No model configuration found for:", newModelKey);
        customModel = BUILTIN_CHAT_MODELS[0];
        newModelKey = customModel.name + "|" + customModel.provider;
      }

      // Special handling for the "o1-preview" Azure OpenAI model
      if (customModel.name === "o1-preview") {
        customModel.apiKey = getSettings().azureOpenAIApiKey;
        customModel.azureOpenAIApiDeploymentName = "o1-preview";
        customModel.azureOpenAIApiInstanceName = getSettings().azureOpenAIApiInstanceName;
        customModel.azureOpenAIApiVersion = getSettings().azureOpenAIApiVersion;
        // Add any additional Azure-specific settings for "o1-preview"
      }

      // Set the chat model using the ChatModelManager
      this.chatModelManager.setChatModel(customModel);

      // Create and configure the appropriate chain with the new chat model
      this.setChain(getChainType(), {
        prompt: this.getEffectivePrompt(customModel),
      });

      console.log(`Model successfully set to ${newModelKey}`);
    } catch (error) {
      console.error("createChainWithNewModel failed:", error);
      console.log("modelKey:", newModelKey);
    }
  }

  private getEffectivePrompt(customModel: CustomModel): ChatPromptTemplate {
    const modelName = customModel.name;
    const isO1Model = modelName.startsWith("o1");

    let effectivePrompt = ChatPromptTemplate.fromMessages([
      new MessagesPlaceholder("history"),
      HumanMessagePromptTemplate.fromTemplate("{input}"),
    ]);

    return effectivePrompt;
  }

  async setChain(chainType: ChainType, options: SetChainOptions = {}): Promise<void> {
    if (!this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
      console.error("setChain failed: No chat model set.");
      return;
    }

    this.validateChainType(chainType);

    if (options.refreshIndex) {
      await this.vectorStoreManager.indexVaultToVectorStore();
    }

    const chatModel = this.chatModelManager.getChatModel();
    const memory = this.memoryManager.getMemory();
    const chatPrompt = this.promptManager.getChatPrompt();
    const isO1PreviewModel = chatModel.modelName === "o1-preview";

    switch (chainType) {
      case ChainType.LLM_CHAIN: {
        ChainManager.chain = ChainFactory.createNewLLMChain({
          llm: isO1PreviewModel
            ? {
                ...chatModel,
                azureOpenAIApiKey: getSettings().azureOpenAIApiKey,
                azureOpenAIApiInstanceName: getSettings().azureOpenAIApiInstanceName,
                azureOpenAIApiDeploymentName: "o1-preview",
                azureOpenAIApiVersion: getSettings().azureOpenAIApiVersion,
                streaming: false, // Ensure streaming is set to false for o1-preview
              }
            : chatModel,
          memory: memory,
          prompt: options.prompt || chatPrompt,
          abortController: options.abortController,
        });
        setChainType(ChainType.LLM_CHAIN);
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
            maxK: getSettings().maxSourceChunks,
            salientTerms: [],
          },
          getSettings().debug
        );

        const retrievalChainConfig = {
          llm: chatModel,
          retriever: retriever,
          systemMessage: getSystemPrompt(),
        };

        if (!isO1PreviewModel) {
          // Only include streaming if the model supports it
          retrievalChainConfig['streaming'] = true;
        }

        ChainManager.retrievalChain = ChainFactory.createConversationalRetrievalChain(
          retrievalChainConfig,
          ChainManager.storeRetrieverDocuments.bind(ChainManager),
          getSettings().debug
        );

        setChainType(ChainType.VAULT_QA_CHAIN);
        if (getSettings().debug) {
          console.log("New Vault QA chain with hybrid retriever created for entire vault");
        }
        break;
      }

      case ChainType.COPILOT_PLUS_CHAIN: {
        ChainManager.chain = ChainFactory.createNewLLMChain({
          llm: chatModel,
          memory,
          prompt: options.prompt || chatPrompt,
          abortController: options.abortController,
          // Exclude streaming for o1-preview model
          streaming: !isO1PreviewModel
        });
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

  async runChain(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
      updateLoadingMessage?: (message: string) => void;
    } = {}
  ) {
    const { debug = false, ignoreSystemMessage = false } = options;

    if (debug) console.log("==== Step 0: Initial user message ====\n", userMessage);

    this.validateChatModel();
    this.validateChainInitialization();

    const chatModel = this.chatModelManager.getChatModel();
    const modelName = (chatModel as any).modelName || (chatModel as any).model || "";
    const isO1Model = modelName.startsWith("o1");

    if (ignoreSystemMessage || isO1Model) {
      let effectivePrompt = ChatPromptTemplate.fromMessages([
        new MessagesPlaceholder("history"),
        HumanMessagePromptTemplate.fromTemplate("{input}"),
      ]);

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
