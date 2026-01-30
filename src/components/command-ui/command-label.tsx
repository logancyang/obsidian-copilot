import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandLabelProps {
  /** Icon to display. Pass null to hide icon, undefined for default icon. */
  icon?: React.ReactNode | null;
  label: string;
  className?: string;
}

/**
 * Displays the command name/label with an optional icon.
 * Used as a header in MenuCommandModal.
 */
export function CommandLabel({ icon, label, className }: CommandLabelProps) {
  // P0 Fix: null means no icon, undefined means default icon
  const iconElement =
    icon === null ? null : icon !== undefined ? (
      icon
    ) : (
      <Pencil className="tw-size-4 tw-text-muted" />
    );

  return (
    <div
      className={cn(
        "tw-flex tw-flex-none tw-items-center tw-justify-center tw-gap-2",
        "tw-px-4 tw-py-2",
        className
      )}
    >
      {iconElement}
      <span className="tw-truncate tw-text-sm tw-font-medium tw-text-normal">{label}</span>
    </div>
  );
}
