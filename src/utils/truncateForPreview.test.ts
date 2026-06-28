import { PREVIEW_RENDER_LIMIT, truncateForPreview } from "@/utils/truncateForPreview";

describe("truncateForPreview", () => {
  it("returns short content unchanged", () => {
    const content = "# Title\n\nsome body text";
    expect(truncateForPreview(content)).toEqual({ text: content, truncated: false });
  });

  it("returns content at exactly the limit unchanged", () => {
    const content = "a".repeat(PREVIEW_RENDER_LIMIT);
    expect(truncateForPreview(content)).toEqual({ text: content, truncated: false });
  });

  it("truncates oversized content and flags it", () => {
    const content = "a".repeat(PREVIEW_RENDER_LIMIT + 500);
    const result = truncateForPreview(content);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(PREVIEW_RENDER_LIMIT);
  });

  it("backs the cut up to the last newline at or before the limit", () => {
    // Newline sits 5 chars before the limit; the cut should land on it so the
    // rendered slice ends on a clean line boundary.
    const head = "x".repeat(PREVIEW_RENDER_LIMIT - 5);
    const content = `${head}\n${"y".repeat(100)}`;
    const result = truncateForPreview(content);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe(head);
  });

  it("hard-cuts at the limit when no newline is in range", () => {
    const content = "z".repeat(PREVIEW_RENDER_LIMIT + 200);
    const result = truncateForPreview(content, 50);
    expect(result.text).toBe("z".repeat(50));
    expect(result.truncated).toBe(true);
  });

  it("keeps the full budget when the only newline is far before the limit (one giant line)", () => {
    // Mirrors a one-line JSON/spreadsheet dump: a short header line, then a
    // huge unbroken line. Snapping back to the header newline would collapse
    // the preview, so we must hard-cut at the limit instead.
    const content = `head\n${"x".repeat(PREVIEW_RENDER_LIMIT * 2)}`;
    const result = truncateForPreview(content);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(PREVIEW_RENDER_LIMIT);
  });

  it("handles an empty string", () => {
    expect(truncateForPreview("")).toEqual({ text: "", truncated: false });
  });
});
