import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { TFile } from "obsidian";
import { notesAtom } from "@/state/vaultDataAtoms";
import { settingsStore, useSettingsValue } from "@/settings/model";
import { isSuggestedVaultPath } from "./noteSuggestionPaths";

export function useAllNotes(): TFile[] {
  const allNotes = useAtomValue(notesAtom, { store: settingsStore });
  const { copilotFolder } = useSettingsValue();

  return useMemo(
    () =>
      allNotes
        .filter((file) => isSuggestedVaultPath(file.path, { copilotFolder }))
        .sort((a, b) => b.stat.ctime - a.stat.ctime),
    [allNotes, copilotFolder]
  );
}
