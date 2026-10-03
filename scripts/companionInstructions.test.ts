import {
  prependCopilotInstructions,
  stripCopilotInstructions,
} from "../adapters/companions/instructions";
describe("companionInstructions", () => {
  describe("prependCopilotInstructions()", () => {
    it("preserves Copilot instructions without editing any global CLI rule file", () => {
      expect(prependCopilotInstructions("Read note.md", "Vault policy")).toBe(
        "<copilot_instructions>\nVault policy\n</copilot_instructions>\n\nRead note.md"
      );
    });
    it("preserves the original text when no instructions are configured", () => {
      expect(prependCopilotInstructions("Hello", "")).toBe("Hello");
    });
  });
  describe("stripCopilotInstructions()", () => {
    it("keeps resumed user messages readable without repeated hidden instructions", () => {
      expect(
        stripCopilotInstructions(prependCopilotInstructions("Read note.md", "Vault policy"))
      ).toBe("Read note.md");
    });
    it("preserves instruction tags quoted inside a user message", () => {
      const text = "Explain <copilot_instructions>example</copilot_instructions>";
      expect(stripCopilotInstructions(text)).toBe(text);
    });
  });
});
