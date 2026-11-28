import * as React from "react";
import { cn } from "@/lib/utils";

interface SettingSwitchProps extends React.HTMLAttributes<HTMLDivElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}

const SettingSwitch = React.forwardRef<HTMLDivElement, SettingSwitchProps>(
  ({ checked = false, onCheckedChange, disabled = false, className, ...props }, ref) => {
    const handleClick = () => {
      if (!disabled) {
        onCheckedChange?.(!checked);
      }
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
      if (disabled) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onCheckedChange?.(!checked);
      }
    };

    return (
      <div
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        data-state={checked ? "checked" : "unchecked"}
        data-disabled={disabled ? "" : undefined}
        ref={ref}
        tabIndex={disabled ? -1 : 0}
        className={cn(
          "tw-relative tw-inline-flex tw-h-[calc(var(--toggle-s-thumb-height)_+_var(--toggle-s-border-width)*2)] tw-w-[var(--toggle-s-width)] tw-shrink-0 tw-cursor-pointer tw-items-center tw-rounded-[var(--toggle-radius)] tw-transition-colors",
          "focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring focus-visible:tw-ring-offset-2",
          checked ? "tw-bg-interactive-accent" : "tw-bg-[--background-modifier-border-hover]",
          disabled && "tw-cursor-not-allowed tw-opacity-50",
          className
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...props}
      >
        <div
          className={cn(
            "tw-pointer-events-none tw-block tw-h-[var(--toggle-s-thumb-height)] tw-w-[var(--toggle-s-thumb-width)] tw-rounded-[var(--toggle-thumb-radius)] tw-bg-toggle-thumb tw-shadow-sm tw-ring-0 tw-transition-transform",
            checked
              ? "tw-translate-x-[calc(var(--toggle-s-width)_-_var(--toggle-s-thumb-width)_-_var(--toggle-s-border-width))]"
              : "tw-translate-x-[var(--toggle-s-border-width)]"
          )}
        />
      </div>
    );
  }
);

SettingSwitch.displayName = "SettingSwitch";

export { SettingSwitch };
