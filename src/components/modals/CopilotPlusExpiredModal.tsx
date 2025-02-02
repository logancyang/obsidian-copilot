import React from "react";
import { App, Modal } from "obsidian";
import { createRoot } from "react-dom/client";
import { Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { navigateToPlusPage } from "@/plusUtils";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { ExternalLink } from "lucide-react";

function CopilotPlusExpiredModalContent({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p>
        Your Copilot Plus license key is no longer valid. Please renew your subscription to continue
        using Copilot Plus.
      </p>
      <div className="flex gap-2 justify-end w-full">
        <Button variant="ghost" onClick={onCancel}>
          Close
        </Button>
        <Button
          variant="default"
          onClick={() => {
            navigateToPlusPage(PLUS_UTM_MEDIUMS.EXPIRED_MODAL);
          }}
        >
          Renew Now <ExternalLink className="size-4" />
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
