import { getChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { getSettings } from "@/settings/model";
import { App, MarkdownView, Platform, TAbstractFile, TFile } from "obsidian";
import { DBOperations } from "./dbOperations";
import { IndexOperations } from "./indexOperations";
import { getMatchingPatterns, shouldIndexFile } from "./searchUtils";

const DEBOUNCE_DELAY = 5000; // 5 seconds

export class IndexEventHandler {
  private debounceTimer: number | null = null;
  private lastActiveFile: TFile | null = null;
  private lastActiveFileMtime: number | null = null;

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
    this.app.workspace.on("active-leaf-change", this.handleActiveLeafChange);
    this.app.vault.on("delete", this.handleFileDelete);
  }

  private handleActiveLeafChange = async (leaf: any) => {
    if (Platform.isMobile && getSettings().disableIndexOnMobile) {
      return;
    }

    const currentChainType = getChainType();
    if (currentChainType !== ChainType.COPILOT_PLUS_CHAIN) {
      return;
    }

    // Get the previously active file that we need to check
    const fileToCheck = this.lastActiveFile;
    const previousMtime = this.lastActiveFileMtime;

    // Update tracking for the new active file
    const currentView = leaf?.view;
    this.lastActiveFile = currentView instanceof MarkdownView ? currentView.file : null;
    this.lastActiveFileMtime = this.lastActiveFile?.stat?.mtime ?? null;

    // If there was no previous file or it's the same as current, do nothing
    if (!fileToCheck || fileToCheck === this.lastActiveFile) {
      return;
    }

    // Safety check for file stats and mtime
    if (!fileToCheck?.stat?.mtime || previousMtime === null) {
      return;
    }

    // Only process markdown files that match inclusion/exclusion patterns
    if (fileToCheck.extension === "md") {
      const { inclusions, exclusions } = getMatchingPatterns();
      const shouldProcess = shouldIndexFile(fileToCheck, inclusions, exclusions);

      // Check if file was modified while it was active
      const wasModified = previousMtime !== null && fileToCheck.stat.mtime > previousMtime;

      if (shouldProcess && wasModified) {
        this.debouncedReindexFile(fileToCheck);
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
    this.app.workspace.off("active-leaf-change", this.handleActiveLeafChange);
    this.app.vault.off("delete", this.handleFileDelete);
  }

  public unload() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    // Clean up file tracking
    this.lastActiveFile = null;
    this.lastActiveFileMtime = null;

    this.app.workspace.off("active-leaf-change", this.handleActiveLeafChange);
    this.app.vault.off("delete", this.handleFileDelete);
  }
}
