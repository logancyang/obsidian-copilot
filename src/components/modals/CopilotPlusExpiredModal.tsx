import React from "react";
import { App, Modal } from "obsidian";
import { createRoot } from "react-dom/client";
import { Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { isPlusModel, navigateToPlusPage } from "@/plusUtils";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { ExternalLink } from "lucide-react";
import { getSettings } from "@/settings/model";

function CopilotPlusExpiredModalContent({ onCancel }: { onCancel: () => void }) {
  const settings = getSettings();
  const isUsingPlusModels =
    isPlusModel(settings.defaultModelKey) && isPlusModel(settings.embeddingModelKey);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-col tw-gap-2">
        <div>
          Your Copilot Plus license key is no longer valid. Please renew your subscription to
          continue using Copilot Plus.
        </div>
        {isUsingPlusModels && (
          <div className="tw-text-sm tw-text-warning">
            The Copilot Plus exclusive models will stop working. You can switch to the default
            models in the Settings.
          </div>
        )}
      </div>
      <div className="tw-flex tw-w-full tw-justify-end tw-gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Close
        </Button>
        <Button
          variant="default"
          onClick={() => {
            navigateToPlusPage(PLUS_UTM_MEDIUMS.EXPIRED_MODAL);
          }}
        >
          Renew Now <ExternalLink className="tw-size-4" />
        </Button>
      </div>
    </div>
  );
}

export class CopilotPlusExpiredModal extends Modal {
  private root: Root;

  constructor(app: App) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Thanks for being a Copilot Plus user 👋");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleCancel = () => {
      this.close();
    };

    this.root.render(<CopilotPlusExpiredModalContent onCancel={handleCancel} />);
  }

  onClose() {
    this.root.unmount();
  }
}
