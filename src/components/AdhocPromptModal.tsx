import { App, Modal } from "obsidian";

export class AdhocPromptModal extends Modal {
  result: string;
  onSubmit: (result: string) => void;

  private placeholderText = "Please enter your custom ad-hoc prompt here, press enter to send.";

  constructor(app: App, onSubmit: (result: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;

    const promptDescFragment = createFragment((frag) => {
      frag.createEl("strong", { text: "- {} represents the selected text (not required). " });
      frag.createEl("br");
      frag.createEl("strong", { text: "- {[[Note Title]]} represents a note. " });
      frag.createEl("br");
      frag.createEl("strong", { text: "- {activeNote} represents the active note. " });
      frag.createEl("br");
      frag.createEl("strong", { text: "- {FolderPath} represents a folder of notes. " });
      frag.createEl("br");
      frag.createEl("strong", {
        text: "- {#tag1, #tag2} represents ALL notes with ANY of the specified tags in their property (an OR operation). ",
      });
      frag.createEl("br");
      frag.createEl("br");
      frag.appendText("Tip: turn on debug mode to show the processed prompt in the chat window.");
      frag.createEl("br");
      frag.createEl("br");
    });
    contentEl.appendChild(promptDescFragment);

    const textareaEl = contentEl.createEl("textarea", {
      attr: { placeholder: this.placeholderText },
    });
    textareaEl.style.width = "100%";
    textareaEl.style.height = "100px"; // Set the desired height
    textareaEl.style.padding = "10px";
    textareaEl.style.resize = "vertical"; // Allow vertical resizing

    textareaEl.addEventListener("input", (evt) => {
      this.result = (evt.target as HTMLTextAreaElement).value;
    });

    textareaEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault(); // Prevent line break unless Shift key is pressed
        this.close();
        this.onSubmit(this.result);
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
