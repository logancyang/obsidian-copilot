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
          "relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          checked ? "bg-interactive-accent" : "bg-[--background-modifier-border-hover]",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...props}
      >
        <div
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-toggle-thumb shadow-lg ring-0 transition-transform",
            checked ? "translate-x-5.5" : "translate-x-0.5"
          )}
        />
      </div>
    );
  }
);

SettingSwitch.displayName = "SettingSwitch";

export { SettingSwitch };
