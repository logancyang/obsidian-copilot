import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import { useSessionCommands } from "@/agentMode/ui/hooks/useSessionCommands";
import { logWarn } from "@/logger";
import type { Command } from "@/agentMode/protocol/commands";
import { act, renderHook } from "@testing-library/react";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const mockNotice = jest.fn();
jest.mock("obsidian", () => ({
  Notice: function Notice(message: string) {
    mockNotice(message);
  },
}));

const SESSION_ID = "s1";

function runOnSend(status: "running" | "idle") {
  return (command: Command, fixture: ReturnType<typeof createFixtureClient>) => {
    if (command.name === "send") {
      fixture.emitHost({ t: "tab.patch", id: SESSION_ID, patch: { status } });
      return { ok: true as const, value: { userMessageId: "m1", droppedNotePaths: [] } };
    }
    return { ok: true as const, value: undefined };
  };
}

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

    it("sends the composed message as a send command with note paths and image blocks", async () => {
      const fixture = createFixtureClient({ sessionId: SESSION_ID, onCommand: runOnSend("idle") });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await result.current.send(
        "Summarize",
        {
          notes: [{ path: "Projects/Plan.md", basename: "Plan" } as never],
          urls: ["https://example.com"],
        },
        [
          { type: "image", mimeType: "image/png", data: "AQID" },
          { type: "resource_link", uri: "file:///skipped" },
        ],
        ["codex"]
      );

      expect(fixture.commands).toEqual([
        {
          name: "send",
          sessionId: SESSION_ID,
          text: "Summarize",
          context: { notePaths: ["Projects/Plan.md"], urls: ["https://example.com"] },
          images: [{ mimeType: "image/png", data: "AQID" }],
          mentionedAgents: ["codex"],
        },
      ]);
    });

    it("omits context, images and mentioned agents the message does not have", async () => {
      const fixture = createFixtureClient({ sessionId: SESSION_ID, onCommand: runOnSend("idle") });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await result.current.send("Hi", undefined, [], []);

      expect(fixture.commands).toEqual([
        {
          name: "send",
          sessionId: SESSION_ID,
          text: "Hi",
          context: undefined,
          images: undefined,
          mentionedAgents: undefined,
        },
      ]);
    });

    it("resolves the turn once the session's tab leaves the running states", async () => {
      const fixture = createFixtureClient({
        sessionId: SESSION_ID,
        onCommand: runOnSend("running"),
      });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));
      const { turn } = await result.current.send("Hi");
      let ended = false;
      void turn.then(() => {
        ended = true;
      });

      await act(async () => undefined);
      expect(ended).toBe(false);

      await act(async () => {
        fixture.emitHost({
          t: "tab.patch",
          id: SESSION_ID,
          patch: { status: "awaiting_permission" },
        });
      });
      expect(ended).toBe(false);

      await act(async () => {
        fixture.emitHost({ t: "tab.patch", id: SESSION_ID, patch: { status: "idle" } });
      });
      expect(ended).toBe(true);
    });

    it("resolves the turn at once when the turn already ended before the command returned", async () => {
      const fixture = createFixtureClient({ sessionId: SESSION_ID, onCommand: runOnSend("idle") });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      const { turn } = await result.current.send("Hi");

      await expect(turn).resolves.toBeUndefined();
    });

    it("rejects with the host's message when the host refuses the send", async () => {
      const fixture = createFixtureClient({
        sessionId: SESSION_ID,
        onCommand: () => ({
          ok: false,
          code: "session_busy",
          message: "Session already has a turn in flight",
        }),
      });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await expect(result.current.send("Hi")).rejects.toThrow(
        "Session already has a turn in flight"
      );
    });

    it("sends a cancel command for the session and rejects when the host refuses it", async () => {
      const fixture = createFixtureClient({ sessionId: SESSION_ID });
      const { result } = renderHook(() => useSessionCommands(fixture.client, SESSION_ID));

      await result.current.cancel();
      expect(fixture.commands).toEqual([{ name: "cancel", sessionId: SESSION_ID }]);

      const refusing = createFixtureClient({
        sessionId: SESSION_ID,
        onCommand: () => ({ ok: false, code: "unknown_session", message: "No session s1" }),
      });
      const refused = renderHook(() => useSessionCommands(refusing.client, SESSION_ID));
      await expect(refused.result.current.cancel()).rejects.toThrow("No session s1");
    });
  });
});
