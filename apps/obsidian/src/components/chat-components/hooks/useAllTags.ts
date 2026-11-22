import { useAtomValue } from "jotai";
import { tagsFrontmatterAtom, tagsAllAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

export function useAllTags(frontmatterOnly: boolean = false): string[] {
  const frontmatterTags = useAtomValue(tagsFrontmatterAtom, { store: settingsStore });
  const allTags = useAtomValue(tagsAllAtom, { store: settingsStore });

  return frontmatterOnly ? frontmatterTags : allTags;
}
