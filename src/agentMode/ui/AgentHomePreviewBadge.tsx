import { badgeVariants } from "@/components/ui/badge";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { useIsPreviewEnabled } from "@/plusUtils";
import { openCopilotSettings } from "@/settings/openSettings";
import * as React from "react";

export interface PreviewBadgeProps {
  onOpen: (ownerWindow: Window) => void;
}

interface AgentHomePreviewBadgeProps {
  visible: boolean;
}

export function PreviewBadge({ onOpen }: PreviewBadgeProps): React.ReactElement {
  return (
    <button
      aria-label="Copilot Preview is on. Open the release channel switch."
      className={cn(
        badgeVariants({ variant: "accent" }),
        "tw-absolute tw-right-2 tw-top-2 tw-z-cover tw-h-auto tw-cursor-pointer tw-border-none tw-shadow-none"
      )}
      onClick={(event) => onOpen(event.currentTarget.win)}
      type="button"
    >
      Preview
    </button>
  );
}

export function AgentHomePreviewBadge({
  visible,
}: AgentHomePreviewBadgeProps): React.ReactElement | null {
  const app = useApp();
  const previewEnabled = useIsPreviewEnabled();
  if (!visible || !previewEnabled) return null;

  return <PreviewBadge onOpen={(ownerWindow) => openCopilotSettings(app, ownerWindow, "basic")} />;
}
