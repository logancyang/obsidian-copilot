import "./types";
import { TFile } from "obsidian";

/**
 * Get all outgoing links from a note
 * @param file The note file to analyze
 * @returns Array of linked note
 */
export function getLinkedNotes(file: TFile): TFile[] {
  // Get the cache for the current file
  const fileCache = app.metadataCache.getFileCache(file);
  const linkedNotes: TFile[] = [];

  if (fileCache?.links) {
    // Get all wiki-style links [[link]]
    for (const link of fileCache.links) {
      const resolvedFile = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (resolvedFile) {
        linkedNotes.push(resolvedFile);
      }
    }
  }

  if (fileCache?.embeds) {
    // Get all embedded links ![[link]]
    for (const embed of fileCache.embeds) {
      const resolvedFile = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
      if (resolvedFile) {
        linkedNotes.push(resolvedFile);
      }
    }
  }

  return [...new Set(linkedNotes)];
}

/**
 * Get all notes that link to the given note
 * @param file The note file to analyze
 * @returns Array of backlinked note
 */
export function getBacklinkedNotes(file: TFile): TFile[] {
  const backlinkedNotes: TFile[] = [];

  // Get the backlinks from metadata cache
  const backlinks = app.metadataCache.getBacklinksForFile(file);

  if (backlinks?.data) {
    // Convert the backlinks map to array of paths
    for (const [path] of backlinks.data) {
      const file = app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        backlinkedNotes.push(file);
      }
    }
  }

  return backlinkedNotes;
}
