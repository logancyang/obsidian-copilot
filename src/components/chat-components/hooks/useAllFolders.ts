import { useAtomValue } from "jotai";
import { TFolder } from "obsidian";
import { foldersAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

export function useAllFolders(): TFolder[] {
  return useAtomValue(foldersAtom, { store: settingsStore });
}
