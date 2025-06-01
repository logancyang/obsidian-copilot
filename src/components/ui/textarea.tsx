import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, value, ...props }, ref) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

    const adjustHeight = React.useCallback(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        const newHeight = Math.min(textarea.scrollHeight, 300);
        textarea.style.height = `${newHeight}px`;
      }
    }, []);

    // Watch for value changes to adjust height
    React.useLayoutEffect(() => {
      adjustHeight();
    }, [value, adjustHeight]);

    React.useEffect(() => {
      adjustHeight();
      window.addEventListener("resize", adjustHeight);
      return () => window.removeEventListener("resize", adjustHeight);
    }, [adjustHeight]);

    const combinedRef = (node: HTMLTextAreaElement) => {
      textareaRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    return (
      <textarea
        className={cn(
          "tw-min-w-fit tw-resize-y tw-overflow-auto tw-border-solid",
          "tw-flex tw-max-h-[300px] tw-min-h-[60px] tw-w-full tw-rounded-md tw-border tw-bg-transparent tw-px-3 tw-py-2 tw-text-base tw-shadow-sm placeholder:tw-text-muted focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring disabled:tw-cursor-not-allowed disabled:tw-opacity-50 md:tw-text-sm",
          className
        )}
        value={value}
        ref={combinedRef}
        onChange={(e) => {
          adjustHeight();
          props.onChange?.(e);
        }}
        onInput={adjustHeight}
        onCompositionEnd={adjustHeight}
        onPaste={() => {
          setTimeout(adjustHeight, 0);
        }}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
