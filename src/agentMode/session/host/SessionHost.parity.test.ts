import fs from "fs";
import path from "path";
import { selectChatRuntime } from "@/agentMode/protocol/selectors";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import {
  buildHost,
  FakeManager,
  makeTestSession,
  settle,
} from "@/agentMode/session/host/hostTestHarness";
import { playScript } from "@/agentMode/session/host/scriptRunner";
import type { SessionScript } from "@/agentMode/session/host/sessionScript";
import type { SessionHost } from "@/agentMode/session/host/SessionHost";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const SCRIPTS = fs
  .readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".script.json"))
  .sort()
  .map((name) => ({
    name,
    script: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as SessionScript,
  }));

function expectSameSession(client: SessionClient, host: SessionHost, id: string): void {
  expect(client.getSession(id)).toEqual(host.getSessionState(id));
  expect(client.getHost()).toEqual(host.getHostState());
}

function expectRuntimeMatchesUiState(client: SessionClient, ui: AgentChatUIState, id: string) {
  const runtime = selectChatRuntime(client.getHost()!, client.getSession(id)!, id);
  expect(runtime.messages).toEqual(ui.getMessages());
  expect(runtime.isStarting).toBe(ui.isStarting());
  expect(runtime.isTurnInFlight).toBe(ui.isTurnInFlight());
  expect(runtime.hasPendingPlanPermission).toBe(ui.hasPendingPlanPermission());
  expect(runtime.currentPlan).toEqual(ui.getCurrentPlan());
  expect(runtime.currentTodoList).toEqual(ui.getCurrentTodoList());
  expect(runtime.pendingToolPermissions).toEqual(ui.getPendingToolPermissions());
  expect(runtime.pendingAskUserQuestions.map((q) => q.requestId)).toEqual(
    ui.getPendingAskUserQuestions().map((q) => q.requestId)
  );
}

describe("SessionHost parity", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("has recorded scripts for Claude, Codex and opencode", () => {
    const backends = new Set(SCRIPTS.map(({ script }) => script.backendId));
    expect([...backends].sort()).toEqual(["claude", "codex", "opencode"]);
  });

  describe.each(SCRIPTS)("$name", ({ script }) => {
    async function play(withMidStreamSnapshot: boolean) {
      const seen = { permission: false, question: false, plan: false, cancelled: false };
      const manager = new FakeManager();
      const { session, backend } = makeTestSession("s1", script.backendId);
      manager.add(session);
      const host = buildHost(manager);
      const { client } = host.createClient({ serialize: true });
      client.watchSession("s1");
      await settle();
      const ui = new AgentChatUIState(session);
      const snapshots: { late: SessionClient | null } = { late: null };
      const midpoint = Math.floor(script.steps.length / 2);

      const observe = () => {
        expectSameSession(client, host, "s1");
        expectRuntimeMatchesUiState(client, ui, "s1");
        const state = client.getSession("s1")!;
        seen.permission ||= state.pending.permissions.length > 0;
        seen.question ||= state.pending.questions.length > 0;
        seen.plan ||= state.plan !== null;
        seen.cancelled ||= state.transcript.some((m) => m.turnStopReason === "cancelled");
      };

      await playScript(script, {
        session,
        backend,
        client,
        sessionId: "s1",
        backendSessionId: "acp-s1",
        settle: async () => {
          jest.advanceTimersByTime(20);
          await settle();
        },
        beforeAnswer: observe,
        afterStep: async (_step, index) => {
          observe();
          if (withMidStreamSnapshot && index === midpoint) {
            snapshots.late = host.createClient({ serialize: true }).client;
            snapshots.late.watchSession("s1");
            await settle();
            expectSameSession(snapshots.late, host, "s1");
          }
        },
      });
      return { client, host, late: snapshots.late, session, seen };
    }

    it("keeps the replica equal to the host projection and to today's UI-state getters after every step", async () => {
      const { client, host, session } = await play(false);
      expectSameSession(client, host, "s1");
      expect(["idle", "error"]).toContain(session.getStatus());
    });

    it("exercises every kind of prompt and stop the recorded session contains", async () => {
      const { seen } = await play(false);
      const kinds = script.steps.map((step) => step.step);
      const planned = script.steps.some(
        (step) => step.step === "permission" && step.request.toolCall.kind === "switch_mode"
      );
      expect(seen.question).toBe(kinds.includes("question"));
      expect(seen.plan).toBe(planned);
      expect(seen.permission || seen.plan).toBe(kinds.includes("permission"));
      expect(seen.cancelled).toBe(kinds.includes("cancel"));
    });

    it("lets a client that subscribes mid-stream finish equal to the one that saw every op", async () => {
      const { client, host, late } = await play(true);
      expectSameSession(late!, host, "s1");
      expect(late!.getSession("s1")).toEqual(client.getSession("s1"));
    });
  });
});
