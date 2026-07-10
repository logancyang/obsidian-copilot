import { logError } from "@/logger";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy-to-clipboard with a transient "copied" flag that auto-resets after 2s.
 * Copies the string verbatim — callers clean/format the text before passing it.
 */
export function useCopyToClipboard(): {
  isCopied: boolean;
  copy: (text: string, ownerWindow?: Window) => Promise<boolean>;
} {
  const [isCopied, setIsCopied] = useState(false);
  const resetTimer = useRef<{ ownerWindow: Window; id: number } | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) {
        resetTimer.current.ownerWindow.clearTimeout(resetTimer.current.id);
      }
    },
    []
  );

  const copy = useCallback(async (text: string, ownerWindow = activeWindow): Promise<boolean> => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable");
      await navigator.clipboard.writeText(text);
      if (resetTimer.current) {
        resetTimer.current.ownerWindow.clearTimeout(resetTimer.current.id);
      }
      setIsCopied(true);
      resetTimer.current = {
        ownerWindow,
        id: ownerWindow.setTimeout(() => setIsCopied(false), 2000),
      };
      return true;
    } catch (err) {
      logError("Clipboard writeText failed", err);
      return false;
    }
  }, []);

  return { isCopied, copy };
}
