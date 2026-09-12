import React from "react";
import { App, Modal } from "obsidian";
import { Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { isUsingLicensedModels, navigateToPlusPage } from "@/plusUtils";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { ExternalLink } from "lucide-react";
import { openCopilotSettings } from "@/settings/openSettings";
import { getSettings } from "@/settings/model";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

export interface CopilotPlusExpiredModalContentProps {
  onCancel: () => void;
  onOpenModelSettings: () => void;
  /** Whether current model selections include a licensed Copilot model. */
  isUsingPlusModels: boolean;
}

/** Body of {@link CopilotPlusExpiredModal}, exported prop-driven so the gallery can render both states. */
export function CopilotPlusExpiredModalContent({
  onCancel,
  onOpenModelSettings,
  isUsingPlusModels,
}: CopilotPlusExpiredModalContentProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-col tw-gap-2">
        <div>
          Your Copilot Plus license key is no longer valid. Renew to use Copilot Plus again.
        </div>
        {isUsingPlusModels && (
          <div className="tw-text-sm tw-text-warning">
            Your selected Copilot models are unavailable without an active license.
          </div>
        )}
        <div className="tw-text-sm tw-text-muted">
          You can choose a supported model from your own provider or a local service instead. Set it
          up first if needed, then select it in model settings.
        </div>
      </div>
      <div className="tw-flex tw-w-full tw-flex-wrap tw-justify-end tw-gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Close
        </Button>
        <Button variant="secondary" onClick={onOpenModelSettings}>
          Open model settings
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
    this.root = createPluginRoot(contentEl, this.app);

    const handleCancel = () => {
      this.close();
    };

    const handleOpenModelSettings = () => {
      const ownerWindow = contentEl.win;
      this.close();
      openCopilotSettings(this.app, ownerWindow, "basic");
    };

    this.root.render(
      <CopilotPlusExpiredModalContent
        onCancel={handleCancel}
        onOpenModelSettings={handleOpenModelSettings}
        isUsingPlusModels={isUsingLicensedModels(getSettings())}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
