import { App } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";

export class ApplyChangesConfirmModal extends ConfirmModal {
  constructor(app: App, unDecidedChanges: number, onConfirm: () => void) {
    super(
      app,
      onConfirm,
      `There are ${unDecidedChanges} changes that have not been decided. Are you sure you want to skip these changes?`,
      "Apply Changes",
      "Confirm",
      "Back to Edit"
    );
  }
}
