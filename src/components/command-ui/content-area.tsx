import * as React from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { PencilLine, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "./markdown-preview";

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
  /**
   * Optional callback to render markdown content into a DOM element.
   * When provided, completed (non-streaming) content shows a rendered
   * preview instead of a plain textarea. The user can toggle to edit mode.
   *
   * Reason: ContentArea stays Obsidian-agnostic; the parent provides
   * the rendering logic (e.g., MarkdownRenderer + preprocessAIResponse).
   */
  renderMarkdown?: (content: string, el: HTMLElement) => Promise<void>;
}

/**
 * Content area for AI responses.
 * Supports two display modes for completed results:
 * - Textarea (default, always used when renderMarkdown is not provided)
 * - Markdown preview (when renderMarkdown is provided and not in edit mode)
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
  renderMarkdown,
}: ContentAreaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [isEditMode, setIsEditMode] = React.useState(false);

  // Determine if we should show the markdown preview
  const isCompletedResult = state.type === "result" && !state.isStreaming;
  const showPreview = !!renderMarkdown && isCompletedResult && !isEditMode;

  // Reason: Reset to preview mode whenever a new generation starts.
  // This covers both type transitions (idle→loading) and same-type transitions
  // (result→result with isStreaming flipping true for follow-up generation).
  const isGenerating = state.type === "loading" || (state.type === "result" && state.isStreaming);
  React.useEffect(() => {
    if (isGenerating) {
      setIsEditMode(false);
    }
  }, [isGenerating]);

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
    displayValue = editable && value !== undefined ? value : state.text;
    isDisabled = state.isStreaming || !editable;
  }

  // Markdown preview mode
  if (showPreview && renderMarkdown) {
    const previewContent =
      editable && value !== undefined ? value : (state as { text: string }).text;
    return (
      <div className={cn("tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-px-4 tw-py-2", className)}>
        <div className="tw-relative tw-min-h-0 tw-flex-1 tw-overflow-auto tw-rounded-md tw-border tw-border-solid tw-px-3 tw-py-2">
          <MarkdownPreview
            content={previewContent}
            renderMarkdown={renderMarkdown}
            className="tw-pr-6 tw-text-sm"
          />
          {editable && (
            <Button
              variant="ghost2"
              size="icon"
              className="tw-absolute tw-right-1 tw-top-1 tw-size-6 tw-opacity-60 hover:tw-opacity-100"
              onClick={() => setIsEditMode(true)}
              title="Edit content"
            >
              <PencilLine className="tw-size-3" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Reason: Show "Preview" button only when user is in edit mode and
  // renderMarkdown is available, allowing them to switch back to preview.
  const canSwitchToPreview = !!renderMarkdown && isCompletedResult && isEditMode;

  // When disableAutoGrow is true, use native textarea with flex-1 to fill available space
  if (disableAutoGrow) {
    return (
      <div className={cn("tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-px-4 tw-py-2", className)}>
        <div className="tw-relative tw-min-h-0 tw-flex-1">
          <textarea
            ref={textareaRef}
            value={displayValue}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            disabled={isDisabled}
            className={cn(
              "tw-min-w-fit tw-overflow-auto tw-border-solid",
              "tw-absolute tw-inset-0 tw-w-full tw-resize-none tw-rounded-md tw-border tw-bg-transparent tw-py-2 tw-pl-3 tw-pr-8 tw-text-base tw-shadow-sm placeholder:tw-text-muted focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring disabled:tw-cursor-not-allowed disabled:tw-opacity-50 md:tw-text-sm",
              isDisabled && "tw-cursor-default tw-opacity-70"
            )}
          />
          {canSwitchToPreview && (
            <Button
              variant="ghost2"
              size="icon"
              className="tw-absolute tw-right-2 tw-top-2 tw-z-[1] tw-size-6 tw-opacity-60 hover:tw-opacity-100"
              onClick={() => setIsEditMode(false)}
              title="Preview rendered content"
            >
              <BookOpen className="tw-size-3" />
            </Button>
          )}
        </div>
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
