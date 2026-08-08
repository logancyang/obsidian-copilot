import { logError } from "@/logger";
import { useState } from "react";

/**
 * Copy-to-clipboard with a transient "copied" flag that auto-resets after 2s.
 * Copies the string verbatim — callers clean/format the text before passing it.
 */
export function useCopyToClipboard(): { isCopied: boolean; copy: (text: string) => void } {
  const [isCopied, setIsCopied] = useState(false);

  const copy = (text: string) => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setIsCopied(true);
        window.setTimeout(() => setIsCopied(false), 2000);
      })
      .catch((err) => logError("Clipboard writeText failed", err));
  };

  return { isCopied, copy };
}
