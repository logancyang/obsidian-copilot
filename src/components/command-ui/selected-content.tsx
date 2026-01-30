import * as React from "react";
import { cn } from "@/lib/utils";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface SelectedContentProps {
  content: string;
  className?: string;
}

/**
 * Displays selected context with multi-line truncation (up to 3 lines).
 * Hover or focus the Eye icon on the right to view full content in a tooltip.
 * On mobile, click the Eye icon to toggle the tooltip.
 */
export function SelectedContent({ content, className }: SelectedContentProps) {
  if (!content) return null;

  return (
    <div
      className={cn(
        // Use tw-items-start so Eye icon aligns with first line when content spans multiple lines
        "tw-group tw-flex tw-w-full tw-items-start tw-gap-2",
        "tw-border-b tw-border-border tw-bg-secondary/30",
        "tw-px-4 tw-py-2",
        className
      )}
    >
      {/* Truncated content (up to 3 lines) */}
      <span className="tw-line-clamp-2 tw-min-w-0 tw-flex-1 tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-text-muted">
        {content}
      </span>

      {/* Eye icon with tooltip - visible on hover/focus, always visible on touch devices */}
      <div className="tw-group-hover:tw-opacity-100 tw-group-focus-within:tw-opacity-100 tw-flex-none tw-opacity-30 tw-transition-opacity">
        <HelpTooltip
          content={content}
          side="left"
          contentClassName="tw-max-h-64 tw-max-w-xs tw-overflow-y-auto tw-whitespace-pre-wrap"
        >
          <Button type="button" variant="ghost2" size="fit" aria-label="View full content">
            <Eye className="tw-size-4 tw-text-muted" />
          </Button>
        </HelpTooltip>
      </div>
    </div>
  );
}
