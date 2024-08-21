import { CopilotSettings } from "@/settings/SettingsPage";
import { App, Modal } from "obsidian";

export class ChatNoteContextModal extends Modal {
  private settings: CopilotSettings;
  private onSubmit: (path: string, tags: string[]) => void;

  constructor(
    app: App,
    settings: CopilotSettings,
    onSubmit: (path: string, tags: string[]) => void
  ) {
    super(app);
    this.settings = settings;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const formContainer = this.contentEl.createEl("div", { cls: "copilot-command-modal" });
    const pathContainer = formContainer.createEl("div", { cls: "copilot-command-input-container" });

    pathContainer.createEl("h3", { text: "Filter by Folder Path", cls: "copilot-command-header" });
    const descFragment = createFragment((frag) => {
      frag.appendText("All notes under the path will be sent to the prompt when the ");
      frag.createEl("strong", { text: "Send Note(s) to Prompt" });
      frag.appendText(" button is clicked in Chat mode. ");
      frag.appendText("If none provided, ");
      frag.createEl("strong", { text: "default context is the active note" });
    });
    pathContainer.appendChild(descFragment);

    const pathField = pathContainer.createEl("input", {
      type: "text",
      cls: "copilot-command-input",
      value: this.settings.chatNoteContextPath,
    });
    pathField.setAttribute("name", "folderPath");

    pathContainer.createEl("h3", { text: "Filter by Tags", cls: "copilot-command-header" });
    const descTagsFragment = createFragment((frag) => {
      frag.createEl("strong", {
        text: "Only tags in note property are used, tags in note content are not used.",
      });
      frag.createEl("p", {
        text: "All notes under the path above are further filtered by the specified tags. If no path is provided, only tags are used. Multiple tags should be separated by commas. ",
      });
      frag.createEl("strong", { text: "Tags function as an OR filter, " });
      frag.appendText(
        " any note that matches one of the tags will be sent to the prompt when button is clicked in Chat mode."
      );
    });
    pathContainer.appendChild(descTagsFragment);

    const tagsField = pathContainer.createEl("input", {
      type: "text",
      cls: "copilot-command-input",
      value: this.settings.chatNoteContextTags.join(","),
    });
    tagsField.setAttribute("name", "tags");

    const submitButtonContainer = formContainer.createEl("div", {
      cls: "copilot-command-save-btn-container",
    });
    const submitButton = submitButtonContainer.createEl("button", {
      text: "Submit",
      cls: "copilot-command-save-btn",
    });

    submitButton.addEventListener("click", () => {
      // Remove the leading slash if it exists
      let pathValue = pathField.value;
      if (pathValue.startsWith("/") && pathValue.length > 1) {
        pathValue = pathValue.slice(1);
      }

      const tagsValue = tagsField.value
        .split(",")
        .map((tag) => tag.trim())
        .map((tag) => tag.toLowerCase())
        .map((tag) => tag.replace("#", ""))
        .filter((tag) => tag !== "");

      this.onSubmit(pathValue, tagsValue);
      this.close();
    });
  }
}
