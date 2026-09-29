import { ClientView } from "@/agentMode/protocol/ClientView";
import { PROTOCOL_VERSION } from "@/agentMode/protocol/frames";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { HostState } from "@/agentMode/protocol/state";
import { buildHostState, buildTab, FakeTransport } from "@/agentMode/protocol/testBuilders";

const GLOBAL = "__global__";

const hostOf = (...tabs: Array<[string, string?]>): HostState =>
  buildHostState({
    tabs: tabs.map(([id, projectId]) =>
      buildTab({ id, chatInputId: `input-${id}`, projectId: projectId ?? GLOBAL })
    ),
  });

describe("ClientView", () => {
  describe("activate()", () => {
    it("shows the tab, switches to its project scope and records it as the scope's latest", () => {
      const view = new ClientView(GLOBAL);
      view.activate({ id: "p1", projectId: "proj" });
      expect(view.getState()).toEqual({ activeTabId: "p1", projectScope: "proj" });
      expect(view.getLastActive("proj")).toBe("p1");
      expect(view.getLastActive(GLOBAL)).toBeNull();
    });

    it("notifies subscribers once per change and not for the tab already shown", () => {
      const view = new ClientView(GLOBAL);
      const listener = jest.fn();
      view.subscribe(listener);
      view.activate({ id: "a", projectId: GLOBAL });
      view.activate({ id: "a", projectId: GLOBAL });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("keeps the state object stable when nothing changed so selectors can skip work", () => {
      const view = new ClientView(GLOBAL);
      view.activate({ id: "a", projectId: GLOBAL });
      const before = view.getState();
      view.activate({ id: "a", projectId: GLOBAL });
      expect(view.getState()).toBe(before);
    });
  });

  describe("clearActive()", () => {
    it("shows no tab and keeps the project scope", () => {
      const view = new ClientView("proj");
      view.activate({ id: "a", projectId: "proj" });
      view.clearActive();
      expect(view.getState()).toEqual({ activeTabId: null, projectScope: "proj" });
    });
  });

  describe("setProjectScope()", () => {
    it("changes the scope without touching the shown tab", () => {
      const view = new ClientView(GLOBAL);
      view.activate({ id: "a", projectId: GLOBAL });
      view.setProjectScope("proj");
      expect(view.getState()).toEqual({ activeTabId: "a", projectScope: "proj" });
    });
  });

  describe("subscribe()", () => {
    it("stops notifying after unsubscribe", () => {
      const view = new ClientView(GLOBAL);
      const listener = jest.fn();
      const stop = view.subscribe(listener);
      stop();
      view.activate({ id: "a", projectId: GLOBAL });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("reconcile()", () => {
    it("adopts the last tab of the current scope from the first tab set", () => {
      const view = new ClientView(GLOBAL);
      view.reconcile(hostOf(["a"], ["b"], ["p", "proj"]));
      expect(view.getActiveTabId()).toBe("b");
    });

    it("keeps a tab the client already chose when the first tab set arrives", () => {
      const view = new ClientView(GLOBAL);
      view.activate({ id: "a", projectId: GLOBAL });
      view.reconcile(hostOf(["a"], ["b"]));
      expect(view.getActiveTabId()).toBe("a");
    });

    it("leaves a null selection alone after the first tab set, so a flow that is creating a tab is not overridden", () => {
      const view = new ClientView(GLOBAL);
      view.reconcile(hostOf());
      view.reconcile(hostOf(["a"]));
      expect(view.getActiveTabId()).toBeNull();
    });

    it("keeps a tab that has been chosen but has not reached the replica yet", () => {
      const view = new ClientView(GLOBAL);
      view.reconcile(hostOf(["a"]));
      view.activate({ id: "new", projectId: GLOBAL });
      view.reconcile(hostOf(["a"], ["x"]));
      expect(view.getActiveTabId()).toBe("new");
      expect(view.getLastActive(GLOBAL)).toBe("new");
    });

    it("moves to the tab that took the closed tab's place in the same scope", () => {
      const view = new ClientView(GLOBAL);
      view.reconcile(hostOf(["a"], ["b"], ["c"]));
      view.activate({ id: "b", projectId: GLOBAL });
      view.reconcile(hostOf(["a"], ["c"]));
      expect(view.getActiveTabId()).toBe("c");
    });

    it("follows a replacement that keeps the closed tab's composer identity, wherever it sits https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
      const view = new ClientView(GLOBAL);
      const before = buildHostState({
        tabs: [
          buildTab({ id: "a", chatInputId: "in-a" }),
          buildTab({ id: "b", chatInputId: "in-b" }),
        ],
      });
      view.reconcile(before);
      view.activate({ id: "a", projectId: GLOBAL });
      view.reconcile(
        buildHostState({
          tabs: [
            buildTab({ id: "b", chatInputId: "in-b" }),
            buildTab({ id: "a2", chatInputId: "in-a" }),
          ],
        })
      );
      expect(view.getActiveTabId()).toBe("a2");
    });

    it("moves to the previous tab when the last tab of the scope closes", () => {
      const view = new ClientView(GLOBAL);
      view.reconcile(hostOf(["a"], ["b"]));
      view.activate({ id: "b", projectId: GLOBAL });
      view.reconcile(hostOf(["a"]));
      expect(view.getActiveTabId()).toBe("a");
    });

    it("shows no tab when the scope's last tab closes and keeps the scope", () => {
      const view = new ClientView("proj");
      view.reconcile(hostOf(["p", "proj"], ["g"]));
      view.activate({ id: "p", projectId: "proj" });
      view.reconcile(hostOf(["g"]));
      expect(view.getState()).toEqual({ activeTabId: null, projectScope: "proj" });
    });

    it("does not move the shown tab when another client's tab is created, closed or reordered", () => {
      const view = new ClientView(GLOBAL);
      view.reconcile(hostOf(["a"], ["b"]));
      view.activate({ id: "a", projectId: GLOBAL });
      view.reconcile(hostOf(["a"], ["b"], ["phone-made"]));
      view.reconcile(hostOf(["a"], ["phone-made"]));
      view.reconcile(hostOf(["phone-made"], ["a"]));
      expect(view.getActiveTabId()).toBe("a");
    });

    it("ignores a missing host state such as a disconnected client", () => {
      const view = new ClientView(GLOBAL);
      view.activate({ id: "a", projectId: GLOBAL });
      view.reconcile(null);
      expect(view.getActiveTabId()).toBe("a");
    });

    it("forgets a scope's latest tab once that tab leaves the set", () => {
      const view = new ClientView(GLOBAL);
      view.reconcile(hostOf(["a"], ["b"]));
      view.activate({ id: "a", projectId: GLOBAL });
      view.reconcile(hostOf(["b"]));
      expect(view.getLastActive(GLOBAL)).toBe("b");
    });
  });

  describe("attach()", () => {
    function liveClient(host: HostState) {
      const transport = new FakeTransport();
      const client = new SessionClient(transport, { app: "1.0.0" });
      transport.setOpen(true);
      transport.deliver({ type: "hello", v: PROTOCOL_VERSION, app: "h", hostId: "h1", ok: true });
      transport.deliver({ type: "snapshot", scope: "host", seq: 0, state: host });
      return { transport, client };
    }

    it("adopts a tab from the replica and reports it to the host as this client's focus", () => {
      const { transport, client } = liveClient(hostOf(["a"], ["b"]));
      const view = new ClientView(GLOBAL);
      view.attach(client);
      expect(view.getActiveTabId()).toBe("b");
      expect(transport.sentOfType("focus")).toEqual([{ type: "focus", sessionId: "b" }]);
    });

    it("follows the shared tab set as the host changes it and reports each new focus", () => {
      const { transport, client } = liveClient(hostOf(["a"], ["b"]));
      const view = new ClientView(GLOBAL);
      view.attach(client);
      transport.deliver({
        type: "ops",
        scope: "host",
        from: 1,
        ops: [{ t: "tab.remove", id: "b" }],
      });
      expect(view.getActiveTabId()).toBe("a");
      expect(transport.sentOfType("focus").map((f) => f.sessionId)).toEqual(["b", "a"]);
    });

    it("clears the reported focus and stops following when detached", () => {
      const { transport, client } = liveClient(hostOf(["a"]));
      const view = new ClientView(GLOBAL);
      const detach = view.attach(client);
      detach();
      view.activate({ id: "z", projectId: GLOBAL });
      expect(transport.sentOfType("focus").map((f) => f.sessionId)).toEqual(["a", null]);
    });
  });
});
