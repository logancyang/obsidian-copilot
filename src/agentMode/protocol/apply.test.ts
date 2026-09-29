import { applyHostOp, applySessionOp } from "@/agentMode/protocol/apply";
import { INITIAL_SESSION_STATE, type HostState } from "@/agentMode/protocol/state";
import {
  buildBackendSummary,
  buildHostState,
  buildMessage,
  buildTab,
  deepFreeze,
} from "@/agentMode/protocol/testBuilders";

describe("apply", () => {
  describe("applyHostOp()", () => {
    const host = (...ids: string[]): HostState =>
      deepFreeze(buildHostState({ tabs: ids.map((id) => buildTab({ id })) }));

    it("tab.add inserts the tab at the requested index", () => {
      const next = applyHostOp(host("a", "c"), {
        t: "tab.add",
        index: 1,
        tab: buildTab({ id: "b" }),
      });
      expect(next.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
    });

    it("tab.add clamps an out-of-range index to the ends", () => {
      const state = host("a");
      expect(
        applyHostOp(state, { t: "tab.add", index: 99, tab: buildTab({ id: "z" }) }).tabs.map(
          (t) => t.id
        )
      ).toEqual(["a", "z"]);
      expect(
        applyHostOp(state, { t: "tab.add", index: -4, tab: buildTab({ id: "y" }) }).tabs.map(
          (t) => t.id
        )
      ).toEqual(["y", "a"]);
    });

    it("tab.add for an id already present moves it instead of duplicating it", () => {
      const next = applyHostOp(host("a", "b"), {
        t: "tab.add",
        index: 0,
        tab: buildTab({ id: "b" }),
      });
      expect(next.tabs.map((t) => t.id)).toEqual(["b", "a"]);
    });

    it("tab.remove drops the tab and ignores an unknown id", () => {
      const state = host("a", "b");
      expect(applyHostOp(state, { t: "tab.remove", id: "a" }).tabs.map((t) => t.id)).toEqual(["b"]);
      expect(applyHostOp(state, { t: "tab.remove", id: "nope" })).toBe(state);
    });

    it("tab.patch merges changed fields and keeps other tabs referentially stable", () => {
      const state = host("a", "b");
      const next = applyHostOp(state, {
        t: "tab.patch",
        id: "b",
        patch: { status: "running", needsAttention: true },
      });
      expect(next.tabs[1]).toMatchObject({ status: "running", needsAttention: true });
      expect(next.tabs[0]).toBe(state.tabs[0]);
    });

    it("tab.patch that changes nothing, or targets an unknown id, returns the same state", () => {
      const state = host("a");
      expect(applyHostOp(state, { t: "tab.patch", id: "a", patch: { status: "idle" } })).toBe(
        state
      );
      expect(applyHostOp(state, { t: "tab.patch", id: "nope", patch: { status: "running" } })).toBe(
        state
      );
    });

    it("backend.set inserts a backend at the index and replaces one with the same id in place", () => {
      const claude = buildBackendSummary({ id: "claude" });
      const codex = buildBackendSummary({ id: "codex" });
      const state = deepFreeze(buildHostState({ backends: [claude] }));
      const inserted = applyHostOp(state, { t: "backend.set", index: 1, backend: codex });
      expect(inserted.backends.map((b) => b.id)).toEqual(["claude", "codex"]);
      const renamed = buildBackendSummary({ id: "claude", displayName: "Claude" });
      const replaced = applyHostOp(inserted, { t: "backend.set", index: 0, backend: renamed });
      expect(replaced.backends).toEqual([renamed, codex]);
      expect(replaced.backends[1]).toBe(codex);
    });

    it("backend.set carrying the backend already at that index returns the same state", () => {
      const claude = buildBackendSummary({ id: "claude" });
      const state = deepFreeze(buildHostState({ backends: [claude] }));
      expect(applyHostOp(state, { t: "backend.set", index: 0, backend: claude })).toBe(state);
    });

    it("host.patch merges the changed flags and leaves tabs and backends alone", () => {
      const state = deepFreeze(buildHostState({ tabs: [buildTab({ id: "a" })] }));
      const next = applyHostOp(state, {
        t: "host.patch",
        patch: { startingBackendId: "codex", startFailed: true },
      });
      expect(next.host).toEqual({
        defaultBackendId: null,
        startingBackendId: "codex",
        startFailed: true,
      });
      expect(next.tabs).toBe(state.tabs);
    });

    it("host.patch that changes nothing returns the same state", () => {
      const state = deepFreeze(buildHostState());
      expect(applyHostOp(state, { t: "host.patch", patch: { startFailed: false } })).toBe(state);
    });
  });

  describe("applySessionOp()", () => {
    it("slice replaces one slice and leaves the transcript reference alone", () => {
      const next = applySessionOp(INITIAL_SESSION_STATE, {
        t: "slice",
        key: "plan",
        value: {
          id: "p",
          revision: 1,
          body: "b",
          title: "t",
          permissionGated: false,
          decision: "pending",
        },
      });
      expect(next.plan?.id).toBe("p");
      expect(next.transcript).toBe(INITIAL_SESSION_STATE.transcript);
    });

    it("slice carrying the current reference returns the same state", () => {
      expect(applySessionOp(INITIAL_SESSION_STATE, { t: "slice", key: "usage", value: null })).toBe(
        INITIAL_SESSION_STATE
      );
    });

    it("transcript ops update only the transcript", () => {
      const next = applySessionOp(INITIAL_SESSION_STATE, { t: "msg.add", message: buildMessage() });
      expect(next.transcript).toHaveLength(1);
      expect(next.pending).toBe(INITIAL_SESSION_STATE.pending);
    });

    it("a transcript op that changes nothing returns the same state", () => {
      expect(
        applySessionOp(INITIAL_SESSION_STATE, {
          t: "msg.appendText",
          id: "nope",
          text: "x",
          atMs: 1,
        })
      ).toBe(INITIAL_SESSION_STATE);
    });
  });
});
