import type { Command } from "@/agentMode/protocol/commands";
import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import { useComposerCommands } from "@/agentMode/ui/hooks/useComposerCommands";
import { act, renderHook } from "@testing-library/react";

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

describe("useComposerCommands", () => {
  describe("useComposerCommands()", () => {
    it("sends the composed message as a send command with note paths and image blocks", async () => {
      const fixture = createFixtureClient({ sessionId: SESSION_ID, onCommand: runOnSend("idle") });
      const { result } = renderHook(() => useComposerCommands(fixture.client, SESSION_ID));

      await result.current.sendMessage(
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
      const { result } = renderHook(() => useComposerCommands(fixture.client, SESSION_ID));

      await result.current.sendMessage("Hi", undefined, [], []);

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
      const { result } = renderHook(() => useComposerCommands(fixture.client, SESSION_ID));
      const { turn } = await result.current.sendMessage("Hi");
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
      const { result } = renderHook(() => useComposerCommands(fixture.client, SESSION_ID));

      const { turn } = await result.current.sendMessage("Hi");

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
      const { result } = renderHook(() => useComposerCommands(fixture.client, SESSION_ID));

      await expect(result.current.sendMessage("Hi")).rejects.toThrow(
        "Session already has a turn in flight"
      );
    });

    it("sends a cancel command for the session and rejects when the host refuses it", async () => {
      const fixture = createFixtureClient({ sessionId: SESSION_ID });
      const { result } = renderHook(() => useComposerCommands(fixture.client, SESSION_ID));

      await result.current.cancel();
      expect(fixture.commands).toEqual([{ name: "cancel", sessionId: SESSION_ID }]);

      const refusing = createFixtureClient({
        sessionId: SESSION_ID,
        onCommand: () => ({ ok: false, code: "unknown_session", message: "No session s1" }),
      });
      const refused = renderHook(() => useComposerCommands(refusing.client, SESSION_ID));
      await expect(refused.result.current.cancel()).rejects.toThrow("No session s1");
    });
  });
});
