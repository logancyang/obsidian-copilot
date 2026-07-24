import type { PiUsage } from "@/pi/types";
import { shouldCompactNow } from "./compaction";

function usage(overrides: Partial<PiUsage> = {}): PiUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextTokens: 1000,
    contextWindow: 128_000,
    ...overrides,
  };
}

describe("piCompaction", () => {
  describe("shouldCompactNow()", () => {
    it("leaves a conversation alone while it fits comfortably", () => {
      expect(shouldCompactNow(usage({ contextTokens: 50_000 }))).toBe(false);
    });

    it("asks for compaction once the reserve is eaten into", () => {
      // pi reserves 16384 tokens of headroom.
      expect(shouldCompactNow(usage({ contextTokens: 128_000 - 16_384 + 1 }))).toBe(true);
    });

    it("does not compact right at the reserve boundary", () => {
      expect(shouldCompactNow(usage({ contextTokens: 128_000 - 16_384 }))).toBe(false);
    });

    it("stays put when the window or the count is unknown", () => {
      expect(shouldCompactNow(usage({ contextWindow: 0 }))).toBe(false);
      expect(shouldCompactNow(usage({ contextTokens: 0 }))).toBe(false);
    });

    it("compacts a small-window model far sooner, in absolute tokens", () => {
      expect(shouldCompactNow(usage({ contextTokens: 20_000, contextWindow: 32_768 }))).toBe(true);
    });
  });
});
