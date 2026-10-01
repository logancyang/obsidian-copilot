import { Label } from "@/components/ui/label";
import { ChevronDown } from "lucide-react";
import React from "react";

export interface CommandModelSelectProps {
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

export function CommandModelSelect({ value, options, onChange }: CommandModelSelectProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <Label htmlFor="modelKey">Model (Optional)</Label>
      <div className="tw-group tw-relative tw-w-full">
        <select
          id="modelKey"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="tw-flex tw-h-9 tw-w-full tw-appearance-none tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-3 tw-py-1 tw-pr-8 tw-text-sm tw-shadow tw-transition-colors hover:tw-bg-interactive-hover hover:tw-text-normal focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
        >
          <option value="">Default model</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-pr-2 tw-transition-colors group-hover:[&>svg]:tw-text-normal">
          <ChevronDown className="tw-size-4" />
        </div>
      </div>
    </div>
  );
}
