import { parseCopilotPlusContextLength } from "@/modelManagement/setup/copilotPlusCatalog";

describe("copilotPlusCatalog", () => {
  describe("parseCopilotPlusContextLength()", () => {
    it.each([
      ["1M", 1_048_576],
      ["256K", 262_144],
      ["192k", 196_608],
      ["8192", 8_192],
      [" 64 K ", 65_536],
    ])(
      "reads %s as %i tokens from the single server catalog (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)",
      (display, tokens) => {
        expect(parseCopilotPlusContextLength(display)).toBe(tokens);
      }
    );

    it.each([
      ["an unknown suffix", "1G"],
      ["prose", "one million"],
      ["a zero", "0"],
      ["a negative", "-5K"],
      ["a non-string", 200_000],
      ["undefined", undefined],
    ])(
      "returns null for %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)",
      (_label, display) => {
        expect(parseCopilotPlusContextLength(display)).toBeNull();
      }
    );
  });
});
