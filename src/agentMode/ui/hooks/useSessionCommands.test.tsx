import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import { useSessionCommands } from "@/agentMode/ui/hooks/useSessionCommands";
import { logWarn } from "@/logger";
import { renderHook } from "@testing-library/react";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const mockNotice = jest.fn();
jest.mock("obsidian", () => ({
  Notice: function Notice(message: string) {
    mockNotice(message);
  },
}));

const SESSION_ID = "s1";

describe("useSessionCommands", () => {
  describe("useSessionCommands()", () => {
    beforeEach(() => {
      jest.mocked(logWarn).mockClear();
      mockNotice.mockClear();
    });

    it("sends each pane action as the matching command for its session", async () => {
      const fixture = createFixtureClient({ sessionId: SESSION_ID });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await result.current.resolvePermission("call-1", "allow_once");
      await result.current.answerQuestion("ask-1", { Which: "Yes" });
      await result.current.resolvePlan("plan-1", "feedback", "Shorter");

      expect(fixture.commands).toEqual([
        {
          name: "resolvePermission",
          sessionId: SESSION_ID,
          toolCallId: "call-1",
          optionId: "allow_once",
        },
        {
          name: "answerQuestion",
          sessionId: SESSION_ID,
          requestId: "ask-1",
          answers: { Which: "Yes" },
        },
        {
          name: "resolvePlan",
          sessionId: SESSION_ID,
          proposalId: "plan-1",
          decision: "feedback",
          feedbackText: "Shorter",
        },
      ]);
    });

    it("returns the host's result without a warning when the command succeeds", async () => {
      const fixture = createFixtureClient({ sessionId: SESSION_ID });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await expect(result.current.resolvePermission("call-1", "allow_once")).resolves.toEqual({
        ok: true,
        value: undefined,
      });
      expect(logWarn).not.toHaveBeenCalled();
      expect(mockNotice).not.toHaveBeenCalled();
    });

    it("stays silent when another device already answered the prompt (stale)", async () => {
      const fixture = createFixtureClient({
        sessionId: SESSION_ID,
        onCommand: () => ({ ok: false, code: "stale", message: "already resolved" }),
      });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await expect(result.current.answerQuestion("ask-1", {})).resolves.toMatchObject({
        ok: false,
        code: "stale",
      });
      expect(logWarn).not.toHaveBeenCalled();
      expect(mockNotice).not.toHaveBeenCalled();
    });

    it("warns with the failure code when the host rejects a command for another reason", async () => {
      const fixture = createFixtureClient({
        sessionId: SESSION_ID,
        onCommand: () => ({ ok: false, code: "invalid", message: "Unknown option nope" }),
      });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await result.current.resolvePermission("call-1", "nope");

      expect(logWarn).toHaveBeenCalledWith(
        "[AgentMode] resolvePermission command failed (invalid): Unknown option nope"
      );
    });

    it("tells the user their action did not go through when the host rejects a command", async () => {
      const fixture = createFixtureClient({
        sessionId: SESSION_ID,
        onCommand: () => ({ ok: false, code: "failed", message: "disconnected" }),
      });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await result.current.resolvePlan("plan-1", "approve");

      expect(mockNotice).toHaveBeenCalledWith(
        "Could not send your answer to the agent (disconnected). Try again."
      );
    });
  });
});
