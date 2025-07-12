import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CornerDownLeft, X } from "lucide-react";

interface InlineEditPromptProps {
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
  initialText?: string;
  placeholder?: string;
}

export function InlineEditPrompt({
  onSubmit,
  onCancel,
  initialText = "",
  placeholder = "Enter your prompt...",
}: InlineEditPromptProps) {
  const [prompt, setPrompt] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [prompt]);

  const handleSubmit = useCallback(() => {
    if (prompt.trim()) {
      onSubmit(prompt.trim());
    }
  }, [prompt, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSubmit, onCancel]
  );

  return (
    <div className="tw-inline-edit-prompt tw-z-50 tw-bg-background tw-absolute tw-min-w-80 tw-rounded-md tw-border tw-border-border tw-p-3 tw-shadow-lg">
      <div className="tw-flex tw-flex-col tw-gap-2">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="tw-bg-background focus:tw-ring-accent tw-max-h-32 tw-min-h-10 tw-w-full tw-resize-none tw-rounded tw-border tw-border-border tw-px-2 tw-py-1 tw-text-sm tw-text-text focus:tw-outline-none focus:tw-ring-2"
          rows={1}
        />
        <div className="tw-flex tw-items-center tw-justify-between">
          <div className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-muted">
            <CornerDownLeft className="tw-size-3" />
            <span>to submit</span>
            <span className="tw-mx-1">•</span>
            <span>Esc to cancel</span>
          </div>
          <div className="tw-flex tw-gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="tw-h-6 tw-px-2 tw-text-xs"
            >
              <X className="tw-size-3" />
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              className="tw-flex tw-h-6 tw-items-center tw-gap-1 tw-px-2 tw-text-xs"
            >
              <span>Submit</span>
              <CornerDownLeft className="tw-size-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
