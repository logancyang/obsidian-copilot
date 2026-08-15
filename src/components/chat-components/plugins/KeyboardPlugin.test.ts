import { SEND_SHORTCUT } from "@/constants";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { fireEvent, render } from "@testing-library/react";
import { COMMAND_PRIORITY_HIGH, KEY_ESCAPE_COMMAND, type LexicalEditor } from "lexical";
import React from "react";
import { KeyboardPlugin, checkShortcutMatch, isImeCompositionEvent } from "./KeyboardPlugin";

/**
 * Helper function to create a mock KeyboardEvent with specified fields
 */
function createMockKeyboardEvent(fields: {
  key?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}): KeyboardEvent {
  return {
    key: fields.key || "Enter",
    shiftKey: fields.shiftKey || false,
    metaKey: fields.metaKey || false,
    ctrlKey: fields.ctrlKey || false,
    altKey: fields.altKey || false,
    isComposing: fields.isComposing || false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  } as unknown as KeyboardEvent;
}

let editor: LexicalEditor;

function EditorCapture(): null {
  [editor] = useLexicalComposerContext();
  return null;
}

interface RenderedKeyboardPlugin {
  input: HTMLElement;
  boundary: HTMLElement;
}

function renderKeyboardPlugin(onEscape?: () => void): RenderedKeyboardPlugin {
  const result = render(
    React.createElement(
      LexicalComposer,
      {
        initialConfig: {
          namespace: "keyboard-plugin-test",
          onError: (error: Error) => {
            throw error;
          },
        },
      },
      React.createElement(ContentEditable, { "aria-label": "Chat input" }),
      React.createElement(EditorCapture),
      React.createElement(KeyboardPlugin, {
        onSubmit: jest.fn(),
        sendShortcut: SEND_SHORTCUT.ENTER,
        onEscape,
      })
    )
  );
  return {
    input: result.getByRole("textbox", { name: "Chat input" }),
    boundary: result.container,
  };
}

function dispatchEscape(target: HTMLElement, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(target, event);
  return event;
}

