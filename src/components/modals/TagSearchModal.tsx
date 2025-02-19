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
    // Get all Markdown files in the vault.
    const files = app.vault.getMarkdownFiles();
    const tagSet = new Set<string>();

    // Loop through each file and extract tags.
    for (const file of files) {
      // Retrieve the metadata cache for the file.
      const tags = getTagsFromNote(file);
      tags.forEach((tag) => tagSet.add(tag));
    }

    // Convert the set to an array.
    return Array.from(tagSet);
  }

  getItemText(tag: string): string {
    return tag;
  }

  onChooseItem(tag: string, evt: MouseEvent | KeyboardEvent) {
    this.onChooseTag(tag);
  }
}
