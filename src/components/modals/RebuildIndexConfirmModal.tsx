import { App } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";

export class RebuildIndexConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void) {
    super(
      app,
      onConfirm,
      "Changing this setting means you have to rebuild the index for your entire vault, do you wish to proceed?",
      "Rebuild Index"
    );
  }
}
