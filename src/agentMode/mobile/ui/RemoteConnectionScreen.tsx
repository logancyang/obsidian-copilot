import { describeScreen } from "@/agentMode/mobile/ui/remoteCopy";
import type { RemoteScreen } from "@/agentMode/mobile/remoteStatus";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2 } from "lucide-react";
import React from "react";

export interface RemoteConnectionScreenProps {
  screen: RemoteScreen;
  desktopName: string;
  onRetry: () => void;
  onSwitchDesktop?: () => void;
}

export const RemoteConnectionScreen: React.FC<RemoteConnectionScreenProps> = ({
  screen,
  desktopName,
  onRetry,
  onSwitchDesktop,
}) => {
  const copy = describeScreen(screen, desktopName);
  return (
    <div
      role={copy.tone === "error" ? "alert" : "status"}
      className="tw-flex tw-size-full tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-p-6 tw-text-center"
    >
      {copy.busy ? (
        <Loader2 aria-hidden="true" className="tw-size-6 tw-animate-spin tw-text-muted" />
      ) : (
        <AlertCircle aria-hidden="true" className="tw-size-6 tw-text-error" />
      )}
      <h2 className="tw-m-0 tw-max-w-xs tw-text-base tw-font-medium tw-text-normal">
        {copy.title}
      </h2>
      <p className="tw-m-0 tw-max-w-xs tw-select-text tw-text-sm tw-text-muted">{copy.detail}</p>
      {copy.canRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
      {onSwitchDesktop && (
        <Button variant="ghost" onClick={onSwitchDesktop}>
          Choose another desktop
        </Button>
      )}
    </div>
  );
};
