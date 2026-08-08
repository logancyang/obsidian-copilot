import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resolveInputUrls } from "@/utils/urlTagUtils";
import { Clipboard, Plus } from "lucide-react";
import * as React from "react";
import { useState } from "react";

interface UrlInputRowProps {
  /**
   * Receives the raw text the user submitted — by typing + Add/Enter, by the
   * clipboard Paste button, or by pasting URLs into the field. The caller parses
   * it and decides what "submit" means (stage to a pending list, add immediately).
   */
  onSubmit: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * The shared URL entry row (design ⑤): an {@link Input} plus ONE two-state button
 * — empty → Paste (reads the clipboard), non-empty → Add (Enter does the same).
 * A paste that contains URLs routes straight through `onSubmit` rather than
 * landing in the field. Owns only its own draft text; everything past submit
 * (parsing, dedup, staging vs immediate-add, the resulting list) is the caller's,
 * so the +URL popover and the Manage Links panel share one input affordance
 * without sharing their different list presentations.
 */
export function UrlInputRow({
  onSubmit,
  placeholder = "Enter a URL…",
  autoFocus,
}: UrlInputRowProps) {
  const [value, setValue] = useState("");
  const hasValue = value.trim().length > 0;

  const submitText = (text: string) => {
    onSubmit(text);
    setValue("");
  };

  // Two-state action: type present → submit it; empty → import the clipboard.
  const handleAction = async () => {
    if (hasValue) {
      submitText(value);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (text) submitText(text);
    } catch {
      // Clipboard unavailable / denied — typing still works.
    }
  };

  // A paste that yields URLs is submitted directly (auto-split); other text
  // (e.g. a fragment the user wants to finish typing) pastes into the field.
  // Exception: a SINGLE URL pasted while the field already holds a draft lands in
  // the input (browser default) instead of submitting — so it doesn't yank the
  // URL away and wipe what the user was typing. An empty field or a multi-URL
  // batch still routes straight through `onSubmit`.
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const parsed = resolveInputUrls(text);
    if (parsed.length === 0) return;
    if (parsed.length === 1 && hasValue) return;
    e.preventDefault();
    submitText(text);
  };

  return (
    <div className="tw-flex tw-gap-2">
      <Input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hasValue) {
            e.preventDefault();
            void handleAction();
          }
        }}
        placeholder={placeholder}
        className="tw-min-w-0 tw-flex-1"
      />
      <Button
        variant={hasValue ? "default" : "ghost2"}
        size="sm"
        className={cn(
          // tw-h-9 (not size sm's h-6) keeps the button the same height as Input.
          "tw-h-9 tw-shrink-0 tw-gap-1.5 tw-whitespace-nowrap tw-rounded-md tw-px-3 tw-font-semibold",
          // No outline variant exists; force a plain-bg neutral outline over ghost2
          // for the empty (Paste) state — `!` beats both ghost2's transparent bg
          // and Obsidian's native button chrome.
          !hasValue &&
            "!tw-border !tw-border-solid !tw-border-border !tw-bg-primary !tw-text-muted !tw-shadow-none hover:!tw-bg-interactive-hover hover:!tw-text-normal"
        )}
        title={hasValue ? "Add to list" : "Paste from clipboard"}
        onClick={() => void handleAction()}
      >
        {hasValue ? <Plus className="tw-size-3.5" /> : <Clipboard className="tw-size-3.5" />}
        {hasValue ? "Add" : "Paste"}
      </Button>
    </div>
  );
}
