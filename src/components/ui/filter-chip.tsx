import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import React from "react";

export interface FilterChipProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed"
> {
  pressed: boolean;
  count?: number;
}

/** Theme-native toggle chip whose state remains visible without relying on color alone. */
export function FilterChip({
  pressed,
  count,
  className,
  children,
  type = "button",
  ...props
}: FilterChipProps) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={pressed}
      className={cn(
        "tw-m-0 tw-inline-flex tw-h-7 tw-shrink-0 tw-items-center tw-gap-1 tw-whitespace-nowrap tw-rounded-full tw-border tw-border-solid tw-px-2.5 tw-py-0 tw-text-xs tw-font-medium tw-shadow-none tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
        pressed
          ? "!tw-border-interactive-accent !tw-bg-interactive-accent !tw-text-on-accent hover:!tw-bg-interactive-accent-hover"
          : "!tw-border-border !tw-bg-transparent tw-text-muted hover:!tw-bg-modifier-hover hover:tw-text-normal",
        className
      )}
    >
      {pressed && <Check aria-hidden="true" className="tw-size-3" />}
      <span>{children}</span>
      {count !== undefined && (
        <span className={cn("tw-tabular-nums", pressed ? "tw-opacity-75" : "tw-text-faint")}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}
