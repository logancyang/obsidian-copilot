import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CapabilityStatus } from "@/miyo/miyoStatusStore";
import { Circle, TriangleAlert } from "lucide-react";
import React from "react";

export interface MiyoConnectionControlProps {
  enabled: boolean;
  status: CapabilityStatus;
  checking: boolean;
  remote: boolean;
  onConnect: () => void;
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
  if (available || checking) return null;

  return (
    <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2.5 tw-text-xs tw-text-normal">
      <TriangleAlert className="tw-size-4 tw-shrink-0 tw-text-warning" />
      {enabled
        ? "Miyo is unavailable. Open it, then retry the connection above."
        : "Connect to Miyo to configure these capabilities."}
    </div>
  );
};

/**
 * Shows Miyo connection intent and reachability without reading plugin state.
 */
export const MiyoConnectionControl: React.FC<MiyoConnectionControlProps> = ({
  enabled,
  status,
  checking,
  remote,
  onConnect,
  onDisconnect,
  onRetry,
}) => {
  if (!enabled) {
    return (
      <Button variant="secondary" size="sm" onClick={onConnect} disabled={checking}>
        {checking ? "Connecting…" : "Connect"}
      </Button>
    );
  }

  const connected = status === "available" || status === "stale";
  const label = checking
    ? "Checking…"
    : connected
      ? `Connected · ${remote ? "remote" : "local"}`
      : "Unavailable";

  // Connection intent survives a failed health check. Keep both recovery paths
  // visible so a user can retry the same endpoint or disconnect without running
  // the enable flow again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/356
  return (
    <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
      <span
        role="status"
        className="tw-inline-flex tw-shrink-0 tw-items-center tw-gap-1.5 tw-rounded-full tw-bg-secondary tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-normal"
      >
        <Circle
          className={cn(
            "tw-size-1.5 tw-shrink-0 tw-fill-current",
            checking ? "tw-text-muted" : connected ? "tw-text-success" : "tw-text-warning"
          )}
        />
        {label}
      </span>
      {!checking && !connected && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
      {!checking && (
        <Button variant="secondary" size="sm" onClick={onDisconnect}>
          Disconnect
        </Button>
      )}
    </div>
  );
};
