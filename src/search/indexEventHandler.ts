import { getChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { getSettings } from "@/settings/model";
import { App, Platform, TAbstractFile, TFile } from "obsidian";
import { DBOperations } from "./dbOperations";
import { IndexOperations } from "./indexOperations";
import { getFilePathsForQA } from "./searchUtils";

export class IndexEventHandler {
  private debounceTimer: number | null = null;
  private readonly debounceDelay = 10000; // 10 seconds
  private excludedFiles: Set<string> = new Set();

  constructor(
    private app: App,
    private indexOps: IndexOperations,
    private dbOps: DBOperations
  ) {
    this.updateExcludedFiles();
  }

  public initializeEventListeners() {
    if (getSettings().debug) {
      console.log("Copilot Plus: Initializing event listeners");
    }
    this.app.vault.on("modify", this.handleFileModify);
    this.app.vault.on("delete", this.handleFileDelete);
  }

  public async updateExcludedFiles() {
    this.excludedFiles = await getFilePathsForQA("exclusions", this.app);
  }

  private handleFileModify = async (file: TAbstractFile) => {
    if (Platform.isMobile && getSettings().disableIndexOnMobile) {
      return;
    }
    await this.updateExcludedFiles();
    const currentChainType = getChainType();

    if (
      file instanceof TFile &&
      file.extension === "md" &&
      currentChainType === ChainType.COPILOT_PLUS_CHAIN
    ) {
      const includedFiles = await getFilePathsForQA("inclusions", this.app);

      const shouldProcess =
        includedFiles.size > 0 ? includedFiles.has(file.path) : !this.excludedFiles.has(file.path);

      if (shouldProcess) {
        this.debouncedReindexFile(file);
      }
    }
  };

  private debouncedReindexFile = (file: TFile) => {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      if (getSettings().debug) {
        console.log("Copilot Plus: Triggering reindex for file ", file.path);
      }
      this.indexOps.reindexFile(file);
      this.debounceTimer = null;
    }, this.debounceDelay);
  };

  private handleFileDelete = async (file: TAbstractFile) => {
    if (file instanceof TFile) {
      await this.dbOps.removeDocs(file.path);
    }
  };

  public cleanup() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.app.vault.off("modify", this.handleFileModify);
    this.app.vault.off("delete", this.handleFileDelete);
  }
}
