import { Label } from "@/components/ui/label";
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
      <select
        id="modelKey"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tw-h-9 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-3 tw-py-1 tw-text-sm"
      >
        <option value="">Default model</option>
        {/* Preserve a removed selection until the user changes it. https://github.com/Brevilabs/obsidian-copilot-private/issues/616 */}
        {value && !options.some((option) => option.value === value) && (
          <option value={value}>Unavailable model</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
