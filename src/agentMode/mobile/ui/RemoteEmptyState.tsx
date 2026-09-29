import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import React from "react";

export interface RemoteEmptyStateProps {
  desktopName: string;
  creating: boolean;
  onStart: () => void;
}

export const RemoteEmptyState: React.FC<RemoteEmptyStateProps> = ({
  desktopName,
  creating,
  onStart,
}) => (
  <div className="tw-flex tw-size-full tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-p-6 tw-text-center">
    <h2 className="tw-m-0 tw-max-w-xs tw-text-base tw-font-medium tw-text-normal">
      No agent sessions are open on {desktopName}
    </h2>
    <p className="tw-m-0 tw-max-w-xs tw-text-sm tw-text-muted">
      Start one here. Pick the agent, model and effort from the message box.
    </p>
    <Button onClick={onStart} disabled={creating}>
      {creating && <Loader2 aria-hidden="true" className="tw-size-4 tw-animate-spin" />}
      Start a session
    </Button>
  </div>
);
