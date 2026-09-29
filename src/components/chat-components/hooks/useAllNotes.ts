import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { TFile } from "obsidian";
import { notesAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

export function useAllNotes(isCopilotPlus: boolean = false): TFile[] {
  const allNotes = useAtomValue(notesAtom, { store: settingsStore });

  return useMemo(() => {
    let files: TFile[];

    if (isCopilotPlus) {
      files = [...allNotes];
    } else {
      files = allNotes.filter((file) => file.extension === "md" || file.extension === "canvas");
    }

    return files.sort((a, b) => b.stat.ctime - a.stat.ctime);
  }, [allNotes, isCopilotPlus]);
}
