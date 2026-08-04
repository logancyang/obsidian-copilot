import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { App } from "obsidian";

export class ResetSettingsConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void | Promise<void>) {
    super(
      app,
      onConfirm,
      // Reason: "clear all settings" was true only while reset also destroyed
      // credentials. Now that keys and the rows addressing them survive, the
      // claim is dropped rather than replaced with a list of what resets —
      // reset fans out through settings subscribers (Copilot Plus, Agent Mode
      // setup, per-agent model enrollment), so any such list goes stale.
      "Resetting settings will restore the default values. " +
        'API keys are not cleared by this action — use "Delete All Keys" in Advanced Settings ' +
        "→ API Key Storage if you also want to remove them. Are you sure you want to continue?",
      "Reset Settings"
    );
  }
}
