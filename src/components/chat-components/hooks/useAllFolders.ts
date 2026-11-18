import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { TFolder } from "obsidian";
import { foldersAtom } from "@/state/vaultDataAtoms";
import { settingsStore, useSettingsValue } from "@/settings/model";
import { isSuggestedVaultPath } from "./noteSuggestionPaths";

export function useAllFolders(): TFolder[] {
  const allFolders = useAtomValue(foldersAtom, { store: settingsStore });
  const { copilotFolder } = useSettingsValue();

  return useMemo(
    () => allFolders.filter((folder) => isSuggestedVaultPath(folder.path, { copilotFolder })),
    [allFolders, copilotFolder]
  );
}
