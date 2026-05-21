import { mockTFile } from "@/__tests__/mockObsidian";
import { resolveActiveNoteToken } from "./resolveActiveNoteToken";

jest.mock("obsidian", () => ({
  TFile: jest.fn(),
}));

const mockFile = (basename: string, extension = "md") =>
  mockTFile({ basename, extension, path: `${basename}.${extension}` });

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
    const text = "Mention {ActiveNote} and {activeNote}.";
    expect(resolveActiveNoteToken(text, mockFile("Daily"))).toBe(
      "Mention {ActiveNote} and [[Daily]]."
    );
  });

  // split/join (not String.prototype.replace) avoids `$&`/`$1` interpretation in the basename.
  it("preserves `$` characters in the basename (no regex-replacement surprises)", () => {
    expect(resolveActiveNoteToken("ref {activeNote} here", mockFile("Q1 $revenue"))).toBe(
      "ref [[Q1 $revenue]] here"
    );
  });

  it("keeps the extension on non-markdown active files (matches NotePillNode serialization)", () => {
    expect(resolveActiveNoteToken("Summarize {activeNote}", mockFile("Spec", "pdf"))).toBe(
      "Summarize [[Spec.pdf]]"
    );
    expect(resolveActiveNoteToken("Open {activeNote}", mockFile("Mindmap", "canvas"))).toBe(
      "Open [[Mindmap.canvas]]"
    );
  });
});
