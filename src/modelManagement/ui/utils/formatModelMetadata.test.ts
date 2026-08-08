import { formatContextWindow, formatReleaseDate } from "./formatModelMetadata";

describe("formatContextWindow", () => {
  it("returns empty string for missing or zero", () => {
    expect(formatContextWindow(undefined)).toBe("");
    expect(formatContextWindow(0)).toBe("");
  });

  it("renders sub-thousand values verbatim", () => {
    expect(formatContextWindow(512)).toBe("512");
  });

  it("renders thousands with a rounded K suffix", () => {
    expect(formatContextWindow(1000)).toBe("1K");
    expect(formatContextWindow(128000)).toBe("128K");
    expect(formatContextWindow(200000)).toBe("200K");
  });

  it("renders millions with an M suffix and trims trailing .0", () => {
    expect(formatContextWindow(1_000_000)).toBe("1M");
    expect(formatContextWindow(1_500_000)).toBe("1.5M");
    expect(formatContextWindow(2_000_000)).toBe("2M");
  });
});

describe("formatReleaseDate", () => {
  it("returns empty string for missing or unparseable input", () => {
    expect(formatReleaseDate(undefined)).toBe("");
    expect(formatReleaseDate("")).toBe("");
    expect(formatReleaseDate("not-a-date")).toBe("");
  });

  it("formats an ISO date as short month + 2-digit year", () => {
    const result = formatReleaseDate("2025-09-15");
    expect(result).toContain("Sep");
    expect(result).toContain("25");
  });

  it("does not shift the month for first-of-month dates in any timezone", () => {
    // Date-only strings parse as UTC midnight; formatting must stay in UTC
    // so a negative-offset host doesn't render this as "Aug 25".
    expect(formatReleaseDate("2025-09-01")).toBe("Sep 25");
    expect(formatReleaseDate("2025-01-01")).toBe("Jan 25");
  });
});
