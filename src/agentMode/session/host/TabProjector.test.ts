import { applyHostOp } from "@/agentMode/protocol/apply";
import type { HostOp } from "@/agentMode/protocol/ops";
import { INITIAL_HOST_STATE, type HostState } from "@/agentMode/protocol/state";
import { makeTestSession } from "@/agentMode/session/host/hostTestHarness";
import { summarizeTab, TabProjector } from "@/agentMode/session/host/TabProjector";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

function build() {
  const ops: HostOp[] = [];
  let state: HostState = INITIAL_HOST_STATE;
  const projector = new TabProjector(
    () => state,
    (op) => {
      state = applyHostOp(state, op);
      ops.push(op);
    }
  );
  const sessions = ["a", "b", "c"].map((id) => makeTestSession(id).session);
  return { ops, projector, sessions, getState: () => state };
}

describe("TabProjector", () => {
  describe("summarizeTab()", () => {
    it("copies identity and live status fields from the session", () => {
      const { session } = makeTestSession("s1", "codex", "project-1");
      session.setLabel("Notes");
      expect(summarizeTab(session)).toMatchObject({
        id: "s1",
        backendId: "codex",
        projectId: "project-1",
        status: "idle",
        label: "Notes",
        labelSource: "user",
        needsAttention: false,
      });
    });
  });

  describe("reconcile()", () => {
    it("adds tabs in order and emits nothing when the set is unchanged", () => {
      const { ops, projector, sessions, getState } = build();
      projector.reconcile(sessions);
      expect(ops.map((op) => op.t)).toEqual(["tab.add", "tab.add", "tab.add"]);
      expect(getState().tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
      ops.length = 0;
      projector.reconcile(sessions);
      expect(ops).toEqual([]);
    });

    it("removes tabs that left the set", () => {
      const { ops, projector, sessions } = build();
      projector.reconcile(sessions);
      ops.length = 0;
      projector.reconcile([sessions[0], sessions[2]]);
      expect(ops).toEqual([{ t: "tab.remove", id: "b" }]);
    });

    it("moves a tab by re-adding it at its new index", () => {
      const { ops, projector, sessions, getState } = build();
      projector.reconcile(sessions);
      ops.length = 0;
      projector.reconcile([sessions[2], sessions[0], sessions[1]]);
      expect(getState().tabs.map((t) => t.id)).toEqual(["c", "a", "b"]);
      expect(ops.every((op) => op.t === "tab.add")).toBe(true);
    });

    it("patches fields that changed on tabs that stayed", () => {
      const { ops, projector, sessions } = build();
      projector.reconcile(sessions);
      ops.length = 0;
      sessions[1].setLabel("Renamed");
      projector.reconcile(sessions);
      expect(ops).toEqual([
        { t: "tab.patch", id: "b", patch: { label: "Renamed", labelSource: "user" } },
      ]);
    });
  });

  describe("refresh()", () => {
    it("emits only the changed fields and ignores a session without a tab", () => {
      const { ops, projector, sessions } = build();
      projector.reconcile([sessions[0]]);
      ops.length = 0;
      sessions[0].markNeedsAttention();
      projector.refresh(sessions[0]);
      projector.refresh(sessions[0]);
      projector.refresh(sessions[1]);
      expect(ops).toEqual([{ t: "tab.patch", id: "a", patch: { needsAttention: true } }]);
    });
  });
});
