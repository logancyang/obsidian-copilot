import * as React from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface FollowUpInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
  hint?: string;
  autoFocus?: boolean;
}

export function FollowUpInput({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder = "Enter follow-up instructions...",
  className,
  hint,
  autoFocus = false,
}: FollowUpInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = e.nativeEvent as KeyboardEvent & {
      isComposing?: boolean;
    };
    if (nativeEvent.isComposing || e.key === "Process") {
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!onSubmit) return;
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={cn("tw-relative tw-flex-none tw-px-4 tw-py-2", className)}>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="tw-min-h-[36px] tw-resize-none tw-py-2 tw-pr-8"
      />
      {hint && (
        <span className="tw-pointer-events-none tw-absolute tw-bottom-4 tw-right-6 tw-text-xs tw-text-muted">
          {hint}
        </span>
      )}
      {value && onClear && !hint && (
        <Button
          type="button"
          variant="ghost2"
          size="fit"
          onClick={onClear}
          className="tw-absolute tw-right-6 tw-top-4 tw-text-muted"
          aria-label="Clear input"
        >
          <X className="tw-size-4" />
        </Button>
      )}
    </div>
  );
}
