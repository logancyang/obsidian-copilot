import { HelpTooltip } from "@/components/ui/help-tooltip";
import { cn } from "@/lib/utils";
import type { Destination } from "@/types/destination";
import { Cloud, Lock, Monitor } from "lucide-react";
import React from "react";

const ICONS = { lock: Lock, cloud: Cloud, local: Monitor } as const;

interface DestinationIconProps {
  destination: Destination;
  note?: string;
  className?: string;
}

// Settings name where each provider sends requests, so nothing new shows in the chat.
// https://github.com/logancyang/obsidian-copilot/issues/2889
export function DestinationIcon({ destination, note, className }: DestinationIconProps) {
  const Icon = ICONS[destination.kind];
  const content = note ? `${destination.label}\n${note}` : destination.label;
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-muted", className)}
    >
      <HelpTooltip
        content={content}
        side="top"
        delayDuration={0}
        contentClassName="tw-whitespace-pre-line"
      >
        <Icon className="tw-size-3.5" />
      </HelpTooltip>
      <span className="tw-sr-only">Sends requests to: {content}</span>
    </span>
  );
}
