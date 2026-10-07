import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { TFile } from "obsidian";
import { notesAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

export function useAllNotes(): TFile[] {
  const allNotes = useAtomValue(notesAtom, { store: settingsStore });

  return useMemo(() => [...allNotes].sort((a, b) => b.stat.ctime - a.stat.ctime), [allNotes]);
}
