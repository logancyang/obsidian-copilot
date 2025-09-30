import { useState, useEffect } from "react";
import { TFolder, TAbstractFile } from "obsidian";

/**
 * Custom hook to get all available folders from the vault.
 * Provides a centralized, memoized source for folder data across all typeahead interfaces.
 * Automatically updates when folders are created, deleted, or renamed.
 *
 * @returns Array of TFolder objects from the vault
 */
export function useAllFolders(): TFolder[] {
  const [folders, setFolders] = useState<TFolder[]>(() => {
    if (!app?.vault) return [];

    return app.vault
      .getAllLoadedFiles()
      .filter((file: TAbstractFile): file is TFolder => file instanceof TFolder);
  });

  useEffect(() => {
    if (!app?.vault) return;

    const refreshFolders = () => {
      const allFolders = app.vault
        .getAllLoadedFiles()
        .filter((file: TAbstractFile): file is TFolder => file instanceof TFolder);
      setFolders(allFolders);
    };

    const onFolderChange = (file: TAbstractFile) => {
      if (file instanceof TFolder) {
        refreshFolders();
      }
    };

    app.vault.on("create", onFolderChange);
    app.vault.on("delete", onFolderChange);
    app.vault.on("rename", onFolderChange);

    return () => {
      app.vault.off("create", onFolderChange);
      app.vault.off("delete", onFolderChange);
      app.vault.off("rename", onFolderChange);
    };
  }, []);

  return folders;
}
