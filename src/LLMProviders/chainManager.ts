import { getChainType, getCurrentProject, getModelKey, SetChainOptions } from "@/aiParams";
import { ChainType } from "@/chainType";
import { USER_SENDER } from "@/constants";
import {
  AutonomousAgentChainRunner,
  ChainRunner,
  CopilotPlusChainRunner,
  LLMChainRunner,
  ProjectChainRunner,
  VaultQAChainRunner,
} from "@/LLMProviders/chainRunner/index";
import { logError, logInfo } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { getSystemPrompt } from "@/system-prompts/systemPromptBuilder";
import { ChatMessage } from "@/types/message";
import { isOSeriesModel } from "@/utils";
import { resolveChatBackendModel, type ModelManagementApi } from "@/modelManagement";
import { MissingModelKeyError } from "@/error";
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { Document } from "@langchain/core/documents";
import { App } from "obsidian";
import ChatModelManager from "./chatModelManager";
import MemoryManager from "./memoryManager";
import PromptManager from "./promptManager";
import { UserMemoryManager } from "@/memory/UserMemoryManager";

export default class ChainManager {
  private retrievedDocuments: Document[] = [];

  public getRetrievedDocuments(): Document[] {
    return this.retrievedDocuments;
  }

  public app: App;
  public chatModelManager: ChatModelManager;
  public memoryManager: MemoryManager;
  public promptManager: PromptManager;
  public userMemoryManager: UserMemoryManager;
  private pendingModelError: Error | null = null;
  /** Model-management API — resolves the chat backend's selected model. */
  private readonly modelManagement: ModelManagementApi;

  constructor(app: App, modelManagement: ModelManagementApi) {
    // Instantiate singletons
    this.app = app;
    this.modelManagement = modelManagement;
    this.memoryManager = MemoryManager.getInstance();
    this.chatModelManager = ChatModelManager.getInstance();
    this.promptManager = PromptManager.getInstance();
    this.userMemoryManager = new UserMemoryManager(app);

    // Initialize async operations
    void this.initialize().catch((err) => logError("ChainManager initialize failed", err));

    subscribeToSettingsChange(() => {
      void this.createChainWithNewModel().catch((err) =>
        logError("createChainWithNewModel failed", err)
      );
    });
    modelManagement.providerRegistry.subscribe(() => {
      void this.createChainWithNewModel().catch((err) =>
        logError("createChainWithNewModel after provider change failed", err)
      );
    });
    modelManagement.backendConfigRegistry.subscribe(() => {
      void this.createChainWithNewModel().catch((err) =>
        logError("createChainWithNewModel after chat backend change failed", err)
      );
    });
  }

  private async initialize() {
    await this.createChainWithNewModel();
  }

  private validateChainType(chainType: ChainType): void {
    if (chainType === undefined || chainType === null) throw new Error("No chain type set");
  }

  private validateChatModel() {
    if (this.pendingModelError) {
      throw this.pendingModelError;
    }

    if (!this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
      const errorMsg =
        "Chat model is not initialized properly, check your API key in Copilot setting and make sure you have API access.";
      throw new MissingModelKeyError(errorMsg);
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
    // The selection is a `configuredModelId` in the chat backend (no longer a
    // legacy "name|provider" key). Project mode keeps its own per-project
    // selection; everything else uses the session/global selection.
    let selectedModelId: string | undefined;
    const chainType = getChainType();
    const currentProject = getCurrentProject();

    if (chainType === ChainType.PROJECT_CHAIN && !currentProject) {
      return;
    }

    try {
      const preferredId =
        chainType === ChainType.PROJECT_CHAIN ? currentProject?.projectModelKey : getModelKey();

      if (neededReInitChatMode) {
        const resolution = await resolveChatBackendModel(
          this.modelManagement,
          preferredId || undefined
        );
        if (!resolution.ok) {
          throw new MissingModelKeyError(
            "No chat model enabled. Enable a model under Settings → Agents → Quick Chat, " +
              "or add one on the Models (BYOK) tab."
          );
        }
        selectedModelId = resolution.configuredModelId;

        // Project temperature / maxTokens overrides still apply on top of the
        // bridged model.
        const mergedModel = {
          ...resolution.customModel,
          ...currentProject?.modelConfigs,
        };
        await this.chatModelManager.setChatModelFromBridged(mergedModel);
        this.pendingModelError = null;
      }

      // Chain-type housekeeping. Do NOT write `chainType` back to the atom —
      // the atom is owned by the UI dropdowns and `applyPlusSettings`. The
      // captured local `chainType` may already be stale by the time we reach
      // here (we just awaited `setChatModel(...)`), and writing it back used
      // to create a self-sustaining `setChainType` → ProjectManager
      // subscriber → `createChainWithNewModel` loop that froze Obsidian on
      // apply-Plus-key.
      if (this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
        this.validateChainType(chainType);
        if (options.refreshIndex) {
          await this.refreshVaultIndex();
        }
      } else {
        console.error(
          "createChainWithNewModel: skipping chain-type housekeeping — no chat model set."
        );
      }
      logInfo(`Setting chat model to configuredModelId=${selectedModelId}`);
    } catch (error) {
      this.pendingModelError = error instanceof Error ? error : new Error(String(error));
      logError(`createChainWithNewModel failed: ${error}`);
      logInfo(`configuredModelId: ${selectedModelId ?? getModelKey()}`);
    }
  }

  private getChainRunner(): ChainRunner {
    const chainType = getChainType();
    const settings = getSettings();

    switch (chainType) {
      case ChainType.LLM_CHAIN:
        return new LLMChainRunner(this);
      case ChainType.VAULT_QA_CHAIN:
        return new VaultQAChainRunner(this);
      case ChainType.COPILOT_PLUS_CHAIN:
        // Use AutonomousAgentChainRunner if the setting is enabled
        if (settings.enableAutonomousAgent) {
          return new AutonomousAgentChainRunner(this);
        }
        return new CopilotPlusChainRunner(this);
      case ChainType.PROJECT_CHAIN:
        return new ProjectChainRunner(this);
      default:
        throw new Error(`Unsupported chain type: ${String(chainType)}`);
    }
  }

  /**
   * Re-index the vault into the Orama vector store. No-op when legacy
   * semantic search is disabled — v3 lexical search builds its index on
   * demand and doesn't need a precomputed store.
   */
  private async refreshVaultIndex() {
    if (!getSettings().enableSemanticSearchV3) return;
    const VectorStoreManager = (await import("@/search/vectorStoreManager")).default;
    await VectorStoreManager.getInstance().indexVaultToVectorStore(false);
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
    const { ignoreSystemMessage = false } = options;

    const l5Text = userMessage.contextEnvelope?.layers.find((l) => l.id === "L5_USER")?.text;
    logInfo(
      "Step 0: Initial user message:\n",
      l5Text || userMessage.originalMessage || userMessage.message
    );

    this.validateChatModel();

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

      void this.createChainWithNewModel({ prompt: effectivePrompt }, false).catch((err) =>
        logError("createChainWithNewModel failed", err)
      );
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
}
