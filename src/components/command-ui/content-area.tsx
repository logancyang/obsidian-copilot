import * as React from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

type ContentState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "result"; text: string; isStreaming?: boolean };

interface ContentAreaProps {
  state: ContentState;
  editable?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  /**
   * When true, uses a native <textarea> (no auto-grow) so the surrounding panel can control height.
   * This avoids changing the shared Textarea component behavior.
   */
  disableAutoGrow?: boolean;
}

/**
 * Content area for AI responses - always uses Textarea for consistent UI.
 * States:
 * - idle: Empty disabled Textarea with placeholder
 * - loading: Disabled Textarea showing "loading..."
 * - streaming: Disabled Textarea showing streaming content
 * - result: Enabled Textarea (editable) showing final content
 */
export function ContentArea({
  state,
  editable = false,
  value,
  onChange,
  placeholder = "Ready to generate...",
  className,
  minHeight = "180px",
  disableAutoGrow = false,
}: ContentAreaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when streaming
  React.useEffect(() => {
    if (state.type === "result" && state.isStreaming && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [state]);

  // Determine display value and disabled state based on content state
  let displayValue = "";
  let isDisabled = true;

  if (state.type === "idle") {
    displayValue = "";
    isDisabled = true;
  } else if (state.type === "loading") {
    displayValue = "loading...";
    isDisabled = true;
  } else if (state.type === "result") {
    // Use editable value if provided and not streaming, otherwise use state.text
    displayValue = editable && value !== undefined ? value : state.text;
    // Disabled during streaming, enabled when done (if editable)
    isDisabled = state.isStreaming || !editable;
  }

  // When disableAutoGrow is true, use native textarea with flex-1 to fill available space
  if (disableAutoGrow) {
    return (
      <div className={cn("tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-px-4 tw-py-2", className)}>
        <textarea
          ref={textareaRef}
          value={displayValue}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={isDisabled}
          className={cn(
            "tw-min-w-fit tw-overflow-auto tw-border-solid",
            "tw-min-h-0 tw-w-full tw-flex-1 tw-resize-none tw-rounded-md tw-border tw-bg-transparent tw-px-3 tw-py-2 tw-text-base tw-shadow-sm placeholder:tw-text-muted focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring disabled:tw-cursor-not-allowed disabled:tw-opacity-50 md:tw-text-sm",
            isDisabled && "tw-cursor-default tw-opacity-70"
          )}
        />
      </div>
    );
  }

  return (
    <div className={cn("tw-flex-1 tw-px-4 tw-py-2", className)}>
      <Textarea
        ref={textareaRef}
        value={displayValue}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={isDisabled}
        className={cn(
          "tw-min-h-[120px] tw-resize-y",
          isDisabled && "tw-cursor-default tw-opacity-70"
        )}
        style={{ minHeight }}
      />
    </div>
  );
}

export type { ContentState };
