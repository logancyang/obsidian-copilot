import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resolveInputUrls } from "@/utils/urlTagUtils";
import { Clipboard, Plus } from "lucide-react";
import * as React from "react";
import { useState } from "react";

interface UrlInputRowProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

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
          "tw-h-9 tw-shrink-0 tw-gap-1.5 tw-whitespace-nowrap tw-rounded-md tw-px-3 tw-font-semibold",
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
