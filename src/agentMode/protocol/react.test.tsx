import { act, renderHook } from "@testing-library/react";
import { PROTOCOL_VERSION } from "@/agentMode/protocol/frames";
import { useHostSelector, useSessionSelector } from "@/agentMode/protocol/react";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import { INITIAL_SESSION_STATE, type HostState } from "@/agentMode/protocol/state";
import { buildHostState, buildTab, FakeTransport } from "@/agentMode/protocol/testBuilders";

function liveClient() {
  const transport = new FakeTransport();
  const client = new SessionClient(transport, { app: "1.0.0" });
  transport.setOpen(true);
  transport.deliver({ type: "hello", v: PROTOCOL_VERSION, app: "h", hostId: "h1", ok: true });
  return { transport, client };
}

const HOST: HostState = buildHostState({
  tabs: [buildTab({ id: "s1" }), buildTab({ id: "s2" })],
});

describe("react", () => {
  describe("useHostSelector()", () => {
    it("returns null before the host snapshot and the selection after it", () => {
      const { transport, client } = liveClient();
      const { result } = renderHook(() => useHostSelector(client, (h) => h.tabs.length));
      expect(result.current).toBeNull();
      act(() => transport.deliver({ type: "snapshot", scope: "host", seq: 0, state: HOST }));
      expect(result.current).toBe(2);
    });

    it("does not re-render when an op leaves the selected value unchanged", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", scope: "host", seq: 0, state: HOST });
      let renders = 0;
      const select = (h: HostState) => h.tabs.length;
      renderHook(() => {
        renders += 1;
        return useHostSelector(client, select);
      });
      const before = renders;
      act(() =>
        transport.deliver({
          type: "ops",
          scope: "host",
          from: 1,
          ops: [{ t: "tab.patch", id: "s1", patch: { status: "running" } }],
        })
      );
      expect(renders).toBe(before);
    });

    it("keeps the previous value when a custom equality says the new selection is equivalent", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", scope: "host", seq: 0, state: HOST });
      const select = (h: HostState) => h.tabs.map((t) => t.id);
      const eq = (a: string[], b: string[]) => a.join() === b.join();
      const { result } = renderHook(() => useHostSelector(client, select, eq));
      const first = result.current;
      act(() =>
        transport.deliver({
          type: "ops",
          scope: "host",
          from: 1,
          ops: [{ t: "tab.patch", id: "s1", patch: { status: "running" } }],
        })
      );
      expect(result.current).toBe(first);
    });
  });

  describe("useSessionSelector()", () => {
    it("returns null until both scopes have snapshots, then selects across them", () => {
      const { transport, client } = liveClient();
      const select = (s: typeof INITIAL_SESSION_STATE, h: HostState) =>
        `${h.tabs[0].status}:${s.transcript.length}`;
      const { result } = renderHook(() => useSessionSelector(client, "s1", select));
      expect(result.current).toBeNull();
      act(() => {
        client.watchSession("s1");
        transport.deliver({ type: "snapshot", scope: "host", seq: 0, state: HOST });
        transport.deliver({
          type: "snapshot",
          scope: "session:s1",
          seq: 0,
          state: INITIAL_SESSION_STATE,
        });
      });
      expect(result.current).toBe("idle:0");
      act(() =>
        transport.deliver({
          type: "ops",
          scope: "host",
          from: 1,
          ops: [{ t: "tab.patch", id: "s1", patch: { status: "running" } }],
        })
      );
      expect(result.current).toBe("running:0");
    });
  });
});
