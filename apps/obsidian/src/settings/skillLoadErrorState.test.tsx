import { publishSkillLoadErrorCount, useSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { act, renderHook } from "@testing-library/react";

describe("skillLoadErrorState", () => {
  beforeEach(() => {
    publishSkillLoadErrorCount(0);
  });

  describe("publishSkillLoadErrorCount()", () => {
    it("updates subscribed settings UI with the latest rejected-skill count", () => {
      const { result } = renderHook(() => useSkillLoadErrorCount());

      act(() => publishSkillLoadErrorCount(2));

      expect(result.current).toBe(2);
    });
  });

  describe("useSkillLoadErrorCount()", () => {
    it("starts at zero before skill discovery publishes a result", () => {
      const { result } = renderHook(() => useSkillLoadErrorCount());

      expect(result.current).toBe(0);
    });
  });
});
