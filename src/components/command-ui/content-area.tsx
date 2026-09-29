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
  disableAutoGrow?: boolean;
  renderMarkdown?: (content: string, el: HTMLElement) => Promise<void>;
}

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

  const isCompletedResult = state.type === "result" && !state.isStreaming;
  const showPreview = !!renderMarkdown && isCompletedResult && !isEditMode;

  const isGenerating = state.type === "loading" || (state.type === "result" && state.isStreaming);
  const [prevIsGenerating, setPrevIsGenerating] = React.useState(isGenerating);
  if (isGenerating && !prevIsGenerating) {
    setPrevIsGenerating(true);
    setIsEditMode(false);
  } else if (!isGenerating && prevIsGenerating) {
    setPrevIsGenerating(false);
  }

  React.useEffect(() => {
    if (state.type === "result" && state.isStreaming && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [state]);

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

  const canSwitchToPreview = !!renderMarkdown && isCompletedResult && isEditMode;

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
