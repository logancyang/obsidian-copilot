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
      <div>
        <p>
          Thanks for purchasing! You have unlocked the full power of Copilot, featuring chat
          context, PDF and image support, exclusive chat and embedding models, and much more!
        </p>
        <p>
          Would you like to make <b className="tw-text-accent">{DEFAULT_COPILOT_PLUS_CHAT_MODEL}</b>{" "}
          the default model for chat and your agents now? You can always change this later in
          Settings.
        </p>
      </div>
      <div className="tw-flex tw-w-full tw-justify-end tw-gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Apply Later
        </Button>
        <Button variant="default" onClick={onConfirm}>
          Apply Now
        </Button>
      </div>
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
