import { useState, useEffect } from "react";
import { TFile, TAbstractFile } from "obsidian";
import { getTagsFromNote } from "@/utils";

/**
 * Custom hook to get all available tags from the vault.
 * Provides a centralized, memoized source for tag data across all typeahead interfaces.
 * Uses the existing getTagsFromNote utility for consistency.
 * Automatically updates when files are created, deleted, modified, or renamed.
 *
 * @param frontmatterOnly - Whether to include only frontmatter tags or all tags (default: false)
 * @returns Array of tag strings with # prefix
 */
export function useAllTags(frontmatterOnly: boolean = false): string[] {
  const [tags, setTags] = useState<string[]>(() => {
    if (!app?.vault) return [];

    const tagSet = new Set<string>();

    app.vault.getMarkdownFiles().forEach((file: TFile) => {
      const fileTags = getTagsFromNote(file, frontmatterOnly);
      fileTags.forEach((tag) => {
        const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
        tagSet.add(tagWithHash);
      });
    });

    return Array.from(tagSet);
  });

  useEffect(() => {
    if (!app?.vault || !app?.metadataCache) return;

    const refreshTags = () => {
      const tagSet = new Set<string>();

      app.vault.getMarkdownFiles().forEach((file: TFile) => {
        const fileTags = getTagsFromNote(file, frontmatterOnly);
        fileTags.forEach((tag) => {
          const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
          tagSet.add(tagWithHash);
        });
      });

      setTags(Array.from(tagSet));
    };

    const onFileChange = (file: TAbstractFile) => {
      if (file instanceof TFile && file.extension === "md") {
        refreshTags();
      }
    };

    // Listen to metadata cache changes for frontmatter tag updates
    const onMetadataChange = (file: TFile) => {
      if (file.extension === "md") {
        refreshTags();
      }
    };

    app.vault.on("create", onFileChange);
    app.vault.on("delete", onFileChange);
    app.vault.on("rename", onFileChange);
    app.metadataCache.on("changed", onMetadataChange);

    // When including inline tags, also listen to modify events
    // to catch content changes that add/remove inline tags
    if (!frontmatterOnly) {
      app.vault.on("modify", onFileChange);
    }

    return () => {
      app.vault.off("create", onFileChange);
      app.vault.off("delete", onFileChange);
      app.vault.off("rename", onFileChange);
      app.metadataCache.off("changed", onMetadataChange);
      if (!frontmatterOnly) {
        app.vault.off("modify", onFileChange);
      }
    };
  }, [frontmatterOnly]);

  return tags;
}
