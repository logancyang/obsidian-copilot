import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { App } from "obsidian";

export class ResetSettingsConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void | Promise<void>) {
    super(
      app,
      onConfirm,
      "Resetting settings will restore the default values. Your API keys are kept, along with " +
        'the provider and model entries needed to use them — use "Delete All Keys" in Advanced ' +
        "Settings → API Key Storage if you also want to remove them. " +
        "Are you sure you want to continue?",
      "Reset Settings"
    );
  }
}
