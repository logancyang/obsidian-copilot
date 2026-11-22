import { howToRunSection, SHELL_TOOL_SENTENCE } from "./howToRunSection";

describe("howToRunSection", () => {
  describe("howToRunSection()", () => {
    const opts = { shFile: "tool.sh", cmdFile: "tool.cmd", argPlaceholder: "query" };

    it("shows the sh command for macOS/Linux and the &-prefixed cmd wrapper for PowerShell, both passed the placeholder", () => {
      const section = howToRunSection(opts);

      expect(section).toContain('sh "/absolute/path/to/this/skill/directory/tool.sh" "query"');
      expect(section).toContain('& "/absolute/path/to/this/skill/directory/tool.cmd" "query"');
      expect(section).toContain(SHELL_TOOL_SENTENCE);
    });
  });
});
