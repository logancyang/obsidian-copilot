import { getChainType, subscribeToChainTypeChange, subscribeToModelKeyChange } from "@/aiParams";
import { ChainType } from "@/chainType";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { getSettings } from "@/settings/model";
import { App } from "obsidian";
import ChainManager from "./chainManager";
import type { ModelManagementApi } from "@/modelManagement";

/**
 * Owns the single {@link ChainManager} the Quick Chat surfaces share, and
 * rebuilds its chain whenever the selected model or chain type changes. Holding
 * one instance keeps conversation memory continuous across mode switches — a
 * per-view chain manager would reset it on every toggle.
 */
export default class ChainOwner {
  public static instance: ChainOwner;
  private readonly chainMangerInstance: ChainManager;

  private constructor(app: App, modelManagement: ModelManagementApi) {
    this.chainMangerInstance = new ChainManager(app, modelManagement);

    subscribeToModelKeyChange(() => {
      void this.getCurrentChainManager().createChainWithNewModel();
    });

    subscribeToChainTypeChange(() => {
      const settings = getSettings();
      const shouldAutoIndex =
        settings.enableSemanticSearchV3 &&
        (settings.indexVaultToVectorStore as VAULT_VECTOR_STORE_STRATEGY) ===
          VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH &&
        (getChainType() === ChainType.VAULT_QA_CHAIN ||
          getChainType() === ChainType.COPILOT_PLUS_CHAIN);
      void this.getCurrentChainManager().createChainWithNewModel({
        refreshIndex: shouldAutoIndex,
      });
    });
  }

  public static getInstance(app: App, modelManagement: ModelManagementApi): ChainOwner {
    if (!ChainOwner.instance) {
      ChainOwner.instance = new ChainOwner(app, modelManagement);
    }
    return ChainOwner.instance;
  }

  public getCurrentChainManager(): ChainManager {
    return this.chainMangerInstance;
  }
}
