import type { PlanUsage } from "@copilot/protocol/planUsage";
import {
  applySessionOp,
  EMPTY_SESSION_STATE,
  type SessionOp,
  type SessionState,
} from "@copilot/protocol/session";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

const USAGE: SessionUsage = { usedTokens: 52_500, contextWindow: 1_000_000, updatedAt: 1_000 };
const PLAN_USAGE: PlanUsage = {
  windows: [{ id: "seven_day", label: "Weekly", percent: 17, resetsAt: 9_000 }],
  updatedAt: 1_000,
};

describe("session", () => {
  describe("applySessionOp()", () => {
    it("replaces the usage slice and keeps the plan usage slice", () => {
      const state: SessionState = { usage: null, planUsage: PLAN_USAGE };

      const next = applySessionOp(state, { type: "slice", key: "usage", value: USAGE });

      expect(next).toEqual({ usage: USAGE, planUsage: PLAN_USAGE });
      expect(next.planUsage).toBe(PLAN_USAGE);
    });

    it("replaces the plan usage slice, including clearing it to null", () => {
      const withPlan = applySessionOp(EMPTY_SESSION_STATE, {
        type: "slice",
        key: "planUsage",
        value: PLAN_USAGE,
      });
      const cleared = applySessionOp(withPlan, { type: "slice", key: "planUsage", value: null });

      expect(withPlan.planUsage).toBe(PLAN_USAGE);
      expect(cleared).toEqual(EMPTY_SESSION_STATE);
    });

    it("leaves the given state untouched and returns a new state for a change", () => {
      const state: SessionState = { usage: null, planUsage: null };

      const next = applySessionOp(state, { type: "slice", key: "usage", value: USAGE });

      expect(state).toEqual({ usage: null, planUsage: null });
      expect(next).not.toBe(state);
    });

    it("returns the same state when an op sets a slice to the value it already holds", () => {
      const state: SessionState = { usage: USAGE, planUsage: null };

      expect(applySessionOp(state, { type: "slice", key: "usage", value: USAGE })).toBe(state);
    });

    it("produces the same state from the same ops without reading a clock or a random source", () => {
      const ops: SessionOp[] = [
        { type: "slice", key: "usage", value: USAGE },
        { type: "slice", key: "planUsage", value: PLAN_USAGE },
        { type: "slice", key: "usage", value: { ...USAGE, usedTokens: 60_000 } },
      ];
      const forbidden = [
        jest.spyOn(Date, "now"),
        jest.spyOn(Math, "random"),
        jest.spyOn(performance, "now"),
        jest.spyOn(crypto, "getRandomValues"),
      ];
      for (const spy of forbidden) {
        spy.mockImplementation(() => {
          throw new Error("apply read a clock or a random source");
        });
      }
      const replay = () => ops.reduce(applySessionOp, EMPTY_SESSION_STATE);

      try {
        expect(replay()).toEqual(replay());
        expect(replay()).toEqual({
          usage: { ...USAGE, usedTokens: 60_000 },
          planUsage: PLAN_USAGE,
        });
      } finally {
        for (const spy of forbidden) spy.mockRestore();
      }
    });
  });
});
