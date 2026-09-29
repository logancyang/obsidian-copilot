import { getTagsFromNote } from "@/utils";
import { App, FuzzySuggestModal } from "obsidian";

export class TagSearchModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private onChooseTag: (tag: string) => void
  ) {
    super(app);
  }

  getItems(): string[] {
    const files = this.app.vault.getMarkdownFiles();
    const tagSet = new Set<string>();

    for (const file of files) {
      const tags = getTagsFromNote(this.app, file);
      tags.forEach((tag) => tagSet.add(tag));
    }

    return Array.from(tagSet);
  }

  getItemText(tag: string): string {
    return tag;
  }

  onChooseItem(tag: string, evt: MouseEvent | KeyboardEvent) {
    this.onChooseTag(tag);
  }
}
