import {
  EMPTY_CHAT_RUNTIME,
  selectChatRuntime,
  selectTab,
  selectVisibleMessages,
} from "@/agentMode/protocol/selectors";
import {
  INITIAL_SESSION_STATE,
  type HostState,
  type SessionState,
} from "@/agentMode/protocol/state";
import { buildHostState, buildMessage, buildTab } from "@/agentMode/protocol/testBuilders";

const host = (status: "idle" | "running" | "starting" | "awaiting_permission"): HostState =>
  buildHostState({ tabs: [buildTab({ id: "s1", status })] });

describe("selectors", () => {
  describe("selectTab()", () => {
    it("finds the tab by session id and returns null for an unknown id", () => {
      const state = host("idle");
      expect(selectTab(state, "s1")).toBe(state.tabs[0]);
      expect(selectTab(state, "nope")).toBeNull();
    });
  });

  describe("selectVisibleMessages()", () => {
    it("excludes hidden messages", () => {
      const session: SessionState = {
        ...INITIAL_SESSION_STATE,
        transcript: [buildMessage({ id: "a" }), buildMessage({ id: "b", isVisible: false })],
      };
      expect(selectVisibleMessages(session).map((m) => m.id)).toEqual(["a"]);
    });

    it("returns one shared empty array while every message is hidden, whatever the transcript reference", () => {
      const first: SessionState = {
        ...INITIAL_SESSION_STATE,
        transcript: [buildMessage({ id: "a", isVisible: false })],
      };
      const second: SessionState = {
        ...INITIAL_SESSION_STATE,
        transcript: [buildMessage({ id: "a", isVisible: false, message: "streamed" })],
      };
      expect(selectVisibleMessages(first)).toHaveLength(0);
      expect(selectVisibleMessages(first)).toBe(selectVisibleMessages(second));
    });

    it("returns the same array for the same transcript reference", () => {
      const session: SessionState = { ...INITIAL_SESSION_STATE, transcript: [buildMessage()] };
      expect(selectVisibleMessages(session)).toBe(selectVisibleMessages({ ...session }));
    });
  });

  describe("EMPTY_CHAT_RUNTIME", () => {
    it("equals the runtime of a session that has no messages, no prompts and no tab", () => {
      expect(selectChatRuntime(buildHostState(), INITIAL_SESSION_STATE, "s1")).toEqual(
        EMPTY_CHAT_RUNTIME
      );
    });
  });

  describe("selectChatRuntime()", () => {
    it("derives in-flight flags from the tab status", () => {
      const session = { ...INITIAL_SESSION_STATE };
      expect(selectChatRuntime(host("starting"), session, "s1")).toMatchObject({
        isStarting: true,
        isTurnInFlight: false,
      });
      expect(selectChatRuntime(host("running"), { ...INITIAL_SESSION_STATE }, "s1")).toMatchObject({
        isStarting: false,
        isTurnInFlight: true,
      });
      expect(
        selectChatRuntime(host("awaiting_permission"), { ...INITIAL_SESSION_STATE }, "s1")
          .isTurnInFlight
      ).toBe(true);
    });

    it("surfaces pending prompts, plan and todos from the session state", () => {
      const session: SessionState = {
        ...INITIAL_SESSION_STATE,
        todos: [{ content: "x", status: "pending" }],
        pending: { permissions: [], questions: [], planPermission: true },
      };
      const runtime = selectChatRuntime(host("idle"), session, "s1");
      expect(runtime.hasPendingPlanPermission).toBe(true);
      expect(runtime.currentTodoList).toEqual([{ content: "x", status: "pending" }]);
      expect(runtime.pendingToolPermissions).toBe(session.pending.permissions);
    });

    it("returns the same runtime object while session and tab references are unchanged", () => {
      const session = { ...INITIAL_SESSION_STATE };
      const state = host("idle");
      expect(selectChatRuntime(state, session, "s1")).toBe(
        selectChatRuntime({ ...state }, session, "s1")
      );
    });

    it("builds a new runtime when the tab changes but keeps the message list reference", () => {
      const session = { ...INITIAL_SESSION_STATE, transcript: [buildMessage()] };
      const before = selectChatRuntime(host("idle"), session, "s1");
      const after = selectChatRuntime(host("running"), session, "s1");
      expect(after).not.toBe(before);
      expect(after.messages).toBe(before.messages);
    });

    it("reports a session without a tab as neither starting nor in flight", () => {
      expect(selectChatRuntime(buildHostState(), { ...INITIAL_SESSION_STATE }, "s1")).toMatchObject(
        {
          isStarting: false,
          isTurnInFlight: false,
        }
      );
    });
  });
});
