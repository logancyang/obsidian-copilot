import { TruncatedText } from "@/components/TruncatedText";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import React from "react";

interface ContextChipProps {
  /** Pre-sized lucide icon (e.g. `<Folder className="tw-size-3.5" />`). */
  icon: React.ReactNode;
  /** Theme color class for the icon, e.g. `tw-text-context-manager-yellow`. */
  colorClass: string;
  label: string;
  /** Tooltip shown on the (truncated) label; defaults to the label text. */
  tooltip?: string;
  /** When provided, a hover-revealed X removes the chip. */
  onRemove?: () => void;
  /** Dim the chip (design's collapsed-overflow hint). */
  dim?: boolean;
}

/**
 * One context source rendered as the design's square 8px-radius bordered chip
 * (NOT the pill `Badge` the CAG `ProjectContextBadgeList` uses — that component
 * is shared with the legacy CAG modal and must keep its look). Folder / tag /
 * file / web / youtube all share this atom, differing only by `icon`+`colorClass`,
 * so the agent landing's mixed file+URL row reads as one consistent set.
 */
export function ContextChip({ icon, colorClass, label, tooltip, onRemove, dim }: ContextChipProps) {
  return (
    <span
      className={cn(
        "tw-inline-flex tw-max-w-[175px] tw-items-center tw-gap-1.5 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-2 tw-py-1 tw-text-xs",
        dim && "tw-opacity-45"
      )}
    >
      <span className={cn("tw-flex tw-shrink-0 tw-items-center", colorClass)}>{icon}</span>
      <TruncatedText className="tw-min-w-0" tooltipContent={tooltip ?? label}>
        {label}
      </TruncatedText>
      {onRemove && (
        <X
          className="tw-size-3.5 tw-shrink-0 tw-cursor-pointer tw-text-faint hover:tw-text-normal"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        />
      )}
    </span>
  );
}
