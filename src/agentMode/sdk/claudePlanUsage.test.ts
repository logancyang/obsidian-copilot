import {
  isoToEpochMs,
  planUsageFromClaudeUsage,
  readClaudePlanUsage,
} from "@/agentMode/sdk/claudePlanUsage";

jest.mock("@/logger", () => ({ logInfo: jest.fn() }));

const USAGE_METHOD = "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET";

/** A real response body from the SDK's usage API. */
const LIVE_SNAPSHOT = {
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 10, resets_at: "2026-08-15T04:49:59Z" },
    seven_day: { utilization: 21, resets_at: "2026-08-19T19:59:59Z" },
  },
};

describe("claudePlanUsage", () => {
  describe("planUsageFromClaudeUsage()", () => {
    it("reads both windows as percentages, not fractions", () => {
      // `utilization` is 0-100. The same numbers appear in the response's parallel
      // `limits[]` array under a field named `percent`, which is what settles it.
      const reading = planUsageFromClaudeUsage(LIVE_SNAPSHOT, 1_000);

      expect(reading).toEqual({
        kind: "usage",
        planUsage: {
          windows: [
            { id: "five_hour", label: "5h", percent: 10, resetsAt: 1_786_769_399_000 },
            { id: "seven_day", label: "Weekly", percent: 21, resetsAt: 1_787_169_599_000 },
          ],
          updatedAt: 1_000,
        },
      });
    });

    it("names each per-model window after the model it caps", () => {
      const reading = planUsageFromClaudeUsage({
        rate_limits_available: true,
        rate_limits: {
          model_scoped: [{ display_name: "Fable", utilization: 44, resets_at: null }],
        },
      });

      expect(reading).toMatchObject({
        kind: "usage",
        planUsage: {
          windows: [{ id: "model_scoped:Fable", label: "Weekly (Fable)", percent: 44 }],
        },
      });
    });

    it("reads the qualified weekly buckets the SDK documents (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", () => {
      // A legacy plan's per-model weekly limit arrives as seven_day_opus /
      // seven_day_sonnet, not as model_scoped, and OAuth-app usage has its own weekly
      // bucket. For those accounts these are the caps they can actually hit.
      const reading = planUsageFromClaudeUsage({
        rate_limits_available: true,
        rate_limits: {
          seven_day_oauth_apps: { utilization: 5 },
          seven_day_opus: { utilization: 61 },
          seven_day_sonnet: { utilization: 17 },
        },
      });

      expect(reading).toMatchObject({
        kind: "usage",
        planUsage: {
          windows: [
            { id: "seven_day_oauth_apps", label: "Weekly (OAuth apps)", percent: 5 },
            { id: "seven_day_opus", label: "Weekly (Opus)", percent: 61 },
            { id: "seven_day_sonnet", label: "Weekly (Sonnet)", percent: 17 },
          ],
        },
      });
    });

    it("keeps a percentage above 100 for an account served past its cap", () => {
      const reading = planUsageFromClaudeUsage({
        rate_limits_available: true,
        rate_limits: { seven_day: { utilization: 137 } },
      });

      expect(reading).toMatchObject({ planUsage: { windows: [{ percent: 137 }] } });
    });

    it("keeps a window whose reset timestamp is unusable", () => {
      const reading = planUsageFromClaudeUsage({
        rate_limits_available: true,
        rate_limits: { five_hour: { utilization: 12, resets_at: "not a date" } },
      });

      expect(reading).toMatchObject({
        planUsage: { windows: [{ percent: 12, resetsAt: undefined }] },
      });
    });

    it("skips a window that reports a reset but no utilization", () => {
      const reading = planUsageFromClaudeUsage({
        rate_limits_available: true,
        rate_limits: { five_hour: { resets_at: "2026-08-15T04:49:59Z" } },
      });

      expect(reading).toEqual({ kind: "unavailable" });
    });

    it("ignores codenamed buckets the SDK does not document", () => {
      const reading = planUsageFromClaudeUsage({
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 10 },
          // Buckets like this come and go between SDK releases; rendering one would put
          // an unexplained row in front of the user.
          some_codename: { utilization: 99 },
        } as never,
      });

      expect(reading).toMatchObject({ planUsage: { windows: [{ id: "five_hour" }] } });
    });

    it("reports no caps only when the SDK says plan limits do not apply, so the caller clears what it was showing (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", () => {
      // An API-key, Bedrock, or Vertex login is not metered by plan caps. That is a
      // successful answer, not a failed read: keeping the previous subscription caps
      // on screen would state a limit this account does not have.
      expect(planUsageFromClaudeUsage({ rate_limits_available: false })).toEqual({ kind: "none" });
    });

    it.each([
      ["no response at all", null],
      ["a response carrying no rate limits", { rate_limits_available: true, rate_limits: null }],
      ["a shape we do not recognize", { unexpected: true } as never],
    ])("reports the read unusable for %s rather than clearing the meters", (_label, snapshot) => {
      // Only an explicit "limits do not apply" clears. An answer we could not read is the
      // absence of that statement, so the last good reading stands.
      expect(planUsageFromClaudeUsage(snapshot)).toEqual({ kind: "unavailable" });
    });
  });

  describe("readClaudePlanUsage()", () => {
    it("returns the normalized windows from the live query", async () => {
      const query = { [USAGE_METHOD]: jest.fn().mockResolvedValue(LIVE_SNAPSHOT) };

      const reading = await readClaudePlanUsage(query);

      expect(reading).toMatchObject({
        kind: "usage",
        planUsage: { windows: [{ label: "5h" }, { label: "Weekly" }] },
      });
    });

    it("distinguishes a successful no-caps answer from a failed read", async () => {
      const query = {
        [USAGE_METHOD]: jest.fn().mockResolvedValue({ rate_limits_available: false }),
      };

      await expect(readClaudePlanUsage(query)).resolves.toEqual({ kind: "none" });
    });

    it.each([
      ["the SDK no longer exposes the method", {}],
      [
        "the response is not the shape we validate",
        { [USAGE_METHOD]: () => ({ unexpected: true }) },
      ],
    ])("reports the read unusable when %s", async (_label, query) => {
      // The method name says the API may change or vanish in any release. When it does,
      // the meter keeps showing its last good reading instead of the turn breaking.
      await expect(readClaudePlanUsage(query)).resolves.toEqual({ kind: "unavailable" });
    });

    it("reports the read unusable when the usage call rejects", async () => {
      const query = { [USAGE_METHOD]: jest.fn().mockRejectedValue(new Error("transport closed")) };

      await expect(readClaudePlanUsage(query)).resolves.toEqual({ kind: "unavailable" });
    });

    it.each([
      ["a null query", null],
      ["an undefined query", undefined],
    ])("reports the read unusable for %s", async (_label, query) => {
      await expect(readClaudePlanUsage(query)).resolves.toEqual({ kind: "unavailable" });
    });
  });

  describe("isoToEpochMs()", () => {
    it("converts the ISO 8601 timestamps Claude sends", () => {
      expect(isoToEpochMs("2026-08-15T04:49:59Z")).toBe(1_786_769_399_000);
    });

    it.each([
      ["an unparseable string", "not a date"],
      ["a non-string", 1_786_769_399_000],
      ["null", null],
    ])("returns undefined for %s, costing the countdown but never the meter", (_label, value) => {
      expect(isoToEpochMs(value)).toBeUndefined();
    });
  });
});
