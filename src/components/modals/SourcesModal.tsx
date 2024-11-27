// src/components/SourcesModal.tsx
import { CONTEXT_SCORE_THRESHOLD } from "@/constants";
import { App, Modal } from "obsidian";

export class SourcesModal extends Modal {
  sources: { title: string; score: number }[];

  constructor(app: App, sources: { title: string; score: number }[]) {
    super(app);
    this.sources = sources;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Sources" });

    const highScoreSources = this.sources.filter(
      (source) => source.score >= CONTEXT_SCORE_THRESHOLD
    );
    const lowScoreSources = this.sources.filter((source) => source.score < CONTEXT_SCORE_THRESHOLD);

    if (highScoreSources.length > 0) {
      contentEl.createEl("h3", { text: "High Relevance Sources" });
      this.createSourceList(contentEl, highScoreSources);
    }

    if (lowScoreSources.length > 0) {
      contentEl.createEl("h3", { text: "Lower Relevance Sources" });
      this.createSourceList(contentEl, lowScoreSources);
    }
  }

  private createSourceList(container: HTMLElement, sources: { title: string; score: number }[]) {
    const list = container.createEl("ul");
    list.style.listStyleType = "none";
    list.style.padding = "0";

    sources.forEach((source) => {
      const item = list.createEl("li");
      item.style.marginBottom = "1em";

      const link = item.createEl("a", {
        href: `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(source.title)}`,
        text: source.title,
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.app.workspace.openLinkText(source.title, "");
      });
      if (source.score && source.score <= 1) {
        item.appendChild(document.createTextNode(` - Relevance score: ${source.score.toFixed(3)}`));
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
