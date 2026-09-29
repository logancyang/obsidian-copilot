import { describeBanner } from "@/agentMode/mobile/ui/remoteCopy";
import type { RemoteBanner } from "@/agentMode/mobile/remoteStatus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, WifiOff } from "lucide-react";
import React from "react";

export interface RemoteConnectionBannerProps {
  banner: RemoteBanner;
  desktopName: string;
  onRetry: () => void;
}

export const RemoteConnectionBanner: React.FC<RemoteConnectionBannerProps> = ({
  banner,
  desktopName,
  onRetry,
}) => (
  <div
    role="status"
    className={cn(
      "tw-flex tw-shrink-0 tw-items-center tw-gap-2 tw-border-b tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-1.5 tw-text-xs",
      banner === "reconnecting" ? "tw-text-muted" : "tw-text-normal"
    )}
  >
    {banner === "reconnecting" ? (
      <Loader2 aria-hidden="true" className="tw-size-3.5 tw-shrink-0 tw-animate-spin" />
    ) : (
      <WifiOff aria-hidden="true" className="tw-size-3.5 tw-shrink-0 tw-text-error" />
    )}
    <span className="tw-min-w-0 tw-flex-1 tw-break-words">
      {describeBanner(banner, desktopName)}
    </span>
    {banner !== "reconnecting" && (
      <Button size="sm" variant="ghost" onClick={onRetry}>
        Retry
      </Button>
    )}
  </div>
);
