import { App, Modal, Notice, Setting } from "obsidian";
import CopilotPlugin from "../../main";

export class OramaSearchModal extends Modal {
  plugin: CopilotPlugin;
  query = "";
  textWeight = 0.5;
  vectorWeight = 0.5;
  salientTerms = "";

  constructor(app: App, plugin: CopilotPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "CopilotDB Search" });

    new Setting(contentEl).setName("Search query").addText((text) =>
      text.onChange((value) => {
        this.query = value;
      })
    );

    new Setting(contentEl).setName("Text weight (0-1)").addText((text) =>
      text.setValue("0.5").onChange((value) => {
        this.textWeight = parseFloat(value);
      })
    );

    new Setting(contentEl).setName("Salient terms (space-separated)").addText((text) =>
      text.onChange((value) => {
        this.salientTerms = value;
      })
    );

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Search")
        .setCta()
        .onClick(() => this.performSearch())
    );
  }

  async performSearch() {
    if (!this.query || isNaN(this.textWeight) || isNaN(this.vectorWeight)) {
      new Notice("Please enter valid search parameters.");
      return;
    }

    const salientTerms = this.salientTerms.split(" ").map((term) => term.trim());

    const results = await this.plugin.customSearchDB(this.query, salientTerms, this.textWeight);

    this.close();
    new SearchResultsModal(this.app, results).open();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class SearchResultsModal extends Modal {
  results: any[];

  constructor(app: App, results: any[]) {
    super(app);
    this.results = results;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Search Results" });

    const resultsList = contentEl.createEl("ul");
    this.results.forEach((result) => {
      const listItem = resultsList.createEl("li");
      listItem.createEl("strong", { text: result.metadata.title });
      listItem.createEl("p", { text: result.content });
      listItem.createEl("p", { text: `Score: ${result.metadata.score}` });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