describe("KeyboardPlugin", () => {
  describe("KeyboardPlugin()", () => {
    it("should contain IME-owned Escape without blocking native composition cancellation (https://github.com/logancyang/obsidian-copilot-preview/issues/302)", () => {
      const onEscape = jest.fn();
      const boundaryHandler = jest.fn();
      const { input, boundary } = renderKeyboardPlugin(onEscape);
      boundary.addEventListener("keydown", boundaryHandler);
      input.focus();
      fireEvent.compositionStart(input);

      const event = dispatchEscape(input, { isComposing: true });

      expect(boundaryHandler).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      expect(event.defaultPrevented).toBe(false);
      expect(onEscape).not.toHaveBeenCalled();
      fireEvent.compositionEnd(input);
    });

    it("should contain plain Escape when no chat action is configured (https://github.com/logancyang/obsidian-copilot-preview/issues/302)", () => {
      const boundaryHandler = jest.fn();
      const { input, boundary } = renderKeyboardPlugin();
      boundary.addEventListener("keydown", boundaryHandler);
      input.focus();

      const event = dispatchEscape(input);

      expect(boundaryHandler).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      expect(event.defaultPrevented).toBe(false);
    });

    it("should contain plain Escape before a higher-priority chat action handles it (https://github.com/logancyang/obsidian-copilot-preview/issues/302)", () => {
      const typeaheadEscapeHandler = jest.fn(() => true);
      const boundaryHandler = jest.fn();
      const { input, boundary } = renderKeyboardPlugin();
      editor.registerCommand(KEY_ESCAPE_COMMAND, typeaheadEscapeHandler, COMMAND_PRIORITY_HIGH);
      boundary.addEventListener("keydown", boundaryHandler);

      const event = dispatchEscape(input);

      expect(boundaryHandler).not.toHaveBeenCalled();
      expect(typeaheadEscapeHandler).toHaveBeenCalledWith(event, editor);
    });

    it("should contain plain Escape and invoke its configured chat action (https://github.com/logancyang/obsidian-copilot-preview/issues/302)", () => {
      const onEscape = jest.fn();
      const boundaryHandler = jest.fn();
      const { input, boundary } = renderKeyboardPlugin(onEscape);
      boundary.addEventListener("keydown", boundaryHandler);

      const event = dispatchEscape(input);

      expect(boundaryHandler).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(onEscape).toHaveBeenCalledTimes(1);
    });
  });

  describe("checkShortcutMatch()", () => {
    describe("ENTER shortcut", () => {
      it("should match plain Enter key", () => {
        const event = createMockKeyboardEvent({});
        expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(true);
      });

      it("should not match when Shift is pressed", () => {
        const event = createMockKeyboardEvent({ shiftKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(false);
      });

      it("should not match when Meta is pressed", () => {
        const event = createMockKeyboardEvent({ metaKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(false);
      });

      it("should not match when Ctrl is pressed", () => {
        const event = createMockKeyboardEvent({ ctrlKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(false);
      });

      it("should not match when Alt is pressed", () => {
        const event = createMockKeyboardEvent({ altKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(false);
      });

      it("should not match when multiple modifiers are pressed", () => {
        const event = createMockKeyboardEvent({ shiftKey: true, ctrlKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(false);
      });
    });

    describe("SHIFT_ENTER shortcut", () => {
      it("should match Shift+Enter", () => {
        const event = createMockKeyboardEvent({ shiftKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.SHIFT_ENTER)).toBe(true);
      });

      it("should not match plain Enter", () => {
        const event = createMockKeyboardEvent({});
        expect(checkShortcutMatch(event, SEND_SHORTCUT.SHIFT_ENTER)).toBe(false);
      });

      it("should not match when Meta is also pressed", () => {
        const event = createMockKeyboardEvent({ shiftKey: true, metaKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.SHIFT_ENTER)).toBe(false);
      });

      it("should not match when Ctrl is also pressed", () => {
        const event = createMockKeyboardEvent({ shiftKey: true, ctrlKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.SHIFT_ENTER)).toBe(false);
      });

      it("should not match when Alt is also pressed", () => {
        const event = createMockKeyboardEvent({ shiftKey: true, altKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.SHIFT_ENTER)).toBe(false);
      });
    });

    describe("IME Composition", () => {
      it("should still match shortcuts during IME composition (checkShortcutMatch only checks modifiers)", () => {
        // Note: The actual IME protection happens in the KeyboardPlugin component
        // via isImeCompositionEvent, not in checkShortcutMatch. This test verifies
        // that checkShortcutMatch doesn't interfere with IME handling.
        const event = createMockKeyboardEvent({ isComposing: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(true);
      });

      it("should match SHIFT_ENTER shortcut even when isComposing is true", () => {
        const event = createMockKeyboardEvent({ shiftKey: true, isComposing: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.SHIFT_ENTER)).toBe(true);
      });
    });

    describe("Edge cases", () => {
      it("should return false for invalid shortcut type", () => {
        const event = createMockKeyboardEvent({});
        expect(checkShortcutMatch(event, "invalid-shortcut" as SEND_SHORTCUT)).toBe(false);
      });

      it("should not match when all modifiers are pressed", () => {
        const event = createMockKeyboardEvent({
          shiftKey: true,
          metaKey: true,
          ctrlKey: true,
          altKey: true,
        });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(false);
        expect(checkShortcutMatch(event, SEND_SHORTCUT.SHIFT_ENTER)).toBe(false);
      });
    });
  });

  describe("isImeCompositionEvent()", () => {
    it("should detect an active composition session via isComposing", () => {
      const event = createMockKeyboardEvent({ key: "Enter", isComposing: true });
      expect(isImeCompositionEvent(event)).toBe(true);
    });

    it("should keep chat shortcuts inactive for IME-consumed Process keys (https://github.com/logancyang/obsidian-copilot-preview/issues/302)", () => {
      const event = createMockKeyboardEvent({ key: "Process", isComposing: false });
      expect(isImeCompositionEvent(event)).toBe(true);
    });

    it("should not flag a plain Enter keydown outside composition", () => {
      const event = createMockKeyboardEvent({ key: "Enter" });
      expect(isImeCompositionEvent(event)).toBe(false);
    });

    it("should not flag a plain Escape keydown outside composition", () => {
      const event = createMockKeyboardEvent({ key: "Escape" });
      expect(isImeCompositionEvent(event)).toBe(false);
    });
  });
});
