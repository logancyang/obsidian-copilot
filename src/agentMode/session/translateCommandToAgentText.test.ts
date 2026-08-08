import { mockTFile } from "@/__tests__/mockObsidian";
import { translateCommandToAgentText } from "@/agentMode/session/translateCommandToAgentText";

jest.mock("obsidian", () => ({ TFile: jest.fn() }));

const mockFile = (basename: string, extension = "md") =>
  mockTFile({ basename, extension, path: `${basename}.${extension}` });

describe("translateCommandToAgentText", () => {
  it("leaves a body with no tokens untouched (no trailing whitespace)", () => {
    expect(translateCommandToAgentText("Summarize this note.", "", null)).toBe(
      "Summarize this note."
    );
  });

  it("rewrites {activeNote} to a [[wikilink]] reference, never an inlined body", () => {
    const out = translateCommandToAgentText(
      "Summarize the {activeNote} using the [[Meeting Notes Summarization Prompt]].",
      "",
      mockFile("Ruby Mailchimp Changes")
    );
    expect(out).toBe(
      "Summarize the [[Ruby Mailchimp Changes]] using the [[Meeting Notes Summarization Prompt]]."
    );
    expect(out).not.toContain('<variable name="activeNote">');
  });

  it("rewrites lowercase {activenote} used by existing custom prompts", () => {
    expect(translateCommandToAgentText("Summarize {activenote}.", "", mockFile("Daily"))).toBe(
      "Summarize [[Daily]]."
    );
  });

  it("preserves lowercase {activenote} when no active file is available", () => {
    expect(translateCommandToAgentText("Summarize {activenote}.", "", null)).toBe(
      "Summarize {activenote}."
    );
  });

  it("strips the braces from {[[Note Title]]} into a bare [[wikilink]]", () => {
    expect(translateCommandToAgentText("Use {[[Some Prompt]]} now.", "", null)).toBe(
      "Use [[Some Prompt]] now."
    );
  });

  it("inlines selected text for {} and {copilot-selection}", () => {
    expect(translateCommandToAgentText("Rewrite this: {}", "the selected paragraph", null)).toBe(
      "Rewrite this: the selected paragraph"
    );
    expect(translateCommandToAgentText("Fix {copilot-selection}", "broken text", null)).toBe(
      "Fix broken text"
    );
  });

  it("falls back to the active-note reference for {} when there is no selection", () => {
    expect(translateCommandToAgentText("Summarize: {}", "", mockFile("Today"))).toBe(
      "Summarize: [[Today]]"
    );
  });

  it("does not treat `$` in the selection as a replacement pattern", () => {
    expect(translateCommandToAgentText("Echo {}", "$1 and $&", null)).toBe("Echo $1 and $&");
  });

  it("hands a {#tag} reference to the agent as a bare tag, not a pre-expanded note list", () => {
    expect(translateCommandToAgentText("Review {#meeting, #ruby}", "", null)).toBe(
      "Review #meeting, #ruby"
    );
  });

  it("hands a {folder/path} reference to the agent as a bare path", () => {
    expect(translateCommandToAgentText("Summarize {00_Inbox}", "", null)).toBe(
      "Summarize 00_Inbox"
    );
  });

  it("leaves {activeWebTab} untouched for the send path to resolve", () => {
    expect(translateCommandToAgentText("Summarize {activeWebTab}", "", null)).toBe(
      "Summarize {activeWebTab}"
    );
  });

  it("leaves a JSON object literal untouched", () => {
    expect(translateCommandToAgentText('Return {"key": "value"} as-is', "", null)).toBe(
      'Return {"key": "value"} as-is'
    );
  });
});
