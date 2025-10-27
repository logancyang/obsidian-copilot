import { SEND_SHORTCUT } from "@/constants";
import { checkShortcutMatch } from "./KeyboardPlugin";
import { Platform } from "obsidian";

/**
 * Helper function to create a mock KeyboardEvent with specified modifiers
 */
function createMockKeyboardEvent(modifiers: {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}): KeyboardEvent {
  return {
    shiftKey: modifiers.shiftKey || false,
    metaKey: modifiers.metaKey || false,
    ctrlKey: modifiers.ctrlKey || false,
    altKey: modifiers.altKey || false,
    isComposing: modifiers.isComposing || false,
  } as KeyboardEvent;
}

describe("KeyboardPlugin - checkShortcutMatch", () => {
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

  describe("CMD_ENTER shortcut", () => {
    describe("on macOS", () => {
      beforeEach(() => {
        // Mock Platform.isMacOS to return true
        Object.defineProperty(Platform, "isMacOS", {
          get: () => true,
          configurable: true,
        });
      });

      it("should match Meta+Enter (Cmd+Enter)", () => {
        const event = createMockKeyboardEvent({ metaKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(true);
      });

      it("should not match Ctrl+Enter on macOS", () => {
        const event = createMockKeyboardEvent({ ctrlKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      });

      it("should not match when Shift is also pressed", () => {
        const event = createMockKeyboardEvent({ metaKey: true, shiftKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      });

      it("should not match when Alt is also pressed", () => {
        const event = createMockKeyboardEvent({ metaKey: true, altKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      });

      it("should not match Cmd+Ctrl+Enter (both modifiers)", () => {
        const event = createMockKeyboardEvent({ metaKey: true, ctrlKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      });
    });

    describe("on Windows/Linux", () => {
      beforeEach(() => {
        // Mock Platform.isMacOS to return false
        Object.defineProperty(Platform, "isMacOS", {
          get: () => false,
          configurable: true,
        });
      });

      it("should match Ctrl+Enter", () => {
        const event = createMockKeyboardEvent({ ctrlKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(true);
      });

      it("should not match Meta+Enter on Windows/Linux", () => {
        const event = createMockKeyboardEvent({ metaKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      });

      it("should not match when Shift is also pressed", () => {
        const event = createMockKeyboardEvent({ ctrlKey: true, shiftKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      });

      it("should not match when Alt is also pressed", () => {
        const event = createMockKeyboardEvent({ ctrlKey: true, altKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      });

      it("should not match Ctrl+Meta+Enter (both modifiers)", () => {
        const event = createMockKeyboardEvent({ ctrlKey: true, metaKey: true });
        expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      });
    });
  });

  describe("ALT_ENTER shortcut", () => {
    it("should match Alt+Enter", () => {
      const event = createMockKeyboardEvent({ altKey: true });
      expect(checkShortcutMatch(event, SEND_SHORTCUT.ALT_ENTER)).toBe(true);
    });

    it("should not match plain Enter", () => {
      const event = createMockKeyboardEvent({});
      expect(checkShortcutMatch(event, SEND_SHORTCUT.ALT_ENTER)).toBe(false);
    });

    it("should not match when Shift is also pressed", () => {
      const event = createMockKeyboardEvent({ altKey: true, shiftKey: true });
      expect(checkShortcutMatch(event, SEND_SHORTCUT.ALT_ENTER)).toBe(false);
    });

    it("should not match when Meta is also pressed", () => {
      const event = createMockKeyboardEvent({ altKey: true, metaKey: true });
      expect(checkShortcutMatch(event, SEND_SHORTCUT.ALT_ENTER)).toBe(false);
    });

    it("should not match when Ctrl is also pressed", () => {
      const event = createMockKeyboardEvent({ altKey: true, ctrlKey: true });
      expect(checkShortcutMatch(event, SEND_SHORTCUT.ALT_ENTER)).toBe(false);
    });
  });

  describe("IME Composition", () => {
    it("should still match shortcuts during IME composition (checkShortcutMatch only checks modifiers)", () => {
      // Note: The actual IME protection happens in the KeyboardPlugin component,
      // not in checkShortcutMatch. This test verifies that checkShortcutMatch
      // doesn't interfere with IME handling.
      const event = createMockKeyboardEvent({ isComposing: true });
      expect(checkShortcutMatch(event, SEND_SHORTCUT.ENTER)).toBe(true);
    });

    it("should match ENTER shortcut even when isComposing is true (IME check is in plugin)", () => {
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
      expect(checkShortcutMatch(event, SEND_SHORTCUT.CMD_ENTER)).toBe(false);
      expect(checkShortcutMatch(event, SEND_SHORTCUT.ALT_ENTER)).toBe(false);
    });
  });
});
