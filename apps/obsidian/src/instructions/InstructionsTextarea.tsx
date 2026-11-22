import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import React from "react";

export interface InstructionsTextareaProps {
  value: string;
  onChange: (next: string) => void;
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
