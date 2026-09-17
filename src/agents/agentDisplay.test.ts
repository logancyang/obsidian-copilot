import { formatMemorySize } from "@/agents/agentDisplay";

describe("agentDisplay", () => {
  describe("formatMemorySize()", () => {
    it("reports a small file in whole bytes", () => {
      expect(formatMemorySize(412)).toBe("412 B");
    });

    it("switches to one decimal of kilobytes at 1 KB", () => {
      expect(formatMemorySize(1024)).toBe("1.0 KB");
      expect(formatMemorySize(2662)).toBe("2.6 KB");
    });

    it("switches to megabytes past a thousand kilobytes", () => {
      expect(formatMemorySize(5 * 1024 * 1024)).toBe("5.0 MB");
    });

    it("reads an absent or empty memory file as zero rather than blank", () => {
      expect(formatMemorySize(0)).toBe("0 B");
      expect(formatMemorySize(Number.NaN)).toBe("0 B");
      expect(formatMemorySize(-1)).toBe("0 B");
    });
  });
});
