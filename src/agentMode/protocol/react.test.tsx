import { act, renderHook } from "@testing-library/react";
import { PROTOCOL_VERSION } from "@/agentMode/protocol/frames";
import { ClientView } from "@/agentMode/protocol/ClientView";
import { useClientView, useHostSelector, useSessionSelector } from "@/agentMode/protocol/react";
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
      act(() =>
        transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: HOST })
      );
      expect(result.current).toBe(2);
    });

    it("does not re-render when an op leaves the selected value unchanged", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: HOST });
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
          epoch: "e1",
          scope: "host",
          from: 1,
          ops: [{ t: "tab.patch", id: "s1", patch: { status: "running" } }],
        })
      );
      expect(renders).toBe(before);
    });

    it("keeps the previous value when a custom equality says the new selection is equivalent", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: HOST });
      const select = (h: HostState) => h.tabs.map((t) => t.id);
      const eq = (a: string[], b: string[]) => a.join() === b.join();
      const { result } = renderHook(() => useHostSelector(client, select, eq));
      const first = result.current;
      act(() =>
        transport.deliver({
          type: "ops",
          epoch: "e1",
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
        transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: HOST });
        transport.deliver({
          type: "snapshot",
          epoch: "e1",
          scope: "session:s1",
          seq: 0,
          state: INITIAL_SESSION_STATE,
        });
      });
      expect(result.current).toBe("idle:0");
      act(() =>
        transport.deliver({
          type: "ops",
          epoch: "e1",
          scope: "host",
          from: 1,
          ops: [{ t: "tab.patch", id: "s1", patch: { status: "running" } }],
        })
      );
      expect(result.current).toBe("running:0");
    });

    it("returns null while no session id is given", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: HOST });
      const { result } = renderHook(() => useSessionSelector(client, null, () => 1));
      expect(result.current).toBeNull();
    });
  });

  describe("useClientView()", () => {
    const scoped = buildHostState({
      tabs: [
        buildTab({ id: "g1" }),
        buildTab({ id: "g2" }),
        buildTab({ id: "p1", projectId: "proj" }),
      ],
    });

    it("selects the tabs in the view's scope and the tab the view shows", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: scoped });
      const view = new ClientView("__global__");
      view.activate({ id: "g2", projectId: "__global__" });
      const { result } = renderHook(() => useClientView(client, view));
      expect(result.current.scopeTabs.map((tab) => tab.id)).toEqual(["g1", "g2"]);
      expect(result.current.activeTab?.id).toBe("g2");
    });

    it("has no tabs and no active tab before the host snapshot", () => {
      const { client } = liveClient();
      const view = new ClientView("__global__");
      view.activate({ id: "g1", projectId: "__global__" });
      const { result } = renderHook(() => useClientView(client, view));
      expect(result.current.host).toBeNull();
      expect(result.current.scopeTabs).toEqual([]);
      expect(result.current.activeTab).toBeNull();
    });

    it("re-renders when the view moves to another tab or scope", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: scoped });
      const view = new ClientView("__global__");
      view.activate({ id: "g1", projectId: "__global__" });
      const { result } = renderHook(() => useClientView(client, view));
      act(() => view.activate({ id: "g2", projectId: "__global__" }));
      expect(result.current.activeTab?.id).toBe("g2");
      act(() => view.activate({ id: "p1", projectId: "proj" }));
      expect(result.current.scopeTabs.map((tab) => tab.id)).toEqual(["p1"]);
    });

    it("keeps the same scope tab list when a patch changes no tab in the scope", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: scoped });
      const view = new ClientView("__global__");
      view.activate({ id: "g1", projectId: "__global__" });
      const { result } = renderHook(() => useClientView(client, view));
      const before = result.current.scopeTabs;
      act(() =>
        transport.deliver({
          type: "ops",
          epoch: "e1",
          scope: "host",
          from: 1,
          ops: [{ t: "tab.patch", id: "p1", patch: { status: "running" } }],
        })
      );
      expect(result.current.scopeTabs).toBe(before);
    });

    it("re-renders when another client's tab arrives in the scope, without moving the shown tab https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
      const { transport, client } = liveClient();
      transport.deliver({ type: "snapshot", epoch: "e1", scope: "host", seq: 0, state: scoped });
      const view = new ClientView("__global__");
      view.attach(client);
      view.activate({ id: "g1", projectId: "__global__" });
      const { result } = renderHook(() => useClientView(client, view));
      act(() =>
        transport.deliver({
          type: "ops",
          epoch: "e1",
          scope: "host",
          from: 1,
          ops: [{ t: "tab.add", index: 0, tab: buildTab({ id: "phone" }) }],
        })
      );
      expect(result.current.scopeTabs.map((tab) => tab.id)).toEqual(["phone", "g1", "g2"]);
      expect(result.current.activeTab?.id).toBe("g1");
    });
  });
});
