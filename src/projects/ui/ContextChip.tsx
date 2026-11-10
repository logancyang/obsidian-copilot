import { TruncatedText } from "@/components/TruncatedText";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import React from "react";

interface ContextChipProps {
  icon: React.ReactNode;
  colorClass: string;
  label: string;
  tooltip?: string;
  onRemove?: () => void;
  dim?: boolean;
}

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
