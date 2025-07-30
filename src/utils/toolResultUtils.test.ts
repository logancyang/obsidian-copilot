import {
  truncateToolResult,
  formatToolResultForMemory,
  processToolResults,
} from "./toolResultUtils";

// Mock the settings
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    toolResultMaxLength: 100,
  })),
}));

describe("toolResultUtils", () => {
  describe("truncateToolResult", () => {
    it("should not truncate results shorter than max length", () => {
      const result = "Short result";
      expect(truncateToolResult(result)).toBe(result);
    });

    it("should truncate results longer than max length", () => {
      const result = "a".repeat(150);
      const truncated = truncateToolResult(result);
      expect(truncated).toContain("a".repeat(100));
      expect(truncated).toContain("... (truncated 50 characters)");
    });

    it("should use custom max length when provided", () => {
      const result = "a".repeat(50);
      const truncated = truncateToolResult(result, 20);
      expect(truncated).toContain("a".repeat(20));
      expect(truncated).toContain("... (truncated 30 characters)");
    });

    it("should handle empty or null results", () => {
      expect(truncateToolResult("")).toBe("");
      expect(truncateToolResult(null as any)).toBe(null);
    });
  });

  describe("formatToolResultForMemory", () => {
    it("should format and truncate tool results", () => {
      const result = "a".repeat(150);
      const formatted = formatToolResultForMemory("testTool", result);
      expect(formatted).toMatch(/^Tool 'testTool' result: /);
      expect(formatted).toContain("... (truncated 50 characters)");
    });
  });

  describe("processToolResults", () => {
    const toolResults = [
      { toolName: "tool1", result: "a".repeat(150) },
      { toolName: "tool2", result: "b".repeat(200) },
    ];

    it("should process results without truncation when truncate=false", () => {
      const processed = processToolResults(toolResults, false);
      expect(processed).toContain("Tool 'tool1' result: " + "a".repeat(150));
      expect(processed).toContain("Tool 'tool2' result: " + "b".repeat(200));
      expect(processed).not.toContain("truncated");
    });

    it("should process results with truncation when truncate=true", () => {
      const processed = processToolResults(toolResults, true);
      expect(processed).toContain("Tool 'tool1' result: " + "a".repeat(100));
      expect(processed).toContain("Tool 'tool2' result: " + "b".repeat(100));
      expect(processed).toContain("... (truncated 50 characters)");
      expect(processed).toContain("... (truncated 100 characters)");
    });
  });
});
