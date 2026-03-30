import React, { useState, useRef, useEffect } from "react";
import { Check, Copy } from "lucide-react";
import { Notice } from "obsidian";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyCodeBlockProps {
  value: string;
  label?: string;
  maxHeight?: string;
  className?: string;
}

/**
 * Readonly monospace code block with a copy-to-clipboard button.
 * Shows "Copied" feedback for 2 seconds after a successful copy.
 */
export const CopyCodeBlock: React.FC<CopyCodeBlockProps> = ({
  value,
  label = "Copy to Clipboard",
  maxHeight = "8rem",
  className,
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  // Reason: clear the "copied" timer on unmount to prevent setState after unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /**
   * Select the code text so the user can copy manually when clipboard APIs fail.
   * @returns true if text was successfully selected, false otherwise.
   */
  const selectForManualCopy = (): boolean => {
    const pre = preRef.current;
    const selection = globalThis.getSelection?.();
    if (!pre || !selection) return false;
    const range = document.createRange();
    range.selectNodeContents(pre);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) {
      const selected = selectForManualCopy();
      new Notice(
        selected
          ? "Clipboard unavailable. Text selected — copy manually."
          : "Clipboard unavailable. Please copy the text manually."
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      new Notice("Copied to clipboard");
      // Reason: clear any previous timer to prevent early reset on repeated clicks.
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      const selected = selectForManualCopy();
      new Notice(
        selected
          ? "Failed to copy. Text selected — copy manually."
          : "Failed to copy. Please copy the text manually."
      );
    }
  };

  return (
    <div className={cn("tw-flex tw-flex-col tw-gap-2", className)}>
      <div
        className="tw-overflow-auto tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-p-3 tw-font-mono tw-text-xs tw-leading-relaxed tw-text-muted"
        style={{ maxHeight }}
      >
        <pre ref={preRef} className="tw-m-0 tw-whitespace-pre-wrap tw-break-all">
          {value}
        </pre>
      </div>
      <Button variant="secondary" size="sm" className="tw-gap-2 tw-self-end" onClick={handleCopy}>
        {copied ? (
          <>
            <Check className="tw-size-3.5 tw-text-[var(--color-green)]" />
            Copied
          </>
        ) : (
          <>
            <Copy className="tw-size-3.5" />
            {label}
          </>
        )}
      </Button>
    </div>
  );
};
