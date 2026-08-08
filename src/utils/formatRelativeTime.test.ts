import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";

const NOW = 1_700_000_000_000;
const ago = (ms: number) => formatCompactRelativeTime(NOW - ms, NOW);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

describe("formatCompactRelativeTime", () => {
  it("renders sub-minute and future ages as 'now'", () => {
    expect(ago(0)).toBe("now");
    expect(ago(59 * SECOND)).toBe("now");
    expect(formatCompactRelativeTime(NOW + 5 * MINUTE, NOW)).toBe("now");
  });

  it("renders minutes up to the hour boundary", () => {
    expect(ago(MINUTE)).toBe("1m");
    expect(ago(59 * MINUTE)).toBe("59m");
  });

  it("renders hours up to the day boundary", () => {
    expect(ago(HOUR)).toBe("1h");
    expect(ago(23 * HOUR)).toBe("23h");
  });

  it("renders days up to the week boundary", () => {
    expect(ago(DAY)).toBe("1d");
    expect(ago(6 * DAY)).toBe("6d");
  });

  it("renders weeks up to the month boundary", () => {
    expect(ago(WEEK)).toBe("1w");
    expect(ago(29 * DAY)).toBe("4w");
  });

  it("renders months past 30 days", () => {
    expect(ago(MONTH)).toBe("1mo");
    expect(ago(75 * DAY)).toBe("2mo");
  });

  it("renders 'now' for non-finite ages (e.g. an Invalid Date's NaN)", () => {
    expect(formatCompactRelativeTime(NaN, NOW)).toBe("now");
    expect(formatCompactRelativeTime(NOW, NaN)).toBe("now");
    expect(formatCompactRelativeTime(Infinity, NOW)).toBe("now");
  });
});
