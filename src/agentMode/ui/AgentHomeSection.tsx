import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { Plus } from "lucide-react";
import React, { memo } from "react";

interface AgentHomeCreateRowProps {
  label: string;
  onClick: (anchor: HTMLElement) => void;
}

export const AgentHomeCreateRow = memo(function AgentHomeCreateRow({
  label,
  onClick,
}: AgentHomeCreateRowProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost2"
      onClick={(e) => onClick(e.currentTarget)}
      aria-label={label}
      className="tw-h-auto tw-min-h-9 tw-w-full tw-justify-start tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5 hover:tw-bg-modifier-hover"
    >
      <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-interactive-accent-hsl/10">
        <Plus className="tw-size-4 tw-text-accent" />
      </span>
      <span className="tw-text-ui-small tw-font-medium tw-text-accent">{label}</span>
    </Button>
  );
});

interface AgentHomeListRowProps {
  label: string;
  timeMs: number;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  trailing?: React.ReactNode;
}

export const AgentHomeListRow = memo(function AgentHomeListRow({
  label,
  timeMs,
  onClick,
  icon: Icon,
  trailing,
}: AgentHomeListRowProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "tw-group tw-flex tw-min-h-9 tw-w-full tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5",
        "tw-text-left tw-transition-colors hover:tw-bg-modifier-hover"
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {Icon && (
        <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center">
          <Icon className="tw-size-4 tw-text-muted" />
        </span>
      )}
      <span
        className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal"
        title={label}
      >
        {label}
      </span>
      <span
        className={cn(
          "tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted",
          trailing && "group-focus-within:tw-hidden group-hover:tw-hidden"
        )}
        title={new Date(timeMs).toLocaleString()}
      >
        {formatCompactRelativeTime(timeMs)}
      </span>
      {trailing && (
        <span
          className="tw-hidden tw-shrink-0 tw-items-center group-focus-within:tw-flex group-hover:tw-flex"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {trailing}
        </span>
      )}
    </div>
  );
});

interface AgentHomePreviewListProps {
  children: React.ReactNode;
}

export function AgentHomePreviewList({ children }: AgentHomePreviewListProps): React.ReactElement {
  return (
    // Radix overlays its scrollbar; the gutter keeps row actions readable.
    // https://github.com/logancyang/obsidian-copilot/issues/3017
    <ScrollArea className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-pr-2.5">
      {children}
    </ScrollArea>
  );
}
