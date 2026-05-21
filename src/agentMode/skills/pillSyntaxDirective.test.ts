import { buildPillSyntaxDirective } from "./pillSyntaxDirective";

describe("buildPillSyntaxDirective", () => {
  const directive = buildPillSyntaxDirective();

  it("documents the three pill token shapes", () => {
    expect(directive).toContain("[[note_title]]");
    expect(directive).toContain("{folder_name}");
    expect(directive).toContain("{activeNote}");
  });

  it("frames the tokens as concrete references, not template placeholders", () => {
    expect(directive).toMatch(/concrete references/i);
    expect(directive).toMatch(/NOT as template placeholders/);
  });

  it("gives the agent a usable folder-scoping pattern", () => {
    expect(directive).toContain("folder_name/**");
    expect(directive).toMatch(/\bglob\b/);
    expect(directive).toMatch(/\bgrep\b/);
  });

  it("tells the agent to use `read`/`edit` for notes, not infer from title", () => {
    expect(directive).toMatch(/\bread\b/);
    expect(directive).toMatch(/never infer/i);
  });

  it("instructs the agent to cite notes with `[[title]]` in replies", () => {
    expect(directive).toMatch(/\[\[title\]\]/);
  });

  it("takes no arguments and produces a stable string", () => {
    expect(buildPillSyntaxDirective()).toBe(directive);
  });

  it("has no leading or trailing whitespace", () => {
    expect(directive).toBe(directive.trim());
  });
});
