import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { App } from "obsidian";

export class ResetSettingsConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void | Promise<void>) {
    super(
      app,
      onConfirm,
      "Resetting settings will clear all settings and restore the default values. " +
        'API keys are not cleared by this action — use "Delete All Keys" in Advanced Settings ' +
        "→ API Key Storage if you also want to remove them. Are you sure you want to continue?",
      "Reset Settings"
    );
  }
}
