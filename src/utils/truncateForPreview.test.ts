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
    const content = `head\n${"x".repeat(PREVIEW_RENDER_LIMIT * 2)}`;
    const result = truncateForPreview(content);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(PREVIEW_RENDER_LIMIT);
  });

  it("handles an empty string", () => {
    expect(truncateForPreview("")).toEqual({ text: "", truncated: false });
  });
});
