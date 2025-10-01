import { useAtomValue } from "jotai";
import { TFile } from "obsidian";
import { notesAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

/**
 * Custom hook to get all available notes from the vault.
 * Includes PDF files when in Copilot Plus mode.
 * Automatically updates when files are created, deleted, or renamed.
 *
 * Data is managed by the singleton VaultDataManager, which provides:
 * - Single set of vault event listeners (eliminates duplicates)
 * - Debounced updates (250ms) to batch rapid file operations
 * - Stable array references to prevent unnecessary re-renders
 *
 * @param isCopilotPlus - Whether Copilot Plus features are enabled (currently unused, managed by VaultDataManager)
 * @returns Array of TFile objects (markdown files + PDFs in Plus mode)
 */
export function useAllNotes(isCopilotPlus: boolean = false): TFile[] {
  return useAtomValue(notesAtom, { store: settingsStore });
}
