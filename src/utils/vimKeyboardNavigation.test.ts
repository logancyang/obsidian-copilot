/**
 * Tests for Vim-style keyboard navigation utilities
 *
 * Verifies that navigation key mappings are correctly built and parsed.
 * Format: one mapping per line, e.g., "map k scrollUp"
 */

import { buildNavMappingText, parseNavMappings } from "./vimKeyboardNavigation";

describe("vimKeyboardNavigation", () => {
  describe("buildNavMappingText", () => {
    it("should build mapping text from settings", () => {
      const settings = {
        enabled: true,
        scrollUpKey: "k",
        scrollDownKey: "j",
        focusInputKey: "i",
      };

      const result = buildNavMappingText(settings);

      expect(result).toBe("map k scrollUp\nmap j scrollDown\nmap i focusInput");
    });

    it("should handle custom keys", () => {
      const settings = {
        enabled: true,
        scrollUpKey: "w",
        scrollDownKey: "s",
        focusInputKey: "e",
      };

      const result = buildNavMappingText(settings);

      expect(result).toBe("map w scrollUp\nmap s scrollDown\nmap e focusInput");
    });
  });

  describe("parseNavMappings", () => {
    it("should parse valid mapping text", () => {
      const input = "map k scrollUp\nmap j scrollDown\nmap i focusInput";

      const result = parseNavMappings(input);

      expect(result.error).toBeUndefined();
      expect(result.settings).toEqual({
        scrollUp: "k",
        scrollDown: "j",
        focusInput: "i",
      });
    });

    it("should handle empty lines", () => {
      const input = "map k scrollUp\n\nmap j scrollDown\n\nmap i focusInput\n";

      const result = parseNavMappings(input);

      expect(result.error).toBeUndefined();
      expect(result.settings).toEqual({
        scrollUp: "k",
        scrollDown: "j",
        focusInput: "i",
      });
    });

    it("should handle different key order", () => {
      const input = "map i focusInput\nmap k scrollUp\nmap j scrollDown";

      const result = parseNavMappings(input);

      expect(result.error).toBeUndefined();
      expect(result.settings).toEqual({
        scrollUp: "k",
        scrollDown: "j",
        focusInput: "i",
      });
    });

    describe("error cases", () => {
      it("should error on invalid format - missing map keyword", () => {
        const input = "k scrollUp\nmap j scrollDown\nmap i focusInput";

        const result = parseNavMappings(input);

        expect(result.error).toBe('Each line must follow "map <key> <action>"');
        expect(result.settings).toBeUndefined();
      });

      it("should error on invalid format - too few parts", () => {
        const input = "map k\nmap j scrollDown\nmap i focusInput";

        const result = parseNavMappings(input);

        expect(result.error).toBe('Each line must follow "map <key> <action>"');
      });

      it("should error on invalid format - too many parts", () => {
        const input = "map k scrollUp extra\nmap j scrollDown\nmap i focusInput";

        const result = parseNavMappings(input);

        expect(result.error).toBe('Each line must follow "map <key> <action>"');
      });

      it("should error on unknown action", () => {
        const input = "map k unknownAction\nmap j scrollDown\nmap i focusInput";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Unknown action: unknownAction");
      });

      it("should error on multi-character key", () => {
        const input = "map kk scrollUp\nmap j scrollDown\nmap i focusInput";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Key must be a single character for scrollUp");
      });

      it("should error on duplicate keys (same case)", () => {
        const input = "map k scrollUp\nmap k scrollDown\nmap i focusInput";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Navigation keys must be unique");
      });

      it("should error on duplicate keys (different case)", () => {
        const input = "map k scrollUp\nmap K scrollDown\nmap i focusInput";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Navigation keys must be unique");
      });

      it("should error on duplicate action mapping", () => {
        const input = "map k scrollUp\nmap j scrollUp\nmap i focusInput";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Duplicate mapping for scrollUp");
      });

      it("should error on missing action - single", () => {
        const input = "map k scrollUp\nmap j scrollDown";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Missing mapping for focusInput");
      });

      it("should error on missing action - multiple", () => {
        const input = "map k scrollUp";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Missing mapping for scrollDown, focusInput");
      });

      it("should error on empty input", () => {
        const input = "";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Missing mapping for scrollUp, scrollDown, focusInput");
      });

      it("should error on whitespace-only input", () => {
        const input = "   \n   \n   ";

        const result = parseNavMappings(input);

        expect(result.error).toBe("Missing mapping for scrollUp, scrollDown, focusInput");
      });
    });
  });
});
