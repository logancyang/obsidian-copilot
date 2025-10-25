import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { TFile } from "obsidian";
import { notesAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

/**
 * Custom hook to get all available notes from the vault.
 * Includes canvas files for all users and PDF files when in Copilot Plus mode.
 * Automatically updates when files are created, deleted, or renamed.
 * Notes are sorted by creation date in descending order (newest first).
 *
 * Data is managed by the singleton VaultDataManager, which provides:
 * - Single set of vault event listeners (eliminates duplicates)
 * - Debounced updates (250ms) to batch rapid file operations
 * - Stable array references to prevent unnecessary re-renders
 *
 * @param isCopilotPlus - Whether to include PDF files (Plus feature)
 * @returns Array of TFile objects sorted by creation date (newest first)
 */
export function useAllNotes(isCopilotPlus: boolean = false): TFile[] {
  const allNotes = useAtomValue(notesAtom, { store: settingsStore });

  return useMemo(() => {
    let files: TFile[];

    if (isCopilotPlus) {
      // Return all files (md + PDFs + canvas) - create a copy to avoid mutating the atom
      files = [...allNotes];
    } else {
      // Filter out PDFs for non-Plus users, but include canvas for all users
      files = allNotes.filter((file) => file.extension === "md" || file.extension === "canvas");
    }

    // Sort by creation time in descending order (newest first)
    return files.sort((a, b) => b.stat.ctime - a.stat.ctime);
  }, [allNotes, isCopilotPlus]);
}
