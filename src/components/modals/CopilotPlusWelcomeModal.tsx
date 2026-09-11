import React from "react";
import { App, Modal } from "obsidian";
import { Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { logError } from "@/logger";
import { DEFAULT_COPILOT_PLUS_CHAT_MODEL, applyLicenseSettings } from "@/plusUtils";

export interface CopilotPlusWelcomeModalContentProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/** Body of {@link CopilotPlusWelcomeModal}, exported prop-driven so the gallery can render it. */
export function CopilotPlusWelcomeModalContent({
  onConfirm,
  onCancel,
}: CopilotPlusWelcomeModalContentProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <p className="tw-m-0">
        Make{" "}
        <span className="tw-font-semibold tw-text-normal">{DEFAULT_COPILOT_PLUS_CHAT_MODEL}</span>{" "}
        the default for chat and compatible agents. This also updates current chats. You can change
        these defaults in Settings.
      </p>
      <div className="tw-flex tw-w-full tw-flex-wrap tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Keep current defaults
        </Button>
        <Button variant="default" onClick={onConfirm}>
          Use {DEFAULT_COPILOT_PLUS_CHAT_MODEL}
        </Button>
      </div>
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        Your license includes Copilot exclusive models, cross-agent skills, and{" "}
        <a href="https://openartifacts.ai">OpenArtifacts</a> document sharing.
      </p>
    </div>
  );
}

export class CopilotPlusWelcomeModal extends Modal {
  private root: Root;

  constructor(app: App) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Welcome to Copilot 🚀");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createPluginRoot(contentEl, this.app);

    const handleConfirm = () => {
      void applyLicenseSettings().catch((error) =>
        logError("Failed to apply the licensed default model", error)
      );
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <CopilotPlusWelcomeModalContent onConfirm={handleConfirm} onCancel={handleCancel} />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
