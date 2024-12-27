import { RelevantNoteEntry } from "@/search/findRelevantNotes";
import { App, Modal, TFile } from "obsidian";

export class SimilarNotesModal extends Modal {
  private similarNotes: RelevantNoteEntry[];

  constructor(app: App, similarNotes: RelevantNoteEntry[]) {
    super(app);
    this.similarNotes = similarNotes;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Relevant Notes" });

    const containerEl = contentEl.createEl("ul", { cls: "similar-notes-container" });
    this.similarNotes.forEach((item) => {
      const itemEl = containerEl.createEl("li", { cls: "similar-note-item" });
      const similarityScore = item.metadata.similarityScore;
      const metadataTexts = [
        similarityScore == null
          ? "Similarity: Unknown (no index)"
          : `Similarity: ${Math.round(similarityScore * 100)}%`,
      ];
      if (item.metadata.hasOutgoingLinks) {
        metadataTexts.push("Link");
      }
      if (item.metadata.hasBacklinks) {
        metadataTexts.push("Backlink");
      }

      // Create a clickable title
      const titleEl = itemEl.createEl("a", {
        text: `${item.document.title}`,
        cls: "similar-note-title",
      });

      titleEl.addEventListener("click", (event) => {
        event.preventDefault();
        this.navigateToNote(item.document.path);
      });

      const pathEl = itemEl.createEl("div", {
        text: `${item.document.path}`,
      });
      pathEl.style.fontSize = "0.8em";
      pathEl.style.color = "var(--text-muted)";

      const relevanceScoreEl = itemEl.createEl("div", {
        text: `${metadataTexts.join(" | ")}`,
      });
      relevanceScoreEl.style.fontSize = "0.8em";
      relevanceScoreEl.style.color = "var(--text-faint)";
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
