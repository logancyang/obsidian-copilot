import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { SEND_SHORTCUT } from "@/constants";

interface KeyboardPluginProps {
  onSubmit: () => void;
  sendShortcut: SEND_SHORTCUT;
  onEscape?: () => void;
  onShiftTab?: () => void;
}

function registerEscapeContainment(rootElement: HTMLElement): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;

    // Lexical skips key commands while composing, so contain Escape on the native
    // editor root before Obsidian can move focus into the note editor.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/302
    event.stopPropagation();
  };

  rootElement.addEventListener("keydown", handleKeyDown);
  return () => rootElement.removeEventListener("keydown", handleKeyDown);
}

export function KeyboardPlugin({
  onSubmit,
  sendShortcut,
  onEscape,
  onShiftTab,
}: KeyboardPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) {
          return false;
        }

        if (isImeCompositionEvent(event)) {
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

  useEffect(() => {
    let removeEscapeContainment: (() => void) | undefined;

    const unregisterRootListener = editor.registerRootListener((rootElement) => {
      removeEscapeContainment?.();
      removeEscapeContainment = rootElement ? registerEscapeContainment(rootElement) : undefined;
    });

    return () => {
      unregisterRootListener();
      removeEscapeContainment?.();
    };
  }, [editor]);

  useEffect(() => {
    if (!onEscape) return;
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false;
        if (isImeCompositionEvent(event)) return true;
        event.preventDefault();
        onEscape();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onEscape]);

  useEffect(() => {
    if (!onShiftTab) return;
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false;
        if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        event.preventDefault();
        onShiftTab();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, onShiftTab]);

  return null;
}

// isComposing/"Process" replace the deprecated keyCode 229 IME guard.
// https://github.com/logancyang/obsidian-copilot-preview/issues/302
export function isImeCompositionEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.key === "Process";
}

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
