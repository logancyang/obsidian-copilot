import type { SliceOp } from "@/agentMode/protocol/ops";
import { EMPTY_PENDING } from "@/agentMode/protocol/state";
import { makeTestSession } from "@/agentMode/session/host/hostTestHarness";
import { SessionProjector } from "@/agentMode/session/host/SessionProjector";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

function build() {
  const { session, backend } = makeTestSession("s1");
  const ops: SliceOp[] = [];
  const projector = new SessionProjector(session, (op) => ops.push(op));
  return { session, backend, ops, projector };
}

describe("SessionProjector", () => {
  describe("getSlices()", () => {
    it("starts from the session's current values with the shared empty pending state", () => {
      const { projector } = build();
      expect(projector.getSlices()).toEqual({
        backendState: null,
        pending: EMPTY_PENDING,
        plan: null,
        todos: null,
        usage: null,
        planUsage: null,
      });
      expect(projector.getSlices().pending).toBe(EMPTY_PENDING);
    });

    it("includes prompts that were already pending when the projector attached", () => {
      const { session } = makeTestSession("s2");
      void session.handleToolPermission({
        sessionId: "acp-s2",
        toolCall: { toolCallId: "t", title: "Write", status: "pending" },
        options: [],
      });
      const projector = new SessionProjector(session, () => {});
      expect(projector.getSlices().pending.permissions).toHaveLength(1);
    });
  });

  describe("project()", () => {
    it("emits nothing when no slice changed", () => {
      const { projector, ops } = build();
      projector.project();
      projector.project();
      expect(ops).toEqual([]);
    });

    it("emits one slice op per changed slice, with the new value", () => {
      const { session, projector, ops } = build();
      session.seedSessionUsage({ usedTokens: 10, updatedAt: 1 });
      projector.project();
      expect(ops).toEqual([{ t: "slice", key: "usage", value: { usedTokens: 10, updatedAt: 1 } }]);
    });

    it("projects pending questions without their abort signal and reuses the wire object", () => {
      const { session, projector, ops } = build();
      void session.handleAskUserQuestion({
        sessionId: "acp-s1",
        requestId: "q1",
        questions: [{ question: "Which?", options: [] }],
        signal: new AbortController().signal,
      });
      projector.project();
      const pending = (ops[0] as Extract<SliceOp, { key: "pending" }>).value;
      expect(pending.questions[0]).not.toHaveProperty("signal");
      expect(JSON.parse(JSON.stringify(pending))).toEqual(pending);
      projector.project();
      expect(ops).toHaveLength(1);
    });

    it("returns to the shared empty pending state once everything is answered", () => {
      const { session, projector, ops } = build();
      void session.handleToolPermission({
        sessionId: "acp-s1",
        toolCall: { toolCallId: "t", title: "Write", status: "pending" },
        options: [{ optionId: "o", name: "Ok", kind: "allow_once" }],
      });
      projector.project();
      session.resolveToolPermission("t", "o");
      projector.project();
      expect((ops[1] as Extract<SliceOp, { key: "pending" }>).value).toBe(EMPTY_PENDING);
    });
  });
});
