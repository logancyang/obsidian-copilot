import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import type { AgentSession } from "@/agentMode/session/AgentSession";

function makeChat() {
  const store = new AgentMessageStore();
  const session = {
    store,
    subscribe: jest.fn(),
    tasks: { subscribe: jest.fn() },
  } as unknown as AgentSession;
  return { store, chat: new AgentChatUIState(session) };
}
describe("AgentChatUIState", () => {
  describe("AgentChatUIState", () => {
    describe("getConversationRows()", () => {
      it("returns the store's stable public conversation projection", () => {
        const { store, chat } = makeChat();
        expect(chat.getConversationRows()).toBe(store.getConversationRows());
      });
    });
    describe("getTaskDetails()", () => {
      it("returns the task's backend answer from the existing store", () => {
        const { store, chat } = makeChat();
        const answerId = store.addMessage({
          sender: "ai",
          message: "Found three launch notes.",
          timestamp: null,
          isVisible: true,
          taskId: "task-1",
        });
        store.recordTask({
          taskId: "task-1",
          sourceMessageIds: [],
          delegationIds: [],
          state: "completed",
          presentation: "voice-card",
          assistantMessageId: answerId,
        });
        expect(chat.getTaskDetails("task-1")?.messages[0].message).toBe(
          "Found three launch notes."
        );
        expect(chat.getConversationRows()).toEqual([
          { kind: "task-card", task: store.getTask("task-1") },
        ]);
      });
      it("returns no detail body for an unknown task", () => {
        expect(makeChat().chat.getTaskDetails("missing")).toBeUndefined();
      });
    });
  });
});
