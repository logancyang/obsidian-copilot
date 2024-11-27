import { Document } from "@langchain/core/documents";
import { App, Modal, TFile } from "obsidian";

interface SimilarNoteChunk {
  chunk: Document;
  score: number;
}

export class SimilarNotesModal extends Modal {
  private similarChunks: SimilarNoteChunk[];

  constructor(app: App, similarChunks: SimilarNoteChunk[]) {
    super(app);
    this.similarChunks = similarChunks;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Similar Note Blocks to Current Note" });

    const containerEl = contentEl.createEl("div", { cls: "similar-notes-container" });
    this.similarChunks.forEach((item) => {
      const itemEl = containerEl.createEl("div", { cls: "similar-note-item" });

      // Create a collapsible section
      const collapseEl = itemEl.createEl("details");
      const summaryEl = collapseEl.createEl("summary");

      // Create a clickable title
      const titleEl = summaryEl.createEl("a", {
        text: `${item.chunk.metadata.title} (Score: ${item.score.toFixed(2)})`,
        cls: "similar-note-title",
      });

      titleEl.addEventListener("click", (event) => {
        event.preventDefault();
        this.navigateToNote(item.chunk.metadata.path);
      });

      // Create the content (initially hidden)
      const contentEl = collapseEl.createEl("p");
      contentEl.setText(this.cleanChunkContent(item.chunk.pageContent));
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

  private cleanChunkContent(content: string): string {
    // Remove the "[[title]] --- " part at the beginning of the chunk
    return content.replace(/^\[\[.*?\]\]\s*---\s*/, "");
  }
}
