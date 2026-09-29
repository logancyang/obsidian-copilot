import type { SessionUsage } from "@/agentMode/session/types";
import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import { useSessionUsage } from "@/agentMode/ui/hooks/useSessionUsage";
import { act, renderHook } from "@testing-library/react";

const usage = (usedTokens: number): SessionUsage => ({ usedTokens, updatedAt: 1 });

describe("useSessionUsage", () => {
  describe("useSessionUsage()", () => {
    it("returns the session's usage from the replica", () => {
      const fixture = createFixtureClient({ sessionId: "s1", session: { usage: usage(10) } });
      const { result } = renderHook(() => useSessionUsage(fixture.client, "s1"));
      expect(result.current).toEqual(usage(10));
    });

    it("returns null when the session has no usage yet", () => {
      const fixture = createFixtureClient({ sessionId: "s1" });
      const { result } = renderHook(() => useSessionUsage(fixture.client, "s1"));
      expect(result.current).toBeNull();
    });

    it("follows the host when the usage changes", () => {
      const fixture = createFixtureClient({ sessionId: "s1" });
      const { result } = renderHook(() => useSessionUsage(fixture.client, "s1"));

      act(() => fixture.emitSession({ t: "slice", key: "usage", value: usage(42) }));

      expect(result.current).toEqual(usage(42));
    });
  });
});
