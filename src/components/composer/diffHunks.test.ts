import {
  analyzePatch,
  hunkToPatchString,
  reconstructFromHunkDecisions,
  reconstructFromLineDecisions,
  type Decision,
} from "./diffHunks";

/**
 * Tests for {@link ./diffHunks}.
 *
 * The reconstruction functions are the critical bit — they're what runs when
 * the user clicks "Apply". A bug here writes the wrong text to disk. Tests
 * cover:
 *
 *  - no-op cases (zero hunks, all-rejected)
 *  - all-accepted ≡ proposed newText (the default-accept UX must be lossless)
 *  - mixed accept/reject at hunk granularity
 *  - line-level rejection inside a single hunk
 *  - hunks at file boundaries (start, end, trailing-newline edge case)
 */

// Three changes spaced wide enough (>= 7 unchanged lines apart) that the
// default context=3 cannot merge them — yielding three independent hunks
// suitable for testing partial-accept behavior.
const OLD = Array.from({ length: 24 }, (_, i) => `line ${String(i + 1).padStart(2, "0")}`).join(
  "\n"
);

const NEW = OLD.split("\n")
  .map((l, i) => {
    if (i === 1) return `${l} CHANGED`;
    if (i === 11) return `${l} MODIFIED`;
    if (i === 21) return `${l} TWEAKED`;
    return l;
  })
  .join("\n");

