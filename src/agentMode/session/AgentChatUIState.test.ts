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
    describe("registerVoiceSubmissionResolver()", () => {
      it("restores the remaining composer's attachments when the newer composer closes", async () => {
        const { chat } = makeChat();
        const earlier = jest.fn(async () => ({ context: { notes: [], urls: ["earlier"] } }));
        const newer = jest.fn(async () => ({ context: { notes: [], urls: ["newer"] } }));
        const releaseEarlier = chat.registerVoiceSubmissionResolver(earlier);
        const releaseNewer = chat.registerVoiceSubmissionResolver(newer);
        releaseNewer();
        await expect(chat.resolveVoiceSubmission("read attachment")).resolves.toEqual({
          context: { notes: [], urls: ["earlier"] },
        });
        expect(newer).not.toHaveBeenCalled();
        releaseEarlier();
        await expect(chat.resolveVoiceSubmission("read attachment")).rejects.toThrow("unavailable");
      });
      it("keeps the current composer's resolver when an older view releases its registration", async () => {
        const { chat } = makeChat();
        const old = jest.fn(async () => ({ context: { notes: [], urls: ["old"] } }));
        const current = jest.fn(async () => ({ context: { notes: [], urls: ["current"] } }));
        const releaseOld = chat.registerVoiceSubmissionResolver(old);
        const releaseCurrent = chat.registerVoiceSubmissionResolver(current);
        releaseOld();
        await expect(chat.resolveVoiceSubmission("read attachment")).resolves.toEqual({
          context: { notes: [], urls: ["current"] },
        });
        expect(current).toHaveBeenCalledWith("read attachment");
        expect(old).not.toHaveBeenCalled();
        releaseCurrent();
        await expect(chat.resolveVoiceSubmission("read attachment")).rejects.toThrow("unavailable");
      });
    });
    describe("resolveVoiceSubmission()", () => {
      it("refuses spoken work when there is no mounted composer to resolve its attachments", async () => {
        await expect(makeChat().chat.resolveVoiceSubmission("read attachment")).rejects.toThrow(
          "unavailable"
        );
      });
    });
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
