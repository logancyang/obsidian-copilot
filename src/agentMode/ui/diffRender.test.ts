import { renderDiff } from "@/agentMode/ui/diffRender";

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/350";

describe("diffRender", () => {
  describe("renderDiff()", () => {
    it(`shows only the changed hunk and three context lines for a one-word edit in a long note (${issue})`, () => {
      const before = Array.from({ length: 200 }, (_, i) => `Line ${i + 1} original`).join("\n");
      const output = renderDiff(before, before.replace("Line 100 original", "Line 100 revised"));
      expect(output).toContain("@@ -97,7 +97,7 @@");
      expect(output).toContain("-Line 100 original\n+Line 100 revised");
      expect(output).toContain(" Line 97 original");
      expect(output).toContain(" Line 103 original");
      expect(output).not.toContain("Line 96 original");
      expect(output).not.toContain("Line 104 original");
      expect(output.split("\n")).toHaveLength(9);
    });

    it(`shows separate hunks for distant changes without losing either edit (${issue})`, () => {
      const before = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n");
      const after = before
        .replace("Line 10\n", "First revision\n")
        .replace("Line 90\n", "Second revision\n");
      const output = renderDiff(before, after);
      expect(output.match(/^@@/gm)).toHaveLength(2);
      expect(output).toContain("+First revision");
      expect(output).toContain("+Second revision");
      expect(output).not.toContain("Line 50");
    });

    it(`preserves Markdown hard-break spaces, indentation and tabs (${issue})`, () => {
      const output = renderDiff("first\n- item\n\tcode\n", "first  \n  - item\n\tchanged\n");
      expect(output).toContain("+first  \n");
      expect(output).toContain("+  - item\n");
      expect(output).toContain("+\tchanged");
    });

    it(`shows every line of a new note as an addition without a synthetic trailing blank line (${issue})`, () => {
      const output = renderDiff(null, "# New note\n\nLast line\n");
      expect(output).toContain("+# New note\n+\n+Last line");
      expect(output.split("\n").filter((line) => line.startsWith("+"))).toHaveLength(3);
    });

    it(`preserves the difference between a final newline and no final newline (${issue})`, () => {
      expect(renderDiff("last", "last\n")).toContain("-last\n\\ No newline at end of file\n+last");
    });

    it(`shows deletions when a note becomes empty (${issue})`, () => {
      const output = renderDiff("removed\n", "");
      expect(output).toContain("-removed");
      expect(output.split("\n").some((line) => line.startsWith("+"))).toBe(false);
    });

    it(`reports no changes for identical snapshots (${issue})`, () => {
      expect(renderDiff("unchanged\n", "unchanged\n")).toBe("No changes");
    });
  });
});
