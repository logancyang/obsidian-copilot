import { useMemo } from "react";
import { TFile } from "obsidian";
import { getTagsFromNote } from "@/utils";

/**
 * Custom hook to get all available tags from the vault.
 * Provides a centralized, memoized source for tag data across all typeahead interfaces.
 * Uses the existing getTagsFromNote utility for consistency.
 *
 * @param frontmatterOnly - Whether to include only frontmatter tags or all tags (default: false)
 * @returns Array of tag strings with # prefix
 */
export function useAllTags(frontmatterOnly: boolean = false): string[] {
  return useMemo(() => {
    if (!app?.vault) return [];

    const tags = new Set<string>();

    // Get all markdown files and extract tags using the existing utility
    app.vault.getMarkdownFiles().forEach((file: TFile) => {
      const fileTags = getTagsFromNote(file, frontmatterOnly);
      fileTags.forEach((tag) => {
        // Ensure tag has # prefix for consistency
        const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
        tags.add(tagWithHash);
      });
    });

    return Array.from(tags);
  }, [frontmatterOnly]);
}
