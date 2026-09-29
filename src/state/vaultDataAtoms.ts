import { atom } from "jotai";
import { App, TFile, TFolder, TAbstractFile } from "obsidian";
import { debounce } from "@/utils/debounce";
import { settingsStore } from "@/settings/model";
import { getTagsFromNote, isAllowedFileForNoteContext } from "@/utils";
import { logInfo } from "@/logger";

const VAULT_DEBOUNCE_DELAY = 250;

export const notesAtom = atom<TFile[]>([]);
export const foldersAtom = atom<TFolder[]>([]);
export const tagsFrontmatterAtom = atom<string[]>([]);
export const tagsAllAtom = atom<string[]>([]);

export class VaultDataManager {
  private static instance: VaultDataManager | null = null;
  private initialized = false;
  private app: App | null = null;

  private constructor() {}

  public static getInstance(): VaultDataManager {
    if (!VaultDataManager.instance) {
      VaultDataManager.instance = new VaultDataManager();
    }
    return VaultDataManager.instance;
  }

  public initialize(app: App): void {
    if (this.initialized) {
      logInfo("VaultDataManager: Already initialized, skipping");
      return;
    }

    if (!app?.vault) {
      logInfo("VaultDataManager: app.vault not available, deferring initialization");
      return;
    }

    this.app = app;

    logInfo("VaultDataManager: Initializing with vault event listeners");

    this.refreshNotes();
    this.refreshFolders();
    this.refreshTagsFrontmatter();
    this.refreshTagsAll();

    app.vault.on("create", this.handleFileCreate);
    app.vault.on("delete", this.handleFileDelete);
    app.vault.on("rename", this.handleFileRename);
    app.vault.on("modify", this.handleFileModify);
    app.metadataCache.on("changed", this.handleMetadataChange);

    this.initialized = true;
  }

  private handleFileCreate = (file: TAbstractFile): void => {
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
        this.debouncedRefreshTagsFrontmatter();
        this.debouncedRefreshTagsAll();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private handleFileDelete = (file: TAbstractFile): void => {
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
        this.debouncedRefreshTagsFrontmatter();
        this.debouncedRefreshTagsAll();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private handleFileRename = (file: TAbstractFile, _oldPath: string): void => {
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
        this.debouncedRefreshTagsFrontmatter();
        this.debouncedRefreshTagsAll();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private handleFileModify = (file: TAbstractFile): void => {
    if (file instanceof TFile && file.extension === "md") {
      this.debouncedRefreshTagsAll();
    }
  };

  private handleMetadataChange = (file: TFile): void => {
    if (file.extension === "md") {
      this.debouncedRefreshTagsFrontmatter();
      this.debouncedRefreshTagsAll();
    }
  };

  private debouncedRefreshNotes = debounce(() => this.refreshNotes(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  private debouncedRefreshFolders = debounce(() => this.refreshFolders(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  private debouncedRefreshTagsFrontmatter = debounce(
    () => this.refreshTagsFrontmatter(),
    VAULT_DEBOUNCE_DELAY,
    {
      leading: true,
      trailing: true,
    }
  );

  private debouncedRefreshTagsAll = debounce(() => this.refreshTagsAll(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  private refreshNotes = (): void => {
    if (!this.app?.vault) return;

    const allFiles = this.app.vault.getFiles();
    const newFiles = allFiles.filter(
      (file): file is TFile => file instanceof TFile && isAllowedFileForNoteContext(file)
    );

    settingsStore.set(notesAtom, newFiles);
  };

  private refreshFolders = (): void => {
    if (!this.app?.vault) return;

    const newFolders = this.app.vault
      .getAllLoadedFiles()
      .filter((file: TAbstractFile): file is TFolder => file instanceof TFolder);

    settingsStore.set(foldersAtom, newFolders);
  };

  private refreshTagsFrontmatter = (): void => {
    if (!this.app?.vault || !this.app?.metadataCache) return;
    const app = this.app;

    const tagSet = new Set<string>();

    app.vault.getMarkdownFiles().forEach((file: TFile) => {
      const fileTags = getTagsFromNote(app, file, true);
      fileTags.forEach((tag) => {
        const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
        tagSet.add(tagWithHash);
      });
    });

    const newTags = Array.from(tagSet).sort();

    settingsStore.set(tagsFrontmatterAtom, newTags);
  };

  private refreshTagsAll = (): void => {
    if (!this.app?.vault || !this.app?.metadataCache) return;
    const app = this.app;

    const tagSet = new Set<string>();

    app.vault.getMarkdownFiles().forEach((file: TFile) => {
      const fileTags = getTagsFromNote(app, file, false);
      fileTags.forEach((tag) => {
        const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
        tagSet.add(tagWithHash);
      });
    });

    const newTags = Array.from(tagSet).sort();

    settingsStore.set(tagsAllAtom, newTags);
  };

  public cleanup(): void {
    if (!this.initialized) {
      return;
    }

    logInfo("VaultDataManager: Cleaning up event listeners");

    this.debouncedRefreshNotes.cancel();
    this.debouncedRefreshFolders.cancel();
    this.debouncedRefreshTagsFrontmatter.cancel();
    this.debouncedRefreshTagsAll.cancel();

    if (this.app?.vault) {
      this.app.vault.off("create", this.handleFileCreate);
      this.app.vault.off("delete", this.handleFileDelete);
      this.app.vault.off("rename", this.handleFileRename);
      this.app.vault.off("modify", this.handleFileModify);
    }
    if (this.app?.metadataCache) {
      this.app.metadataCache.off("changed", this.handleMetadataChange);
    }

    this.initialized = false;
  }

  public unload(): void {
    this.cleanup();
  }
}
