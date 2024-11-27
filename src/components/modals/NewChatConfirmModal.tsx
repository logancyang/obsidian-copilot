import { App } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";

export class NewChatConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void) {
    super(
      app,
      onConfirm,
      "Starting a new chat will clear the current chat history. Any unsaved messages will be lost. Are you sure you want to continue?",
      "Start New Chat"
    );
  }
}
