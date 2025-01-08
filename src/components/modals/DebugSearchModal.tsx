import CopilotPlugin from "@/main";
import { search } from "@orama/orama";
import { App, Modal, Notice, TFile } from "obsidian";

export class DebugSearchModal extends Modal {
  private plugin: CopilotPlugin;
  private searchInput: HTMLTextAreaElement;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Debug: Search OramaDB" });

    // Add description
    const descEl = contentEl.createEl("p");
    descEl.innerHTML =
      'Enter a JSON search params object. Example:<br><pre>{<br>  "term": "#tag",<br>  "mode": "hybrid",<br>  "limit": 10,<br>  "includeVectors": true<br>}</pre>';

    // Create textarea
    this.searchInput = contentEl.createEl("textarea", {
      attr: {
        placeholder: "Enter search params JSON...",
        rows: "10",
        style:
          "width: 100%; min-height: 200px; margin: 10px 0; padding: 10px; font-family: monospace;",
      },
    });

    // Create button container
    const buttonContainer = contentEl.createEl("div", {
      cls: "search-button-container",
    });

    // Add search button
    const searchButton = buttonContainer.createEl("button", {
      text: "Search",
      cls: "mod-cta",
    });

    searchButton.addEventListener("click", async () => {
      try {
        const searchParams = JSON.parse(this.searchInput.value);

        // Convert vector object to array if needed
        if (searchParams.vector?.value && !Array.isArray(searchParams.vector.value)) {
          searchParams.vector.value = Object.values(searchParams.vector.value);
        }

        const db = await this.plugin.vectorStoreManager.getDb();
        if (!db) {
          new Notice("Database not found");
          return;
        }

        const searchResults = await search(db, searchParams);

        // Create content for the results file
        const content = [
          "## Search Parameters",
          "```json",
          JSON.stringify(searchParams, null, 2),
          "```",
          "",
          "## Results",
          `Total hits: ${searchResults.hits.length}`,
          "",
          "### Hits",
          "```json",
          JSON.stringify(searchResults.hits, null, 2),
          "```",
        ].join("\n");

        // Create or update the file
        const fileName = `OramaDB-Debug-Search.md`;

        const existingFile = this.app.vault.getAbstractFileByPath(fileName);
        if (existingFile instanceof TFile) {
          await this.app.vault.modify(existingFile, content);
        } else {
          await this.app.vault.create(fileName, content);
        }

        // Open the file
        const file = this.app.vault.getAbstractFileByPath(fileName);
        if (file instanceof TFile) {
          await this.app.workspace.getLeaf().openFile(file);
          this.close();
        }
      } catch (error) {
        console.error("Error in debug search:", error);
        new Notice("Error executing search. Check console for details.");
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
