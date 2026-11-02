import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import { navigateToPlusPage } from "@/plusUtils";
import { openCopilotSettings } from "@/settings/openSettings";
import { ExternalLink } from "lucide-react";
import type { App } from "obsidian";
import * as React from "react";

export const NAVIGATOR_HIGHLIGHT_GIF_URL =
  "https://images.brevilabs.com/newsletters/copilot-plugin/navigator/navigator-highlight-819ce1d0.gif";

interface EnterLicenseKeyButtonProps {
  onOpenSettings?: () => void;
}

function EnterLicenseKeyButton({ onOpenSettings }: EnterLicenseKeyButtonProps): React.ReactElement {
  const app = useApp();
  return (
    <Button
      variant="secondary"
      className="tw-h-auto tw-min-h-9 tw-whitespace-normal"
      onClick={(event) => {
        const ownerWindow = event.currentTarget.win;
        onOpenSettings?.();
        openCopilotSettings(app, ownerWindow, "basic");
      }}
    >
      Already have Plus? Enter your license key
    </Button>
  );
}

export interface NavigatorUpsellContentProps {
  onClose: () => void;
}

export function NavigatorUpsellContent({
  onClose,
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
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <EnterLicenseKeyButton onOpenSettings={onClose} />
        <Button
          onClick={() => {
            navigateToPlusPage("navigator_dialog");
            onClose();
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
    return <NavigatorUpsellContent onClose={close} />;
  }
}

export interface NavigatorBlockedNoticeProps {
  onClose: () => void;
}

export function NavigatorBlockedNotice({
  onClose,
}: NavigatorBlockedNoticeProps): React.ReactElement {
  return (
    <div className="tw-flex tw-h-full tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-p-4 tw-text-center">
      <p className="tw-m-0 tw-font-semibold">Your Copilot Plus subscription ended</p>
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        Renew to get Copilot Navigator back. Your chats are still under Recent chats in Agent Chat.
      </p>
      <div className="tw-flex tw-flex-wrap tw-justify-center tw-gap-2">
        <Button onClick={() => navigateToPlusPage("navigator_blocked_view")}>
          Renew Plus <ExternalLink className="tw-size-4" />
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      <EnterLicenseKeyButton />
    </div>
  );
}
