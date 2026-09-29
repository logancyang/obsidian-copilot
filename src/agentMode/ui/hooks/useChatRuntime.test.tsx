import { PROTOCOL_VERSION } from "@/agentMode/protocol/frames";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import { INITIAL_SESSION_STATE, type SessionState } from "@/agentMode/protocol/state";
import {
  buildHostState,
  buildMessage,
  buildTab,
  FakeTransport,
} from "@/agentMode/protocol/testBuilders";
import { useChatRuntime } from "@/agentMode/ui/hooks/useChatRuntime";
import { act, renderHook } from "@testing-library/react";

function liveClient() {
  const transport = new FakeTransport();
  const client = new SessionClient(transport, { app: "1.0.0" });
  transport.setOpen(true);
  transport.deliver({ type: "hello", v: PROTOCOL_VERSION, app: "h", hostId: "h1", ok: true });
  transport.deliver({
    type: "snapshot",
    scope: "host",
    seq: 0,
    state: buildHostState({ tabs: [buildTab({ id: "s1", status: "running" })] }),
  });
  return { transport, client };
}

const SESSION: SessionState = {
  ...INITIAL_SESSION_STATE,
  transcript: [
    buildMessage({ id: "shown", isVisible: true }),
    buildMessage({ id: "hidden", isVisible: false }),
  ],
};

describe("useChatRuntime", () => {
  describe("useChatRuntime()", () => {
    it("subscribes to the session while mounted and unsubscribes on unmount", () => {
      const { transport, client } = liveClient();
      const { unmount } = renderHook(() => useChatRuntime(client, "s1"));

      expect(transport.sentOfType("subscribe").map((frame) => frame.scope)).toContain("session:s1");
      unmount();
      expect(transport.sentOfType("unsubscribe").map((frame) => frame.scope)).toEqual([
        "session:s1",
      ]);
    });

    it("returns null until the session snapshot arrives", () => {
      const { client } = liveClient();
      const { result } = renderHook(() => useChatRuntime(client, "s1"));
      expect(result.current).toBeNull();
    });

    it("returns the visible transcript and the turn state of the session's tab once the snapshot arrives", () => {
      const { transport, client } = liveClient();
      const { result } = renderHook(() => useChatRuntime(client, "s1"));

      act(() =>
        transport.deliver({ type: "snapshot", scope: "session:s1", seq: 0, state: SESSION })
      );

      expect(result.current?.messages.map((message) => message.id)).toEqual(["shown"]);
      expect(result.current?.isTurnInFlight).toBe(true);
      expect(result.current?.isStarting).toBe(false);
    });

    it("returns the same runtime object when an op leaves the session's chat state unchanged", () => {
      const { transport, client } = liveClient();
      const { result } = renderHook(() => useChatRuntime(client, "s1"));
      act(() =>
        transport.deliver({ type: "snapshot", scope: "session:s1", seq: 0, state: SESSION })
      );
      const before = result.current;

      act(() =>
        transport.deliver({
          type: "ops",
          scope: "session:s1",
          from: 1,
          ops: [{ t: "slice", key: "usage", value: { usedTokens: 5, updatedAt: 1 } }],
        })
      );

      expect(result.current).not.toBeNull();
      expect(result.current?.messages).toBe(before?.messages);
    });
  });
});
