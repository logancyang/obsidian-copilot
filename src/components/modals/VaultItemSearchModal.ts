import { createUrlItem, extractUrlsFromText, type UrlItem } from "@/lib/url-tag";
import { App, FuzzyMatch, FuzzySuggestModal, getAllTags, TAbstractFile, TFolder } from "obsidian";

export type VaultLinkTarget = TAbstractFile | string | UrlItem;

export class VaultItemSearchModal extends FuzzySuggestModal<VaultLinkTarget> {
  constructor(
    app: App,
    private onChoose: (item: VaultLinkTarget) => void
  ) {
    super(app);
    this.setPlaceholder("Link a note, folder or tag, or paste a web link...");
  }

  getSuggestions(query: string): FuzzyMatch<VaultLinkTarget>[] {
    // A bare file name such as tiers.md also parses as a web address, so only text with http(s):// is read as a link.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/838
    const urls = extractUrlsFromText(query);
    if (urls.length === 0) return super.getSuggestions(query);
    return urls.map((url) => ({ item: createUrlItem(url), match: { score: 0, matches: [] } }));
  }

  getItems(): VaultLinkTarget[] {
    const tags = new Map<string, string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      for (const tag of (cache && getAllTags(cache)) ?? []) {
        if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
      }
    }
    return [
      ...this.app.vault.getAllLoadedFiles().filter((item) => item.path !== "/"),
      ...tags.values(),
    ];
  }

  getItemText(item: VaultLinkTarget): string {
    if (typeof item === "string") return item;
    if ("url" in item) return item.url;
    return item instanceof TFolder ? `${item.path}/` : item.path;
  }

  onChooseItem(item: VaultLinkTarget): void {
    this.onChoose(item);
  }
}
