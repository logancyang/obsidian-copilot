import { App } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";

export class SwitchEmbeddingConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void) {
    super(
      app,
      onConfirm,
      "Changing the embedding model means you have to rebuild the index for your entire vault, do you wish to proceed?",
      "Change Embedding Model"
    );
  }
}
