import { SEND_SHORTCUT } from "@/constants";
import { checkShortcutMatch, isImeCompositionEvent } from "./KeyboardPlugin";

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
  } as KeyboardEvent;
}

describe("KeyboardPlugin", () => {
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

    it("should detect IME-consumed keys reported as key 'Process' even when isComposing is false", () => {
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
