import { useRef, useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from "lexical";
import { SEND_SHORTCUT } from "@/constants";

/**
 * Props for the KeyboardPlugin component
 */
interface KeyboardPluginProps {
  /** Callback triggered when configured shortcut is pressed */
  onSubmit: () => void;
  /** Send shortcut configuration */
  sendShortcut: SEND_SHORTCUT;
}

/**
 * Lexical plugin that handles keyboard shortcuts for the chat input.
 * Supports configurable send shortcuts: Enter, Shift+Enter
 */
export function KeyboardPlugin({ onSubmit, sendShortcut }: KeyboardPluginProps) {
  const [editor] = useLexicalComposerContext();
  // Track IME composition state with a ref to avoid stale closure issues
  const isComposingRef = useRef(false);
  // Track the timeout to clear it on new composition
  const compositionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle composition events to track IME state
  // Use registerRootListener to handle cases where rootElement is initially null
  useEffect(() => {
    let currentRootElement: HTMLElement | null = null;

    const handleCompositionStart = () => {
      // Clear any pending timeout from previous composition
      if (compositionTimeoutRef.current) {
        clearTimeout(compositionTimeoutRef.current);
        compositionTimeoutRef.current = null;
      }
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      // Clear any pending timeout
      if (compositionTimeoutRef.current) {
        clearTimeout(compositionTimeoutRef.current);
      }
      // Delay resetting the flag to ensure the Enter key from IME confirmation is ignored
      compositionTimeoutRef.current = setTimeout(() => {
        isComposingRef.current = false;
        compositionTimeoutRef.current = null;
      }, 100);
    };

    const attachListeners = (el: HTMLElement) => {
      el.addEventListener("compositionstart", handleCompositionStart);
      el.addEventListener("compositionend", handleCompositionEnd);
    };

    const detachListeners = (el: HTMLElement) => {
      el.removeEventListener("compositionstart", handleCompositionStart);
      el.removeEventListener("compositionend", handleCompositionEnd);
    };

    // Use registerRootListener to handle root element changes
    const unregisterRootListener = editor.registerRootListener(
      (rootElement: HTMLElement | null, prevRootElement: HTMLElement | null) => {
        if (prevRootElement) {
          detachListeners(prevRootElement);
        }
        if (rootElement) {
          attachListeners(rootElement);
        }
        currentRootElement = rootElement;
      }
    );

    return () => {
      unregisterRootListener();

      if (currentRootElement) {
        detachListeners(currentRootElement);
        currentRootElement = null;
      }

      // Clean up timeout on unmount
      if (compositionTimeoutRef.current) {
        clearTimeout(compositionTimeoutRef.current);
        compositionTimeoutRef.current = null;
      }
    };
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        // Handle null event (Lexical internal use)
        if (!event) {
          return false;
        }

        // Ignore Enter key during IME composition (e.g., Chinese, Japanese, Korean input)
        // Check our ref, event.isComposing, and keyCode 229 for comprehensive IME detection
        // IMPORTANT: Return true and preventDefault to "swallow" the event, preventing default newline insertion
        if (isComposingRef.current || event.isComposing || event.keyCode === 229) {
          event.preventDefault();
          return true;
        }

        const shouldSubmit = checkShortcutMatch(event, sendShortcut);

        if (shouldSubmit) {
          event.preventDefault();
          onSubmit();
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onSubmit, sendShortcut]);

  return null;
}

/**
 * Checks if a keyboard event matches the configured send shortcut.
 * Exported for testing purposes.
 * @param event - The keyboard event to check
 * @param shortcut - The configured send shortcut
 * @returns True if the event matches the shortcut, false otherwise
 */
export function checkShortcutMatch(event: KeyboardEvent, shortcut: SEND_SHORTCUT): boolean {
  switch (shortcut) {
    case SEND_SHORTCUT.ENTER:
      return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    case SEND_SHORTCUT.SHIFT_ENTER:
      return event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    default:
      return false;
  }
}
