// src/components/SourcesModal.tsx
import { App, Modal } from "obsidian";

export class SourcesModal extends Modal {
  sources: { title: string; path: string; score: number; explanation?: any }[];

  constructor(
    app: App,
    sources: { title: string; path: string; score: number; explanation?: any }[]
  ) {
    super(app);
    this.sources = sources;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Sources" });

    // Display all sources sorted by score (already sorted from chain)
    this.createSourceList(contentEl, this.sources);
  }

  private createSourceList(
    container: HTMLElement,
    sources: { title: string; path: string; score: number; explanation?: any }[]
  ) {
    const list = container.createEl("ul");
    list.style.listStyleType = "none";
    list.style.padding = "0";

    sources.forEach((source) => {
      const item = list.createEl("li");
      item.style.marginBottom = "1em";

      // Create collapsible container
      const itemContainer = item.createDiv();
      itemContainer.style.cursor = "pointer";

      // Add expand/collapse indicator
      const expandIndicator = itemContainer.createSpan();
      expandIndicator.style.marginRight = "0.5em";
      expandIndicator.style.display = "inline-block";
      expandIndicator.style.width = "1em";
      expandIndicator.style.transition = "transform 0.2s";
      expandIndicator.textContent = source.explanation ? "▶" : "";

      // Display title, but show path in parentheses if there are duplicates
      const displayText =
        source.path && source.path !== source.title
          ? `${source.title} (${source.path})`
          : source.title;

      const link = itemContainer.createEl("a", {
        href: `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(source.path || source.title)}`,
        text: displayText,
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Use the path if available, otherwise fall back to title
        this.app.workspace.openLinkText(source.path || source.title, "");
      });

      // Display with 4 decimals to match SearchCore logs and avoid apparent ties
      if (typeof source.score === "number") {
        itemContainer.appendChild(
          document.createTextNode(` - Relevance score: ${source.score.toFixed(4)}`)
        );
      }

      // Add explanation if available (initially hidden)
      let explanationDiv: HTMLElement | null = null;
      if (source.explanation) {
        explanationDiv = this.addExplanation(item, source.explanation);
        explanationDiv.style.display = "none"; // Initially collapsed

        // Toggle expansion on click
        itemContainer.addEventListener("click", (e) => {
          if (e.target === link) return; // Don't toggle when clicking the link

          if (explanationDiv) {
            const isExpanded = explanationDiv.style.display !== "none";
            explanationDiv.style.display = isExpanded ? "none" : "block";
            expandIndicator.style.transform = isExpanded ? "" : "rotate(90deg)";
          }
        });
      }
    });
  }

  private addExplanation(container: HTMLElement, explanation: any): HTMLElement {
    const explanationDiv = container.createDiv({ cls: "search-explanation" });
    explanationDiv.style.marginTop = "0.5em";
    explanationDiv.style.marginLeft = "2.5em";
    explanationDiv.style.fontSize = "0.9em";
    explanationDiv.style.color = "var(--text-muted)";
    explanationDiv.style.borderLeft = "2px solid var(--background-modifier-border)";
    explanationDiv.style.paddingLeft = "0.5em";

    const details: string[] = [];

    // Add lexical matches
    if (explanation.lexicalMatches && explanation.lexicalMatches.length > 0) {
      const fields = new Set(explanation.lexicalMatches.map((m: any) => m.field));
      const queries = new Set(explanation.lexicalMatches.map((m: any) => m.query));
      details.push(
        `Lexical: matched "${Array.from(queries).join('", "')}" in ${Array.from(fields).join(", ")}`
      );
    }

    // Add semantic score
    if (explanation.semanticScore !== undefined && explanation.semanticScore > 0) {
      details.push(`Semantic: ${(explanation.semanticScore * 100).toFixed(1)}% similarity`);
    }

    // Add folder boost
    if (explanation.folderBoost) {
      details.push(
        `Folder boost: ${explanation.folderBoost.boostFactor.toFixed(2)}x (${explanation.folderBoost.documentCount} docs in ${explanation.folderBoost.folder || "root"})`
      );
    }

    // Add graph boost
    if (explanation.graphBoost) {
      details.push(
        `Graph boost: ${explanation.graphBoost.boostFactor.toFixed(2)}x (${explanation.graphBoost.connections} connections)`
      );
    }

    // Add base vs final score if boosted
    if (explanation.baseScore !== explanation.finalScore) {
      details.push(
        `Score: ${explanation.baseScore.toFixed(4)} → ${explanation.finalScore.toFixed(4)}`
      );
    }

    // Create explanation text without "Why this ranked here:" header
    if (details.length > 0) {
      details.forEach((detail) => {
        const detailDiv = explanationDiv.createEl("div");
        detailDiv.style.marginBottom = "0.25em";
        detailDiv.textContent = `• ${detail}`;
      });
    }

    return explanationDiv;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
