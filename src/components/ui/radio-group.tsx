import * as React from "react";
import { cn } from "@/lib/utils";

interface RadioGroupProps {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

interface RadioGroupItemProps {
  value: string;
  className?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}

const RadioGroupContext = React.createContext<{
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}>({});

const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ className, value, onValueChange, disabled, children, ...props }, ref) => {
    return (
      <RadioGroupContext.Provider value={{ value, onChange: onValueChange, disabled }}>
        <div ref={ref} role="radiogroup" className={cn("tw-grid tw-gap-2", className)} {...props}>
          {children}
        </div>
      </RadioGroupContext.Provider>
    );
  }
);
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = React.forwardRef<HTMLButtonElement, RadioGroupItemProps>(
  ({ className, value, disabled, children, ...props }, ref) => {
    const context = React.useContext(RadioGroupContext);
    const isChecked = context.value === value;
    const isDisabled = disabled || context.disabled;

    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={isChecked}
        disabled={isDisabled}
        onClick={() => !isDisabled && context.onChange?.(value)}
        className={cn(
          "tw-border-primary tw-aspect-square tw-size-4 tw-rounded-full tw-border",
          "tw-ring-offset-background",
          "focus:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring focus-visible:tw-ring-offset-2",
          "disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
          "tw-relative tw-inline-flex tw-items-center tw-justify-center",
          className
        )}
        {...props}
      >
        {isChecked && <span className="tw-absolute tw-size-2.5 tw-rounded-full tw-bg-primary" />}
        {children}
      </button>
    );
  }
);
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
