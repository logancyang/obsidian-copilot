import { App } from "obsidian";
import { ConfirmModal } from "./ConfirmModal";
import { t } from "@/i18n";

export class SemanticSearchToggleModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void | Promise<void>, enabling: boolean) {
    const content = enabling
      ? t("settings.advanced.semanticSearch.enableDescription")
      : t("settings.advanced.semanticSearch.disableDescription");

    const title = enabling
      ? t("settings.advanced.semanticSearch.enableTitle")
      : t("settings.advanced.semanticSearch.disableTitle");
    const confirmButtonText = enabling
      ? t("settings.actions.enable")
      : t("settings.actions.disable");

    super(app, onConfirm, content, title, confirmButtonText, t("settings.actions.cancel"));
  }
}