describe("analyzePatch", () => {
  it("returns no hunks when texts are identical", () => {
    const { parsed, changes } = analyzePatch("f.md", OLD, OLD);
    expect(parsed.hunks).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  it("extracts every added/removed line as a LineChange", () => {
    const { changes } = analyzePatch("f.md", OLD, NEW);
    // Three modifications => six change lines (3 removes + 3 adds).
    expect(changes.filter((c) => c.kind === "+")).toHaveLength(3);
    expect(changes.filter((c) => c.kind === "-")).toHaveLength(3);
    // Content should be the line without its diff-prefix.
    const adds = changes.filter((c) => c.kind === "+").map((c) => c.content);
    expect(adds).toContain("line 02 CHANGED");
    expect(adds).toContain("line 12 MODIFIED");
    expect(adds).toContain("line 22 TWEAKED");
  });

  it("produces one hunk per well-separated change region", () => {
    // With 10 unchanged lines between each change and default context=3,
    // each change gets its own hunk.
    const { parsed } = analyzePatch("f.md", OLD, NEW, 3);
    expect(parsed.hunks).toHaveLength(3);
  });
});

describe("hunkToPatchString", () => {
  it("emits a self-contained unified diff Pierre can parse", () => {
    const { parsed } = analyzePatch("f.md", OLD, NEW);
    const patchString = hunkToPatchString("f.md", parsed.hunks[0]);
    expect(patchString.startsWith("--- f.md\n+++ f.md\n@@ ")).toBe(true);
    // Must contain the hunk header coordinates from the source hunk.
    const h = parsed.hunks[0];
    expect(patchString).toContain(
      `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`
    );
  });
});

describe("reconstructFromHunkDecisions", () => {
  it("returns oldText unchanged when no hunks", () => {
    const { parsed } = analyzePatch("f.md", OLD, OLD);
    const result = reconstructFromHunkDecisions(OLD, parsed, new Map());
    expect(result).toBe(OLD);
  });

  it("returns oldText when every hunk is rejected", () => {
    const { parsed } = analyzePatch("f.md", OLD, NEW);
    const decisions = new Map<number, Decision>(
      parsed.hunks.map((_, i) => [i, "reject" as Decision])
    );
    const result = reconstructFromHunkDecisions(OLD, parsed, decisions);
    expect(result).toBe(OLD);
  });

  it("returns newText when every hunk is accepted (default)", () => {
    const { parsed } = analyzePatch("f.md", OLD, NEW);
    const result = reconstructFromHunkDecisions(OLD, parsed, new Map());
    expect(result).toBe(NEW);
  });

  it("applies only the accepted hunks (rejected hunks fall back to old lines)", () => {
    const { parsed } = analyzePatch("f.md", OLD, NEW);
    // Accept the first hunk only.
    const decisions = new Map<number, Decision>([[0, "accept"]]);
    for (let i = 1; i < parsed.hunks.length; i++) {
      decisions.set(i, "reject");
    }
    const result = reconstructFromHunkDecisions(OLD, parsed, decisions);
    // First-hunk change should be present, later changes should NOT be.
    expect(result).toContain("line 02 CHANGED");
    expect(result).not.toContain("line 12 MODIFIED");
    expect(result).not.toContain("line 22 TWEAKED");
  });
});

describe("reconstructFromLineDecisions", () => {
  it("returns newText when every change line is accepted", () => {
    const { parsed } = analyzePatch("f.md", OLD, NEW);
    const result = reconstructFromLineDecisions(OLD, parsed, new Map());
    expect(result).toBe(NEW);
  });

  it("returns oldText when every change line is rejected", () => {
    const { parsed, changes } = analyzePatch("f.md", OLD, NEW);
    const decisions = new Map<string, Decision>(
      changes.map((c) => [`${c.hunkIndex}:${c.lineIndex}`, "reject"])
    );
    const result = reconstructFromLineDecisions(OLD, parsed, decisions);
    expect(result).toBe(OLD);
  });

  it("can accept an addition while rejecting its paired removal", () => {
    // Construct a simple one-line replacement scenario so line indices are
    // predictable. Replacing "two" with "TWO" should yield, when the addition
    // is accepted but the removal is rejected, a result that contains BOTH
    // lines (the original kept, the new line inserted alongside).
    const oldText = "one\ntwo\nthree";
    const newText = "one\nTWO\nthree";
    const { parsed, changes } = analyzePatch("f.md", oldText, newText);

    // Find the - line and the + line.
    const removal = changes.find((c) => c.kind === "-")!;
    const addition = changes.find((c) => c.kind === "+")!;
    const decisions = new Map<string, Decision>();
    decisions.set(`${removal.hunkIndex}:${removal.lineIndex}`, "reject");
    decisions.set(`${addition.hunkIndex}:${addition.lineIndex}`, "accept");

    const result = reconstructFromLineDecisions(oldText, parsed, decisions);
    expect(result).toContain("one");
    expect(result).toContain("two"); // original kept (removal rejected)
    expect(result).toContain("TWO"); // addition accepted
    expect(result).toContain("three");
  });

  it("can reject an addition while accepting its paired removal", () => {
    const oldText = "one\ntwo\nthree";
    const newText = "one\nTWO\nthree";
    const { parsed, changes } = analyzePatch("f.md", oldText, newText);

    const removal = changes.find((c) => c.kind === "-")!;
    const addition = changes.find((c) => c.kind === "+")!;
    const decisions = new Map<string, Decision>();
    decisions.set(`${removal.hunkIndex}:${removal.lineIndex}`, "accept");
    decisions.set(`${addition.hunkIndex}:${addition.lineIndex}`, "reject");

    const result = reconstructFromLineDecisions(oldText, parsed, decisions);
    // Removal accepted means line gone; addition rejected means new line not added.
    expect(result).toBe("one\nthree");
  });
});

describe("file-boundary edge cases", () => {
  it("handles a change at the very first line", () => {
    const oldText = "first\nbody\nlast";
    const newText = "FIRST\nbody\nlast";
    const { parsed } = analyzePatch("f.md", oldText, newText);
    const result = reconstructFromHunkDecisions(oldText, parsed, new Map());
    expect(result).toBe(newText);
  });

  it("handles a change at the very last line", () => {
    const oldText = "first\nbody\nlast";
    const newText = "first\nbody\nLAST";
    const { parsed } = analyzePatch("f.md", oldText, newText);
    const result = reconstructFromHunkDecisions(oldText, parsed, new Map());
    expect(result).toBe(newText);
  });

  it("preserves a trailing newline if the original had one", () => {
    const oldText = "a\nb\nc\n";
    const newText = "a\nB\nc\n";
    const { parsed } = analyzePatch("f.md", oldText, newText);
    const result = reconstructFromHunkDecisions(oldText, parsed, new Map());
    expect(result).toBe(newText);
  });
});
