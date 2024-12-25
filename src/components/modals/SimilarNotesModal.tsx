import { Result } from "@orama/orama";
import { InternalTypedDocument } from "@orama/orama";
import { App, Modal, TFile } from "obsidian";

export class SimilarNotesModal extends Modal {
  private hits: Result<InternalTypedDocument<any>>[];

  constructor(app: App, hits: Result<InternalTypedDocument<any>>[]) {
    super(app);
    this.hits = hits;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Similar Note Blocks to Current Note" });

    const containerEl = contentEl.createEl("ul", { cls: "similar-notes-container" });
    this.hits.forEach((item) => {
      const itemEl = containerEl.createEl("li", { cls: "similar-note-item" });

      // Create a clickable title
      const titleEl = itemEl.createEl("a", {
        text: `${item.document.title} (Score: ${item.score.toFixed(2)})`,
        cls: "similar-note-title",
      });

      titleEl.addEventListener("click", (event) => {
        event.preventDefault();
        this.navigateToNote(item.document.path);
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private navigateToNote(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf) {
        leaf.openFile(file).then(() => {
          this.close();
        });
      }
    }
  }
}
