import CopilotPlugin from "@/main";
import { extractNoteFiles } from "@/utils";
import { App, Modal, Notice, TFile } from "obsidian";

export class OramaSearchModal extends Modal {
  private plugin: CopilotPlugin;
  private searchInput: HTMLTextAreaElement;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Inspect Copilot Index by Note Paths" });

    // Create textarea instead of input for multiline support
    this.searchInput = contentEl.createEl("textarea", {
      attr: {
        placeholder: "Enter note paths as markdown list:\n- [[Note 1]]\n- [[Note 2]]",
        rows: "10",
        style:
          "width: 100%; min-height: 200px; margin: 10px 0; padding: 10px; font-family: monospace;",
      },
    });

    const buttonContainer = contentEl.createEl("div", { cls: "search-button-container" });

    const searchButton = buttonContainer.createEl("button", {
      text: "Show Index Data",
      cls: "mod-cta",
    });

    searchButton.addEventListener("click", async () => {
      const input = this.searchInput.value;
      const notePaths = extractNoteFiles(input, this.app.vault).map((file) => file.path);

      if (notePaths.length === 0) {
        new Notice("No valid note paths found. Use format: - [[Note Name]]");
        return;
      }

      try {
        const dbOps = await this.plugin.vectorStoreManager.getDbOps();
        const results = await dbOps.getDocsJsonByPaths(notePaths);

        // Create or overwrite file with results
        const fileName = `CopilotDB-Search-Results.md`;
        const content = [
          "## Searched Paths",
          ...notePaths.map((path) => `- [[${path}]]`),
          "",
          "## Index Data",
          "```json",
          JSON.stringify(results, null, 2),
          "```",
        ].join("\n");

        // Check if file exists and modify it, otherwise create new
        const existingFile = this.app.vault.getAbstractFileByPath(fileName);
        if (existingFile) {
          await this.app.vault.modify(existingFile as TFile, content);
        } else {
          await this.app.vault.create(fileName, content);
        }

        // Open the file
        const file = this.app.vault.getAbstractFileByPath(fileName);
        if (file) {
          await this.app.workspace.getLeaf().openFile(file as TFile);
        }

        this.close();
      } catch (error) {
        console.error("Error searching DB:", error);
        new Notice("Error searching database. Check console for details.");
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
