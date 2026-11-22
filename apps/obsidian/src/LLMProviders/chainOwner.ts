import { subscribeToChainTypeChange, subscribeToModelKeyChange } from "@/aiParams";
import { App } from "obsidian";
import ChainManager from "./chainManager";
import type { ModelManagementApi } from "@/modelManagement";

export default class ChainOwner {
  public static instance: ChainOwner;
  private readonly chainMangerInstance: ChainManager;

  private constructor(app: App, modelManagement: ModelManagementApi) {
    this.chainMangerInstance = new ChainManager(app, modelManagement);

    subscribeToModelKeyChange(() => {
      void this.getCurrentChainManager().createChainWithNewModel();
    });

    subscribeToChainTypeChange(() => {
      void this.getCurrentChainManager().createChainWithNewModel();
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
