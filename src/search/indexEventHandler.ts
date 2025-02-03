import { getChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { getSettings } from "@/settings/model";
import { App, Platform, TAbstractFile, TFile } from "obsidian";
import { DBOperations } from "./dbOperations";
import { IndexOperations } from "./indexOperations";
import { getMatchingPatterns, shouldIndexFile } from "./searchUtils";

const DEBOUNCE_DELAY = 10000; // 10 seconds

export class IndexEventHandler {
  private debounceTimer: number | null = null;

  constructor(
    private app: App,
    private indexOps: IndexOperations,
    private dbOps: DBOperations
  ) {
    this.initializeEventListeners();
  }

  private initializeEventListeners() {
    if (getSettings().debug) {
      console.log("Copilot Plus: Initializing event listeners");
    }
    this.app.vault.on("modify", this.handleFileModify);
    this.app.vault.on("delete", this.handleFileDelete);
  }

  private handleFileModify = async (file: TAbstractFile) => {
    if (Platform.isMobile && getSettings().disableIndexOnMobile) {
      return;
    }
    const currentChainType = getChainType();

    if (
      file instanceof TFile &&
      file.extension === "md" &&
      currentChainType === ChainType.COPILOT_PLUS_CHAIN
    ) {
      const { inclusions, exclusions } = getMatchingPatterns();
      const shouldProcess = shouldIndexFile(file, inclusions, exclusions);

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
    }, DEBOUNCE_DELAY);
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
