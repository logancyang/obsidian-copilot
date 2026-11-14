import { App, TFile, TFolder } from "obsidian";

export interface TextMentions {
  notes: TFile[];
  folders: string[];
}

// A draft restored as plain text has no pills, so its mentions are found again from the text when it is sent.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/932
export function mentionsInText(
  app: App,
  text: string,
  resolvedNoteMentions: ReadonlySet<string>
): TextMentions {
  const notes = new Map<string, TFile>();
  for (const [mention, linkpath] of text.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) {
    if (resolvedNoteMentions.has(mention)) continue;
    const file = app.metadataCache.getFirstLinkpathDest(linkpath.trim(), "");
    if (file) notes.set(file.path, file);
  }
  const folders = new Set<string>();
  for (const [, path] of text.matchAll(/\{([^{}]+)\}/g)) {
    if (app.vault.getAbstractFileByPath(path) instanceof TFolder) folders.add(path);
  }
  return { notes: [...notes.values()], folders: [...folders] };
}
