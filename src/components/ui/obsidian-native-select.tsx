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
    <div className={cn("relative w-full group", containerClassName)}>
      <select
        className={cn(
          "w-full appearance-none",
          "flex h-9 rounded-md border border-solid border-border bg-dropdown px-3 py-1 pr-8",
          "text-sm !shadow transition-colors",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "hover:bg-interactive-hover hover:text-normal",
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
          "pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2",
          "transition-colors group-hover:[&>svg]:text-normal",
          props.disabled && "opacity-50"
        )}
      >
        <ChevronDown className="h-4 w-4" />
      </div>
    </div>
  );
}
