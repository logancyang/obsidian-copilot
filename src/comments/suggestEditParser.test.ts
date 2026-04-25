import { parseSuggestEditReply } from "./suggestEditParser";

describe("parseSuggestEditReply", () => {
  it("returns text when no tag is present", () => {
    const out = parseSuggestEditReply("Hello there, nothing to propose.");
    expect(out.conversationalText).toBe("Hello there, nothing to propose.");
    expect(out.proposedEdit).toBeUndefined();
  });

  it("extracts a clean suggest_edit block", () => {
    const text = [
      "Here is a tighter version:",
      "<suggest_edit>",
      "This is the revised text.",
      "</suggest_edit>",
      "",
      "Let me know if you want other variations.",
    ].join("\n");
    const out = parseSuggestEditReply(text);
    expect(out.proposedEdit).toBe("This is the revised text.");
    expect(out.conversationalText).toContain("Here is a tighter version:");
    expect(out.conversationalText).toContain("Let me know if you want other variations.");
  });

  it("ignores tags inside fenced code blocks", () => {
    const text = [
      "Example protocol:",
      "```",
      "<suggest_edit>",
      "this should NOT be parsed",
      "</suggest_edit>",
      "```",
    ].join("\n");
    const out = parseSuggestEditReply(text);
    expect(out.proposedEdit).toBeUndefined();
    expect(out.conversationalText).toContain("Example protocol");
  });

  it("returns text unchanged when the open tag lacks a close tag", () => {
    const text = "<suggest_edit>\nincomplete";
    const out = parseSuggestEditReply(text);
    expect(out.proposedEdit).toBeUndefined();
    expect(out.conversationalText).toBe(text);
  });

  it("only uses the first tag pair", () => {
    const text = [
      "<suggest_edit>",
      "First version",
      "</suggest_edit>",
      "<suggest_edit>",
      "Second version",
      "</suggest_edit>",
    ].join("\n");
    const out = parseSuggestEditReply(text);
    expect(out.proposedEdit).toBe("First version");
    // Residual second tag block is preserved as-is in conversational text.
    expect(out.conversationalText).toContain("Second version");
  });
});
