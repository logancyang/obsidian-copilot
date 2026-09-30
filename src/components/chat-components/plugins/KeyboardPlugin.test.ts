import { SEND_SHORTCUT } from "@/constants";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { fireEvent, render } from "@testing-library/react";
import { COMMAND_PRIORITY_HIGH, KEY_ESCAPE_COMMAND, type LexicalEditor } from "lexical";
import React from "react";
import { KeyboardPlugin, checkShortcutMatch, isImeCompositionEvent } from "./KeyboardPlugin";

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
    it.each([
      { name: "plain Enter", fields: {}, enter: true, shiftEnter: false },
      { name: "Shift+Enter", fields: { shiftKey: true }, enter: false, shiftEnter: true },
      { name: "Meta+Enter", fields: { metaKey: true }, enter: false, shiftEnter: false },
      { name: "Ctrl+Enter", fields: { ctrlKey: true }, enter: false, shiftEnter: false },
      { name: "Alt+Enter", fields: { altKey: true }, enter: false, shiftEnter: false },
      {
        name: "Shift+Meta+Enter",
        fields: { shiftKey: true, metaKey: true },
        enter: false,
        shiftEnter: false,
      },
      {
        name: "Shift+Ctrl+Enter",
        fields: { shiftKey: true, ctrlKey: true },
        enter: false,
        shiftEnter: false,
      },
      {
        name: "Shift+Alt+Enter",
        fields: { shiftKey: true, altKey: true },
        enter: false,
        shiftEnter: false,
      },
    ])("for $name matches Enter: $enter and Shift+Enter: $shiftEnter", (testCase) => {
      const event = createMockKeyboardEvent(testCase.fields);

      expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(testCase.enter);
      expect(checkShortcutMatch(event, SEND_SHORTCUT.SHIFT_ENTER)).toBe(testCase.shiftEnter);
    });

    it.each([
      { shortcut: SEND_SHORTCUT.ENTER, fields: {} },
      { shortcut: SEND_SHORTCUT.SHIFT_ENTER, fields: { shiftKey: true } },
    ])(
      "matches $shortcut during IME composition because only modifiers are checked",
      (testCase) => {
        const event = createMockKeyboardEvent({ ...testCase.fields, isComposing: true });

        expect(checkShortcutMatch(event, testCase.shortcut)).toBe(true);
      }
    );

    it("matches nothing for an unrecognized shortcut", () => {
      const event = createMockKeyboardEvent({});

      expect(checkShortcutMatch(event, "invalid-shortcut" as SEND_SHORTCUT)).toBe(false);
    });
  });

  describe("isImeCompositionEvent()", () => {
    it("detects an active composition session via isComposing", () => {
      const event = createMockKeyboardEvent({ key: "Enter", isComposing: true });
      expect(isImeCompositionEvent(event)).toBe(true);
    });

    it("treats IME-consumed Process keys as composition so chat shortcuts stay inactive (https://github.com/logancyang/obsidian-copilot-preview/issues/302)", () => {
      const event = createMockKeyboardEvent({ key: "Process", isComposing: false });
      expect(isImeCompositionEvent(event)).toBe(true);
    });

    it("does not flag a plain Enter keydown outside composition", () => {
      const event = createMockKeyboardEvent({ key: "Enter" });
      expect(isImeCompositionEvent(event)).toBe(false);
    });
  });
});
