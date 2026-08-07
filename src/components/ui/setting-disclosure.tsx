import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import React from "react";

interface SettingDisclosureProps extends React.ComponentPropsWithoutRef<"button"> {
  /** Whether the disclosed content is showing — drives the chevron and `aria-expanded`. */
  open: boolean;
  /** Row label; defaults to the only one in use today. */
  label?: string;
}

/**
 * Disclosure row for the tail of a `SettingSection` card — the "Advanced" escape
 * hatch that keeps a rarely-touched control out of the default view. It reads as
 * a quiet row of the card, never as a control of its own.
 *
 * Kept as a native `<button>` so it can double as a Radix
 * `CollapsibleTrigger asChild` target. Obsidian styles buttons inside the
 * settings pane through a descendant selector that outranks plain utility
 * classes, so the resets here need `!` — without them the row renders as an OS
 * button box.
 */
export const SettingDisclosure = React.forwardRef<HTMLButtonElement, SettingDisclosureProps>(
  ({ open, label = "Advanced", className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      className={cn(
        "tw-flex tw-w-full tw-cursor-pointer tw-items-center !tw-justify-start tw-gap-1.5",
        "!tw-border-none !tw-bg-transparent !tw-px-0 !tw-py-3 !tw-shadow-none",
        "tw-text-left tw-text-sm tw-font-medium tw-text-muted hover:tw-text-normal",
        className
      )}
      {...props}
    >
      <ChevronRight className={cn("tw-size-3.5 tw-transition-transform", open && "tw-rotate-90")} />
      {label}
    </button>
  )
);
SettingDisclosure.displayName = "SettingDisclosure";
