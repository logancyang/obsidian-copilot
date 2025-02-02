import React from "react";
import { App, Modal } from "obsidian";
import { createRoot } from "react-dom/client";
import { Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { switchToPlusModels } from "@/plusUtils";

function CopilotPlusWelcomeModalContent({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p>
          Thanks for purchasing <b>Copilot Plus</b>! You have unlocked the full power of Copilot,
          featuring chat context, PDF and image support, exclusive chat and embedding models, and
          much more!
        </p>
        <p>
          Would you like to switch to the exclusive models now? You can always change this later in
          Settings.
        </p>
      </div>
      <div className="flex gap-2 justify-end w-full">
        <Button variant="ghost" onClick={onCancel}>
          Switch Later
        </Button>
        <Button variant="default" onClick={onConfirm}>
          Switch Now
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
    this.setTitle("Welcome to Copilot Plus 🚀");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleConfirm = () => {
      switchToPlusModels();
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
