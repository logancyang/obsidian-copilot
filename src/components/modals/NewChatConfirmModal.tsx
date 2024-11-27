import { App, Modal } from "obsidian";

export class NewChatConfirmModal extends Modal {
  private onConfirm: () => void;

  constructor(app: App, onConfirm: () => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Start New Chat" });

    const warningText = contentEl.createEl("p");
    warningText.appendChild(
      document.createTextNode(
        "Starting a new chat will clear the current chat history. Any unsaved messages will be lost."
      )
    );

    const buttonContainer = contentEl.createEl("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "space-between";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.marginTop = "20px";

    const confirmButton = buttonContainer.createEl("button", {
      text: "Continue",
    });
    confirmButton.style.padding = "8px 16px";
    confirmButton.style.borderRadius = "4px";
    confirmButton.style.cursor = "pointer";
    confirmButton.style.minWidth = "100px";
    confirmButton.style.backgroundColor = "var(--interactive-accent)";
    confirmButton.style.color = "var(--text-on-accent)";
    confirmButton.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.style.padding = "8px 16px";
    cancelButton.style.borderRadius = "4px";
    cancelButton.style.cursor = "pointer";
    cancelButton.style.minWidth = "100px";
    cancelButton.addEventListener("click", () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
