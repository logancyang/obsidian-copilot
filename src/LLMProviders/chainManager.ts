import { getChainType, getModelKey } from "@/aiParams";
import { ChainType } from "@/chainType";
import {
  AutonomousAgentChainRunner,
  ChainRunner,
  CopilotPlusChainRunner,
  LLMChainRunner,
} from "@/LLMProviders/chainRunner/index";
import { logError, logInfo } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { isOSeriesModel } from "@/utils";
import { resolveChatBackendModel, type ModelManagementApi } from "@/modelManagement";
import { MissingModelKeyError } from "@/error";
import { App } from "obsidian";
import ChatModelManager from "./chatModelManager";
import MemoryManager from "./memoryManager";
import { UserMemoryManager } from "@/memory/UserMemoryManager";

export default class ChainManager {
  public app: App;
  public chatModelManager: ChatModelManager;
  public memoryManager: MemoryManager;
  public userMemoryManager: UserMemoryManager;
  private pendingModelError: Error | null = null;
  private readonly modelManagement: ModelManagementApi;

  constructor(app: App, modelManagement: ModelManagementApi) {
    this.app = app;
    this.modelManagement = modelManagement;
    this.memoryManager = MemoryManager.getInstance();
    this.chatModelManager = ChatModelManager.getInstance();
    this.userMemoryManager = new UserMemoryManager(app);

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

  async createChainWithNewModel(neededReInitChatMode: boolean = true): Promise<void> {
    let selectedModelId: string | undefined;
    const chainType = getChainType();

    try {
      const preferredId = getModelKey();

      if (neededReInitChatMode) {
        const resolution = await resolveChatBackendModel(
          this.modelManagement,
          preferredId || undefined
        );
        if (!resolution.ok) {
          throw new MissingModelKeyError(
            "No chat model enabled. Enable a model under Settings → Basic → Agents → Quick Chat, " +
              "or add one on the Models (BYOK) tab."
          );
        }
        selectedModelId = resolution.configuredModelId;

        await this.chatModelManager.setChatModelFromBridged(resolution.customModel);
        this.pendingModelError = null;
      }

      if (this.chatModelManager.validateChatModel(this.chatModelManager.getChatModel())) {
        this.validateChainType(chainType);
      } else {
        logError("createChainWithNewModel: skipping chain-type housekeeping — no chat model set.");
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
      case ChainType.COPILOT_PLUS_CHAIN:
        if (settings.enableAutonomousAgent) {
          return new AutonomousAgentChainRunner(this);
        }
        return new CopilotPlusChainRunner(this);
      default:
        throw new Error(`Unsupported chain type: ${String(chainType)}`);
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
    const { ignoreSystemMessage = false } = options;

    const l5Text = userMessage.contextEnvelope?.layers.find((l) => l.id === "L5_USER")?.text;
    logInfo(
      "Step 0: Initial user message:\n",
      l5Text || userMessage.originalMessage || userMessage.message
    );

    this.validateChatModel();

    const chatModel = this.chatModelManager.getChatModel();

    if (ignoreSystemMessage || isOSeriesModel(chatModel)) {
      void this.createChainWithNewModel(false).catch((err) =>
        logError("createChainWithNewModel failed", err)
      );
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
