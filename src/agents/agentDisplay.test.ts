import { formatMemorySize, formatMissingAgentLabel } from "@/agents/agentDisplay";

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

  describe("formatMissingAgentLabel()", () => {
    it("reads a slug back as the name a deleted agent's chat still shows", () => {
      // A chat persists only the slug, so a deleted agent's label is derived
      // from it. See `designdocs/CUSTOM_AGENTS.md` §1 and §8.
      expect(formatMissingAgentLabel("jennifer")).toBe("Jennifer");
      expect(formatMissingAgentLabel("night-editor")).toBe("Night Editor");
    });

    it("drops the empty segments a collision suffix or a stray hyphen leaves", () => {
      expect(formatMissingAgentLabel("jennifer--2")).toBe("Jennifer 2");
      expect(formatMissingAgentLabel("")).toBe("");
    });
  });
});
