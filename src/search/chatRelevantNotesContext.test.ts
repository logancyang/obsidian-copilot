import {
  ChatRelevantNotesStore,
  getChatRelevantNotesStore,
  type ChatRelevantNotesContext,
} from "@/search/chatRelevantNotesContext";
const context = (id: string): ChatRelevantNotesContext => ({
  id,
  request: { folder_name: "Vault", draft: id },
  skippedAttachments: 0,
  addFile: jest.fn(),
});
describe("chatRelevantNotesContext", () => {
  describe("getChatRelevantNotesStore()", () => {
    it("isolates vault owners (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const app = {};
      expect(getChatRelevantNotesStore(app)).toBe(getChatRelevantNotesStore(app));
      expect(getChatRelevantNotesStore({})).not.toBe(getChatRelevantNotesStore(app));
    });
  });
  describe("ChatRelevantNotesStore", () => {
    describe("select()", () => {
      it("publishes source changes once (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        const listener = jest.fn();
        store.subscribe(listener);
        const next = context("a");
        store.select(next);
        store.select(next);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.getSnapshot()).toBe(next);
      });
    });
    describe("update()", () => {
      it("does not steal focus from another chat (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        const next = context("a");
        store.select(next);
        store.update(context("b"));
        expect(store.getSnapshot()).toBe(next);
        const updated = context("a");
        store.update(updated);
        expect(store.getSnapshot()).toBe(updated);
      });
    });
    describe("clear()", () => {
      it("clears only the selected session (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        store.select(context("a"));
        store.clear("b");
        expect(store.getSnapshot()).not.toBeNull();
        store.clear("a");
        expect(store.getSnapshot()).toBeNull();
      });
    });
    describe("subscribe()", () => {
      it("removes listeners on disposal", () => {
        const store = new ChatRelevantNotesStore();
        const fn = jest.fn();
        const stop = store.subscribe(fn);
        stop();
        store.select(context("a"));
        expect(fn).not.toHaveBeenCalled();
      });
    });
    describe("getSnapshot()", () => {
      it("starts without a chat source", () => {
        expect(new ChatRelevantNotesStore().getSnapshot()).toBeNull();
      });
    });
  });
});
