import { getChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { logInfo } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { App, MarkdownView, Platform, TAbstractFile, TFile } from "obsidian";
import { DBOperations } from "./dbOperations";
import { IndexOperations } from "./indexOperations";
import { getMatchingPatterns, shouldIndexFile } from "./searchUtils";

const DEBOUNCE_DELAY = 5000; // 5 seconds

export class IndexEventHandler {
  private debounceTimer: number | null = null;
  private lastActiveFile: TFile | null = null;
  private lastActiveFileMtime: number | null = null;
  private listenersActive = false;

  constructor(
    private app: App,
    private indexOps: IndexOperations,
    private dbOps: DBOperations
  ) {
    this.syncEventListeners();
    subscribeToSettingsChange(() => {
      this.syncEventListeners();
    });
  }

  /**
   * Determine whether indexing-related events should be processed based on current settings.
   *
   * @returns {boolean} True when semantic search indexing should run.
   */
  private shouldHandleEvents(): boolean {
    return getSettings().enableSemanticSearchV3;
  }

  /**
   * Ensure event listeners are registered only when semantic search indexing is enabled.
   */
  private syncEventListeners(): void {
    const shouldListen = this.shouldHandleEvents();
    if (shouldListen && !this.listenersActive) {
      logInfo("Copilot Plus: Initializing semantic index event listeners");
      this.app.workspace.on("active-leaf-change", this.handleActiveLeafChange);
      this.app.vault.on("delete", this.handleFileDelete);
      this.listenersActive = true;
    } else if (!shouldListen && this.listenersActive) {
      this.teardownEventListeners();
    }
  }

  /**
   * Remove indexing event listeners and reset any pending timers or cached state.
   */
  private teardownEventListeners(): void {
    if (!this.listenersActive) {
      return;
    }
    this.app.workspace.off("active-leaf-change", this.handleActiveLeafChange);
    this.app.vault.off("delete", this.handleFileDelete);
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.lastActiveFile = null;
    this.lastActiveFileMtime = null;
    this.listenersActive = false;
  }

  private handleActiveLeafChange = async (leaf: any) => {
    if (!this.shouldHandleEvents()) {
      return;
    }
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
    if (!this.shouldHandleEvents()) {
      return;
    }
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
    if (!this.shouldHandleEvents()) {
      return;
    }
    if (file instanceof TFile) {
      await this.dbOps.removeDocs(file.path);
    }
  };

  public cleanup() {
    this.teardownEventListeners();
  }

  public unload() {
    this.teardownEventListeners();
  }
}
