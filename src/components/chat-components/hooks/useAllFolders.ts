import { useAtomValue } from "jotai";
import { TFolder } from "obsidian";
import { foldersAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

/**
 * Custom hook to get all available folders from the vault.
 * Provides a centralized, memoized source for folder data across all typeahead interfaces.
 * Automatically updates when folders are created, deleted, or renamed.
 *
 * Data is managed by the singleton VaultDataManager, which provides:
 * - Single set of vault event listeners (eliminates duplicates)
 * - Debounced updates (250ms) to batch rapid file operations
 * - Stable array references to prevent unnecessary re-renders
 *
 * @returns Array of TFolder objects from the vault
 */
export function useAllFolders(): TFolder[] {
  return useAtomValue(foldersAtom, { store: settingsStore });
}
