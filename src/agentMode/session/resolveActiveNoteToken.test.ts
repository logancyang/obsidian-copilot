import { mockTFile } from "@/__tests__/mockObsidian";
import { resolveActiveNoteToken } from "./resolveActiveNoteToken";

jest.mock("obsidian", () => ({
  TFile: jest.fn(),
}));

const mockFile = (basename: string) => mockTFile({ basename, path: `${basename}.md` });

describe("resolveActiveNoteToken", () => {
  it("replaces {activeNote} with the active file's wikilink form", () => {
    const out = resolveActiveNoteToken(
      "Summarize {activeNote} in 3 bullets.",
      mockFile("Today's Standup")
    );
    expect(out).toBe("Summarize [[Today's Standup]] in 3 bullets.");
  });

  it("replaces every occurrence", () => {
    const out = resolveActiveNoteToken(
      "Compare {activeNote} against {activeNote}.",
      mockFile("Notes")
    );
    expect(out).toBe("Compare [[Notes]] against [[Notes]].");
  });

  it("leaves the token untouched when there is no active file", () => {
    expect(resolveActiveNoteToken("Summarize {activeNote}", null)).toBe("Summarize {activeNote}");
  });

  it("is a no-op when the token is absent", () => {
    const text = "Summarize [[Some Other Note]] please.";
    expect(resolveActiveNoteToken(text, mockFile("Active"))).toBe(text);
  });

  it("does not touch folder tokens or other curly-brace content", () => {
    const out = resolveActiveNoteToken(
      "Look in {Projects} and summarize {activeNote}.",
      mockFile("Daily")
    );
    expect(out).toBe("Look in {Projects} and summarize [[Daily]].");
  });

  it("treats `{ActiveNote}` (wrong case) as a non-match — only the reserved literal is replaced", () => {
    // `parseTextForPills` matches the reserved token case-sensitively against
    // the literal `activeNote`, so this helper does the same.
    const text = "Mention {ActiveNote} and {activeNote}.";
    expect(resolveActiveNoteToken(text, mockFile("Daily"))).toBe(
      "Mention {ActiveNote} and [[Daily]]."
    );
  });

  it("preserves `$` characters in the basename (no regex-replacement surprises)", () => {
    // Using split/join (not String.prototype.replace with a string pattern,
    // which has no $-interpretation either but is easier to misread). This
    // test pins the safe behavior so future refactors don't reach for
    // replace() and accidentally interpret $1/$& in the basename.
    expect(resolveActiveNoteToken("ref {activeNote} here", mockFile("Q1 $revenue"))).toBe(
      "ref [[Q1 $revenue]] here"
    );
  });
});
