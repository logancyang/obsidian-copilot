import type { PlanUsage } from "@/agentMode/session/planUsage";
import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import { usePlanUsage } from "@/agentMode/ui/hooks/usePlanUsage";
import { act, renderHook } from "@testing-library/react";

const planUsage = (percent: number): PlanUsage => ({
  windows: [{ id: "weekly", label: "Weekly", percent }],
  updatedAt: 1,
});

describe("usePlanUsage", () => {
  describe("usePlanUsage()", () => {
    it("returns null until the session reports plan usage and follows later changes", () => {
      const fixture = createFixtureClient({ sessionId: "s1" });
      const { result } = renderHook(() => usePlanUsage(fixture.client, "s1"));
      expect(result.current).toBeNull();

      act(() => fixture.emitSession({ t: "slice", key: "planUsage", value: planUsage(15) }));

      expect(result.current).toEqual(planUsage(15));
    });
  });
});
