import { formatDuration } from "./duration";

describe("formatDuration", () => {
  it("renders sub-second as '< 1s'", () => {
    expect(formatDuration(0)).toBe("< 1s");
    expect(formatDuration(1)).toBe("< 1s");
    expect(formatDuration(999)).toBe("< 1s");
  });

  it("renders sub-minute as Ns", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(59_999)).toBe("59s");
  });

  it("renders minutes as Xm Ys, omitting zero seconds", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(210_000)).toBe("3m 30s");
    expect(formatDuration(300_000)).toBe("5m");
    expect(formatDuration(3_599_000)).toBe("59m 59s");
  });

  it("renders hours as Xh Ym, omitting zero minutes", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(4_320_000)).toBe("1h 12m");
    expect(formatDuration(7_200_000)).toBe("2h");
  });

  it("clamps negatives and non-finite inputs to '< 1s'", () => {
    expect(formatDuration(-1)).toBe("< 1s");
    expect(formatDuration(Number.NaN)).toBe("< 1s");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("< 1s");
  });
});
