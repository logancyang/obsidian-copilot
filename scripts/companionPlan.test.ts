import { nativePlanResult, planPermission } from "../adapters/companions/plan";

describe("companionPlan", () => {
  describe("planPermission()", () => {
    it("makes native plan content a Copilot plan-review permission", () => {
      expect(
        planPermission({ sessionId: "one", planContent: "# Fix notes" }, "review")
      ).toMatchObject({
        sessionId: "one",
        toolCall: { kind: "switch_mode", rawInput: { plan: "# Fix notes" } },
        options: [
          { optionId: "approve", kind: "allow_once" },
          { optionId: "reject", kind: "reject_once" },
        ],
      });
    });
  });
  describe("nativePlanResult()", () => {
    it("approves implementation only for an explicit selected approval", () =>
      expect(nativePlanResult({ outcome: { outcome: "selected", optionId: "approve" } })).toEqual({
        outcome: "approved",
      }));
    it("keeps planning when the user rejects the plan", () =>
      expect(nativePlanResult({ outcome: { outcome: "selected", optionId: "reject" } })).toEqual({
        outcome: "cancelled",
      }));
    it("does not approve a dismissed or failed permission dialog", () =>
      expect(nativePlanResult(undefined)).toEqual({ outcome: "cancelled" }));
  });
});
