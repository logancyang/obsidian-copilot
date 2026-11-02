import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import { navigateToPlusPage } from "@/plusUtils";
import { openCopilotSettings } from "@/settings/openSettings";
import { ExternalLink } from "lucide-react";
import type { App } from "obsidian";
import * as React from "react";

export const NAVIGATOR_HIGHLIGHT_URL =
  "https://images.brevilabs.com/newsletters/copilot-plugin/navigator/navigator-lift-67838ace.webp";

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
      Already a Supporter? Enter your license key
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
    <div className="tw-flex tw-flex-col tw-gap-4 tw-text-sm">
      <p className="tw-m-0">
        Copilot Navigator keeps all your agent chats in one sidebar, so long-running work stays easy
        to find and manage.
      </p>
      <ul className="tw-m-0 tw-flex tw-flex-col tw-gap-1 tw-pl-5">
        <li>See every chat at a glance, grouped into Pinned, Projects and Recents</li>
        <li>Keep each Project&apos;s chats together in its own folder</li>
        <li>Spot which chats are running, waiting for you, or have a new result</li>
        <li>Pin, archive, search and reorder chats without leaving your conversation</li>
      </ul>
      {/* Width cap keeps the 4:3 animation under 40vh tall so the footer buttons fit short windows: https://github.com/Brevilabs/obsidian-copilot-private/issues/819 */}
      <img
        alt="The Copilot Navigator sidebar lifts out of the Obsidian workspace, fills with pinned chats, projects and recent chats, then a chat finishes and another gets pinned"
        className="tw-mx-auto tw-block tw-h-auto tw-w-full tw-max-w-[calc(40vh*4/3)] tw-rounded-md tw-border tw-border-solid tw-border-border"
        height={900}
        src={NAVIGATOR_HIGHLIGHT_URL}
        width={1200}
      />
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <EnterLicenseKeyButton onOpenSettings={onClose} />
        <Button
          onClick={() => {
            navigateToPlusPage("navigator_dialog");
            onClose();
          }}
        >
          See plans <ExternalLink className="tw-size-4" />
        </Button>
      </div>
    </div>
  );
}

export class NavigatorUpsellModal extends ReactModal {
  constructor(app: App) {
    super(app, "Copilot Navigator is a preview for Supporters");
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
      <p className="tw-m-0 tw-font-semibold">Your preview access ended</p>
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        Copilot Navigator is a preview for Supporters. Your chats are still under Recent chats in
        Agent Chat.
      </p>
      <div className="tw-flex tw-flex-wrap tw-justify-center tw-gap-2">
        <Button onClick={() => navigateToPlusPage("navigator_blocked_view")}>
          See plans <ExternalLink className="tw-size-4" />
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      <EnterLicenseKeyButton />
    </div>
  );
}
