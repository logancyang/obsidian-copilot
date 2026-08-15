import {
  planUsageReading,
  toUsagePercent,
  withoutExpiredWindows,
  type UsageWindow,
} from "@/agentMode/session/planUsage";

const WEEKLY: UsageWindow = { id: "weekly", label: "Weekly", percent: 21, resetsAt: 2_000 };
const FIVE_HOUR: UsageWindow = { id: "five_hour", label: "5h", percent: 10, resetsAt: 1_500 };

describe("planUsage", () => {
  describe("toUsagePercent()", () => {
    it("passes a percentage above 100 through unclamped", () => {
      // An account still being served past its cap is genuinely over. Clamping would make
      // "just hit the cap" and "far past it" look identical.
      expect(toUsagePercent(137)).toBe(137);
    });

    it("floors a negative percentage at zero", () => {
      expect(toUsagePercent(-5)).toBe(0);
    });

    it.each([
      ["a non-number", "21"],
      ["NaN", Number.NaN],
      ["infinity", Number.POSITIVE_INFINITY],
      ["null", null],
    ])("returns null for %s", (_label, value) => {
      expect(toUsagePercent(value)).toBeNull();
    });
  });

  describe("planUsageReading()", () => {
    it("reports usage when at least one window was normalized", () => {
      expect(planUsageReading([WEEKLY], 1_000)).toEqual({
        kind: "usage",
        planUsage: { windows: [WEEKLY], updatedAt: 1_000 },
      });
    });

    it("reports an empty window list unusable rather than clearing the meters (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", () => {
      // Never 0% used, and never "this account has no caps" either. Only a provider
      // explicitly saying limits do not apply justifies clearing; a payload we could not
      // read is the absence of that statement, so the last good reading stands.
      expect(planUsageReading([])).toEqual({ kind: "unavailable" });
    });
  });

  describe("withoutExpiredWindows()", () => {
    it("drops a window whose reset has passed (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", () => {
      // A backend process outlives many chats. Replaying a snapshot taken before a reset
      // would show the previous period's percentage as if it were the current one.
      const planUsage = { windows: [FIVE_HOUR, WEEKLY], updatedAt: 1_000 };

      expect(withoutExpiredWindows(planUsage, 1_800)).toEqual({
        windows: [WEEKLY],
        updatedAt: 1_000,
      });
    });

    it("returns null once every window has reset", () => {
      const planUsage = { windows: [FIVE_HOUR, WEEKLY], updatedAt: 1_000 };

      expect(withoutExpiredWindows(planUsage, 9_000)).toBeNull();
    });

    it("keeps a window with no reset time, which carries no claim we can falsify", () => {
      const planUsage = { windows: [{ id: "weekly", label: "Weekly", percent: 21 }], updatedAt: 1 };

      expect(withoutExpiredWindows(planUsage, 9_000)).toBe(planUsage);
    });

    it("returns the same object when nothing expired, so React skips the re-render", () => {
      const planUsage = { windows: [WEEKLY], updatedAt: 1_000 };

      expect(withoutExpiredWindows(planUsage, 1_000)).toBe(planUsage);
    });
  });
});
