import React from "react";
import { App, Modal } from "obsidian";
import { createRoot } from "react-dom/client";
import { Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_COPILOT_PLUS_CHAT_MODEL,
  DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL,
  DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY,
  applyPlusSettings,
} from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { TriangleAlert } from "lucide-react";

function CopilotPlusWelcomeModalContent({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const settings = getSettings();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p>
          Thanks for purchasing <b>Copilot Plus</b>! You have unlocked the full power of Copilot,
          featuring chat context, PDF and image support, exclusive chat and embedding models, and
          much more!
        </p>
        <p>
          Would you like to apply the Copilot Plus settings now? You can always change this later in
          Settings.
        </p>
        <ul className="pl-4">
          <li>
            Default mode: <b className="text-accent">Copilot Plus</b>
          </li>
          <li>
            Chat model: <b className="text-accent">{DEFAULT_COPILOT_PLUS_CHAT_MODEL}</b>
          </li>
          <li>
            <div>
              Embedding model: <b className="text-accent">{DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL}</b>
            </div>
            {settings.embeddingModelKey !== DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY && (
              <div className="text-sm text-warning flex items-center gap-1">
                <TriangleAlert className="size-4" /> It will rebuild your embeddings for the entire
                vault
              </div>
            )}
          </li>
        </ul>
      </div>
      <div className="flex gap-2 justify-end w-full">
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
    this.setTitle("Welcome to Copilot Plus 🚀");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleConfirm = () => {
      applyPlusSettings();
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
