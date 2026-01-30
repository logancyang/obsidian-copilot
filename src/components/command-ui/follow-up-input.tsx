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
  showClear?: boolean;
  disabled?: boolean;
  /** Hint text shown on the right side of the input (e.g., "Generating...") */
  hint?: string;
  /** Auto-focus the input on mount */
  autoFocus?: boolean;
}

/**
 * Text input for follow-up instructions or questions.
 * Supports Enter to submit and shows a clear button when content exists.
 */
export function FollowUpInput({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder = "Enter follow-up instructions...",
  className,
  showClear = true,
  disabled = false,
  hint,
  autoFocus = false,
}: FollowUpInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Avoid submitting when Enter is used to confirm IME composition (e.g., Chinese/Japanese/Korean).
    // keyCode 229 is a legacy indicator for IME processing.
    const nativeEvent = e.nativeEvent as KeyboardEvent & {
      isComposing?: boolean;
      keyCode?: number;
    };
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Only prevent default and submit if onSubmit is provided
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
        disabled={disabled}
        autoFocus={autoFocus}
        className="tw-min-h-[36px] tw-resize-none tw-py-2 tw-pr-8"
      />
      {/* Hint text (e.g., "Generating...") - pointer-events-none to not block textarea clicks */}
      {hint && (
        <span className="tw-pointer-events-none tw-absolute tw-bottom-4 tw-right-6 tw-text-xs tw-text-muted">
          {hint}
        </span>
      )}
      {showClear && value && onClear && !hint && (
        <Button
          type="button"
          variant="ghost2"
          size="fit"
          onClick={onClear}
          disabled={disabled}
          className="tw-absolute tw-right-6 tw-top-4 tw-text-muted"
          aria-label="Clear input"
        >
          <X className="tw-size-4" />
        </Button>
      )}
    </div>
  );
}
