import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { App } from "obsidian";

export class ResetSettingsConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void | Promise<void>) {
    super(
      app,
      onConfirm,
      "Resetting settings will restore the default values. API keys are kept. " +
        "Are you sure you want to continue?",
      "Reset Settings"
    );
  }
}
