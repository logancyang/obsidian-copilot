import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { t } from "@/i18n";
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
      t("settings.reset.confirmation", {
        advancedSettings: t("settings.tabs.advanced"),
        apiKeyStorage: "API Key Storage",
        deleteAllKeys: "Delete All Keys",
      }),
      t("settings.reset.action"),
      t("settings.actions.continue"),
      t("settings.actions.cancel")
    );
  }
}
