import React from "react";
import { App, Modal } from "obsidian";
import { Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { logError } from "@/logger";
import { applyLicenseSettings } from "@/plusUtils";

export interface CopilotPlusWelcomeModalContentProps {
  onConfirm: () => void;
  onCancel: () => void;
  modelName: string;
}

/** Body of {@link CopilotPlusWelcomeModal}, exported prop-driven so the gallery can render it. */
export function CopilotPlusWelcomeModalContent({
  onConfirm,
  onCancel,
  modelName,
}: CopilotPlusWelcomeModalContentProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div>
        <p>
          Thanks for purchasing! Your license includes Copilot exclusive models, cross-agent skills,
          access to the <a href="https://symposium.md">symposium.md</a> doc sharing service, and
          much more!
        </p>
        <p>
          Would you like to make <b className="tw-text-accent">{modelName}</b> the default model for
          chat and your agents now? You can always change this later in Settings.
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

/** Hosts the post-license default offer for one server-selected Plus model. */
export class CopilotPlusWelcomeModal extends Modal {
  private root: Root;
  private readonly modelId: string;
  private readonly modelName: string;

  constructor(app: App, modelId: string, modelName: string) {
    super(app);
    this.modelId = modelId;
    this.modelName = modelName;
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Welcome to Copilot 🚀");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createPluginRoot(contentEl, this.app);

    const handleConfirm = () => {
      void applyLicenseSettings(this.modelId).catch((error) =>
        logError("Failed to apply the licensed default model", error)
      );
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <CopilotPlusWelcomeModalContent
        modelName={this.modelName}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
