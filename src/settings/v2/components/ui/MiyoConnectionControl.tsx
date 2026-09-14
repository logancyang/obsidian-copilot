import { Button } from "@/components/ui/button";
import { TriangleAlert } from "lucide-react";
import React from "react";

export interface MiyoConnectionControlProps {
  checking: boolean;
  onDisconnect: () => void;
  onRetry: () => void;
}

export interface MiyoAvailabilityNoticeProps {
  enabled: boolean;
  available: boolean;
  checking: boolean;
}

/**
 * Explains why Miyo-backed settings are unavailable and how to recover them.
 */
export const MiyoAvailabilityNotice: React.FC<MiyoAvailabilityNoticeProps> = ({
  enabled,
  available,
  checking,
}) => {
  // A probe in flight is neither connected nor unavailable. Showing the
  // unavailable warning while the control reads "Checking…" would give the user
  // two contradictory verdicts about the same endpoint.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/356
  if (available || checking) return null;

  return (
    <div className="tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2.5 tw-text-left tw-text-xs tw-text-normal">
      <TriangleAlert className="tw-size-4 tw-shrink-0 tw-text-warning" />
      <span className="tw-min-w-0 tw-flex-1">
        {enabled
          ? "Miyo is unavailable. Check your server, then retry the connection above."
          : "Connect to Miyo to configure these capabilities."}
      </span>
    </div>
  );
};

/** Actions for the selected active connection; endpoint status belongs to its option. */
export const MiyoConnectionControl: React.FC<MiyoConnectionControlProps> = ({
  checking,
  onDisconnect,
  onRetry,
}) => (
  <div className="tw-flex tw-w-full tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
    <Button
      variant="secondary"
      size="sm"
      className="tw-shadow-none"
      onClick={onRetry}
      disabled={checking}
    >
      Check connection
    </Button>
    <Button
      variant="secondary"
      size="sm"
      className="tw-shadow-none"
      onClick={onDisconnect}
      disabled={checking}
    >
      Disconnect
    </Button>
  </div>
);
