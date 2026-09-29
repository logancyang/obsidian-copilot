import "./types";
import { App, TFile } from "obsidian";

export function getLinkedNotes(app: App, file: TFile, limit = 20): TFile[] {
  const fileCache = app.metadataCache.getFileCache(file);
  const linkedNotes: TFile[] = [];

  if (fileCache?.links) {
    for (const link of fileCache.links) {
      const resolvedFile = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
      if (resolvedFile) {
        linkedNotes.push(resolvedFile);
        if (linkedNotes.length >= limit) {
          break;
        }
      }
    }
  }

  if (fileCache?.embeds && linkedNotes.length < limit) {
    for (const embed of fileCache.embeds) {
      const resolvedFile = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
      if (resolvedFile) {
        linkedNotes.push(resolvedFile);
        if (linkedNotes.length >= limit) {
          break;
        }
      }
    }
  }

  return [...new Set(linkedNotes)];
}

export function getBacklinkedNotes(app: App, file: TFile, limit = 20): TFile[] {
  const backlinkedNotes: TFile[] = [];

  const backlinks = app.metadataCache.getBacklinksForFile(file);

  if (backlinks?.data) {
    for (const [path] of backlinks.data) {
      const file = app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        backlinkedNotes.push(file);
        if (backlinkedNotes.length >= limit) {
          break;
        }
      }
    }
  }

  return backlinkedNotes;
}
