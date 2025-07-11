import React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  label: string;
  value: string;
}

interface ObsidianNativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
}

export function ObsidianNativeSelect({
  options,
  placeholder,
  containerClassName,
  className,
  ...props
}: ObsidianNativeSelectProps) {
  return (
    <div className={cn("tw-group tw-relative tw-w-full", containerClassName)}>
      <select
        className={cn(
          "tw-w-full tw-appearance-none",
          "tw-flex tw-h-9 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-3 tw-py-1 tw-pr-8",
          "tw-text-sm tw-shadow tw-transition-colors",
          "focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring",
          "disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
          "hover:tw-bg-interactive-hover hover:tw-text-normal",
          className
        )}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div
        className={cn(
          "tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-pr-2",
          "tw-transition-colors group-hover:[&>svg]:tw-text-normal",
          props.disabled && "tw-opacity-50"
        )}
      >
        <ChevronDown className="tw-size-4" />
      </div>
    </div>
  );
}
