import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeftRight } from "lucide-react";
import React from "react";

export interface RemoteHeaderProps {
  desktopName: string;
  live: boolean;
  onSwitchDesktop?: () => void;
}

export const RemoteHeader: React.FC<RemoteHeaderProps> = ({
  desktopName,
  live,
  onSwitchDesktop,
}) => (
  <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2 tw-px-3 tw-pt-2">
    <span
      role="img"
      aria-label={live ? "Connected" : "Not connected"}
      className={cn(
        "tw-size-2 tw-shrink-0 tw-rounded-full",
        live ? "tw-bg-modifier-success" : "tw-bg-warning"
      )}
    />
    <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-xs tw-text-muted">{desktopName}</span>
    {onSwitchDesktop && (
      <Button
        size="icon"
        variant="ghost"
        aria-label="Choose another desktop"
        onClick={onSwitchDesktop}
      >
        <ArrowLeftRight className="tw-size-4" />
      </Button>
    )}
  </div>
);
