import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { navigateToPlusPage } from "@/plusUtils";
import { ExternalLink } from "lucide-react";
import type { App } from "obsidian";
import * as React from "react";

export const NAVIGATOR_HIGHLIGHT_GIF_URL =
  "https://images.brevilabs.com/newsletters/copilot-plugin/navigator/navigator-highlight-819ce1d0.gif";

export interface NavigatorUpsellContentProps {
  onUpgrade: () => void;
}

export function NavigatorUpsellContent({
  onUpgrade,
}: NavigatorUpsellContentProps): React.ReactElement {
  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <img
        alt="Copilot Navigator scrolling through pinned chats, projects and recent chats"
        className="tw-mx-auto tw-block tw-h-auto tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border"
        height={450}
        src={NAVIGATOR_HIGHLIGHT_GIF_URL}
        width={600}
      />
      <p className="tw-m-0">
        Navigator gives you a more flexible way to manage your long sessions, available for Plus
        users.
      </p>
      <div className="tw-flex tw-justify-end">
        <Button
          onClick={() => {
            navigateToPlusPage("navigator_dialog");
            onUpgrade();
          }}
        >
          Upgrade to Plus <ExternalLink className="tw-size-4" />
        </Button>
      </div>
    </div>
  );
}

export class NavigatorUpsellModal extends ReactModal {
  constructor(app: App) {
    super(app, "Copilot Navigator is a Plus feature");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <NavigatorUpsellContent onUpgrade={close} />;
  }
}

export function NavigatorBlockedNotice(): React.ReactElement {
  return (
    <div className="tw-flex tw-h-full tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-p-4 tw-text-center">
      <p className="tw-m-0 tw-font-semibold">Copilot Navigator is for Plus users only</p>
      <Button onClick={() => navigateToPlusPage("navigator_blocked_view")}>
        Upgrade to Plus <ExternalLink className="tw-size-4" />
      </Button>
    </div>
  );
}
