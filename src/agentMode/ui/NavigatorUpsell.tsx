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
      <div className="tw-flex tw-flex-col tw-gap-2">
        <p className="tw-m-0">
          Copilot Navigator keeps all your agent chats in one sidebar, so long-running work stays
          easy to find and manage.
        </p>
        <ul className="tw-m-0 tw-flex tw-flex-col tw-gap-1 tw-pl-5">
          <li>See every chat at a glance, grouped into Pinned, Projects and Recents</li>
          <li>Keep each Project&apos;s chats together in its own folder</li>
          <li>Spot which chats are running, waiting for you, or have a new result</li>
          <li>Pin, archive, search and reorder chats without leaving your conversation</li>
        </ul>
      </div>
      <img
        alt="Copilot Navigator scrolling through pinned chats, projects and recent chats"
        className="tw-mx-auto tw-block tw-h-auto tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border"
        height={450}
        src={NAVIGATOR_HIGHLIGHT_GIF_URL}
        width={600}
      />
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
    super(app, "Upgrade to Plus to use Copilot Navigator");
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
