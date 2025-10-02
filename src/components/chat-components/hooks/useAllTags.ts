import { useAtomValue } from "jotai";
import { tagsFrontmatterAtom, tagsAllAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

/**
 * Custom hook to get all available tags from the vault.
 * Provides a centralized, memoized source for tag data across all typeahead interfaces.
 * Uses the existing getTagsFromNote utility for consistency.
 * Automatically updates when files are created, deleted, modified, or renamed.
 *
 * Data is managed by the singleton VaultDataManager, which provides:
 * - Single set of vault event listeners (eliminates duplicates)
 * - Debounced updates (250ms) to batch rapid file operations
 * - Stable array references to prevent unnecessary re-renders
 *
 * @param frontmatterOnly - Whether to include only frontmatter tags or all tags (including inline)
 * @returns Array of tag strings with # prefix
 */
export function useAllTags(frontmatterOnly: boolean = false): string[] {
  const frontmatterTags = useAtomValue(tagsFrontmatterAtom, { store: settingsStore });
  const allTags = useAtomValue(tagsAllAtom, { store: settingsStore });

  return frontmatterOnly ? frontmatterTags : allTags;
}
