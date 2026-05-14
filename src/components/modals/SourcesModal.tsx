// src/components/SourcesModal.tsx
import { logError } from "@/logger";
import { App, Modal, Setting, TFile } from "obsidian";

export class SourcesModal extends Modal {
  sources: { title: string; path: string; score: number; explanation?: unknown }[];

  constructor(
    app: App,
    sources: { title: string; path: string; score: number; explanation?: unknown }[]
  ) {
    super(app);
    this.sources = sources;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl).setName("Sources").setHeading();

    // Display all sources sorted by score (already sorted from chain)
    this.createSourceList(contentEl, this.sources);
  }

  private createSourceList(
    container: HTMLElement,
    sources: { title: string; path: string; score: number; explanation?: unknown }[]
  ) {
    const list = container.createEl("ul");
    list.addClass("tw-list-none", "tw-p-0");

    sources.forEach((source) => {
      const item = list.createEl("li");
      item.addClass("tw-mb-4");

      // Create collapsible container
      const itemContainer = item.createDiv();
      itemContainer.addClass("tw-cursor-pointer");

      // Add expand/collapse indicator
      const expandIndicator = itemContainer.createSpan();
      expandIndicator.addClass("tw-mr-2", "tw-inline-block", "tw-w-4", "tw-transition-transform");
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
      link.title = `${displayText} - drag to insert wikilink`;
      link.draggable = true;
      link.addEventListener("dragstart", (e) => {
        const filePath = source.path || source.title;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const dragManager = (
            this.app as unknown as {
              dragManager?: {
                dragLink: (e: DragEvent, text: string) => unknown;
                onDragStart: (e: DragEvent, data: unknown) => void;
              };
            }
          ).dragManager;
          if (!dragManager) return;
          const linkText = this.app.metadataCache.fileToLinktext(file, "");
          const dragData = dragManager.dragLink(e, linkText);
          dragManager.onDragStart(e, dragData);
        }
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Use the path if available, otherwise fall back to title
        this.app.workspace.openLinkText(source.path || source.title, "").catch(logError);
      });

      // Display with 4 decimals to match SearchCore logs and avoid apparent ties
      if (typeof source.score === "number") {
        itemContainer.appendChild(
          this.contentEl.doc.createTextNode(` - Relevance score: ${source.score.toFixed(4)}`)
        );
      }

      // Add explanation if available (initially hidden)
      let explanationDiv: HTMLElement | null = null;
      if (source.explanation) {
        explanationDiv = this.addExplanation(item, source.explanation);
        explanationDiv.addClass("tw-hidden"); // Initially collapsed

        // Toggle expansion on click
        itemContainer.addEventListener("click", (e) => {
          if (e.target === link) return; // Don't toggle when clicking the link

          if (explanationDiv) {
            const isExpanded = !explanationDiv.hasClass("tw-hidden");
            explanationDiv.toggleClass("tw-hidden", isExpanded);
            expandIndicator.toggleClass("tw-rotate-90", !isExpanded);
          }
        });
      }
    });
  }

  private addExplanation(container: HTMLElement, explanation: unknown): HTMLElement {
    const explanationDiv = container.createDiv({ cls: "search-explanation" });
    explanationDiv.addClass(
      "tw-ml-[2.5em]",
      "tw-mt-2",
      "tw-pl-2",
      "tw-text-[0.9em]",
      "tw-text-muted",
      "tw-border-l",
      "tw-border-l-border"
    );

    // Cast to a typed record for safe property access
    const exp = explanation as Record<string, unknown>;
    const details: string[] = [];

    // Add lexical matches
    if (exp.lexicalMatches && (exp.lexicalMatches as unknown[]).length > 0) {
      const lexicalMatches = exp.lexicalMatches as { field: string; query: string }[];
      const fields = new Set(lexicalMatches.map((m) => m.field));
      const queries = new Set(lexicalMatches.map((m) => m.query));
      details.push(
        `Lexical: matched "${Array.from(queries).join('", "')}" in ${Array.from(fields).join(", ")}`
      );
    }

    // Add semantic score
    if (exp.semanticScore !== undefined && (exp.semanticScore as number) > 0) {
      details.push(`Semantic: ${((exp.semanticScore as number) * 100).toFixed(1)}% similarity`);
    }

    // Add folder boost
    if (exp.folderBoost) {
      const fb = exp.folderBoost as { boostFactor: number; documentCount: number; folder?: string };
      details.push(
        `Folder boost: ${fb.boostFactor.toFixed(2)}x (${fb.documentCount} docs in ${fb.folder || "root"})`
      );
    }

    // Add graph connections (new query-aware boost)
    if (exp.graphConnections) {
      const gc = exp.graphConnections as {
        backlinks: number;
        coCitations: number;
        sharedTags: number;
        score: number;
      };
      const connectionParts: string[] = [];
      if (gc.backlinks > 0) connectionParts.push(`${gc.backlinks} backlinks`);
      if (gc.coCitations > 0) connectionParts.push(`${gc.coCitations} co-citations`);
      if (gc.sharedTags > 0) connectionParts.push(`${gc.sharedTags} shared tags`);

      if (connectionParts.length > 0) {
        details.push(
          `Graph connections: ${gc.score.toFixed(1)} score (${connectionParts.join(", ")})`
        );
      }
    }

    // Add old graph boost (if still present for backwards compatibility)
    if (exp.graphBoost && !exp.graphConnections) {
      const gb = exp.graphBoost as { boostFactor: number; connections: number };
      details.push(`Graph boost: ${gb.boostFactor.toFixed(2)}x (${gb.connections} connections)`);
    }

    // Add base vs final score if boosted
    if (exp.baseScore !== exp.finalScore) {
      details.push(
        `Score: ${(exp.baseScore as number).toFixed(4)} → ${(exp.finalScore as number).toFixed(4)}`
      );
    }

    // Create explanation text without "Why this ranked here:" header
    if (details.length > 0) {
      details.forEach((detail) => {
        const detailDiv = explanationDiv.createEl("div");
        detailDiv.addClass("tw-mb-1");
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
