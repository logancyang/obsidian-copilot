import { useMemo } from "react";
import { TFolder, TAbstractFile } from "obsidian";

/**
 * Custom hook to get all available folders from the vault.
 * Provides a centralized, memoized source for folder data across all typeahead interfaces.
 *
 * @returns Array of TFolder objects from the vault
 */
export function useAllFolders(): TFolder[] {
  return useMemo(() => {
    if (!app?.vault) return [];

    // Get all loaded files and filter for folders only
    return app.vault
      .getAllLoadedFiles()
      .filter((file: TAbstractFile): file is TFolder => file instanceof TFolder);
  }, []);
}
