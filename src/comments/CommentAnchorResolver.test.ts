import { captureAnchor, resolveAnchor } from "./CommentAnchorResolver";

describe("CommentAnchorResolver", () => {
  const DOC = ["Line 0", "The quick brown fox jumps over the lazy dog.", "Line 2", "Line 3"].join(
    "\n"
  );

  const ORIGINAL_TARGET = "brown fox";

  function anchorForTarget(doc: string, needle: string) {
    const start = doc.indexOf(needle);
    if (start === -1) throw new Error("target not in doc");
    return captureAnchor({ doc, from: start, to: start + needle.length });
  }

  it("resolves identical doc exactly", () => {
    const anchor = anchorForTarget(DOC, ORIGINAL_TARGET);
    const resolved = resolveAnchor(DOC, anchor);
    expect(resolved).not.toBeNull();
    expect(DOC.slice(resolved!.from, resolved!.to)).toBe(ORIGINAL_TARGET);
  });

  it("resolves after inserts before the anchor", () => {
    const anchor = anchorForTarget(DOC, ORIGINAL_TARGET);
    const edited = "PREPENDED LINE\n" + DOC;
    const resolved = resolveAnchor(edited, anchor);
    expect(resolved).not.toBeNull();
    expect(edited.slice(resolved!.from, resolved!.to)).toBe(ORIGINAL_TARGET);
  });

  it("resolves via fuzzy normalization (smart quotes)", () => {
    const anchor = captureAnchor({
      doc: 'He said "hello world" today.',
      from: 9,
      to: 20,
    });
    // Same doc but smart quotes instead of ASCII quotes.
    const edited = "He said \u201Chello world\u201D today.";
    const resolved = resolveAnchor(edited, anchor);
    expect(resolved).not.toBeNull();
  });

  it("returns null when the target text is removed", () => {
    const anchor = anchorForTarget(DOC, ORIGINAL_TARGET);
    const edited = DOC.replace(ORIGINAL_TARGET, "cat");
    // Also break the fuzzy signal by removing the phrase.
    const fullyBroken = edited.replace(/fox/g, "cat");
    const resolved = resolveAnchor(fullyBroken, anchor);
    expect(resolved).toBeNull();
  });
});
