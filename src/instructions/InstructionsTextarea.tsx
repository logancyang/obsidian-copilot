import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import React from "react";

export interface InstructionsTextareaProps {
  /** Current instruction text. */
  value: string;
  onChange: (next: string) => void;
  /**
   * Accessible name for the editor. Its hosts render the visible title as plain text rather
   * than a `<label>`, so without this the field reaches a screen reader unnamed.
   */
  label: string;
  className?: string;
}

export const InstructionsTextarea: React.FC<InstructionsTextareaProps> = ({
  value,
  onChange,
  label,
  className,
}) => {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      placeholder="e.g. Put new notes you create in Inbox/ and link them to a related note."
      className={cn("tw-min-h-32 tw-w-full", className)}
    />
  );
};
