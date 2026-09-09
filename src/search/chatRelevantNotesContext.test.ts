import {
  ChatRelevantNotesStore,
  getChatRelevantNotesStore,
  type ChatRelevantNotesContext,
} from "@/search/chatRelevantNotesContext";

const context = (id: string, draft: string): ChatRelevantNotesContext => ({
  id,
  request: { folder_name: "Vault", draft },
  skippedAttachments: 0,
  addFile: jest.fn(),
});

describe("chatRelevantNotesContext", () => {
  describe("getChatRelevantNotesStore()", () => {
    it("shares the selected chat between callers in the same vault (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const vault = {};
      const chat = context("chat-1", "How do embeddings work?");
      getChatRelevantNotesStore(vault).select(chat);

      expect(getChatRelevantNotesStore(vault).getSnapshot()).toBe(chat);
    });

    it("keeps selecting a chat in one vault from changing another vault's selection (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
      const firstVault = {};
      const secondVault = {};
      const firstChat = context("chat-1", "How do embeddings work?");
      const secondChat = context("chat-2", "How does lexical search work?");
      getChatRelevantNotesStore(firstVault).select(firstChat);
      getChatRelevantNotesStore(secondVault).select(secondChat);

      expect(getChatRelevantNotesStore(firstVault).getSnapshot()).toBe(firstChat);
      expect(getChatRelevantNotesStore(secondVault).getSnapshot()).toBe(secondChat);
    });
  });

  describe("ChatRelevantNotesStore", () => {
    describe("select()", () => {
      it("makes the chosen chat the context source for Relevant Notes (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        const chosenChat = context("chat-1", "How do embeddings work?");

        store.select(chosenChat);

        expect(store.getSnapshot()).toBe(chosenChat);
      });

      it("switches the context source to another chat before notifying subscribers (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        store.select(context("chat-1", "How do embeddings work?"));
        const nextChat = context("chat-2", "How does lexical search work?");
        const listener = jest.fn(() => store.getSnapshot());
        store.subscribe(listener);

        store.select(nextChat);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveReturnedWith(nextChat);
        expect(store.getSnapshot()).toBe(nextChat);
      });

      it("removes the chat context source and notifies subscribers when given null (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        store.select(context("chat-1", "How do embeddings work?"));
        const listener = jest.fn(() => store.getSnapshot());
        store.subscribe(listener);

        store.select(null);

        expect(store.getSnapshot()).toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveReturnedWith(null);
      });

      it("does not notify subscribers again when the same chat context object is reselected (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        const selectedChat = context("chat-1", "How do embeddings work?");
        store.select(selectedChat);
        const listener = jest.fn();
        store.subscribe(listener);

        store.select(selectedChat);

        expect(listener).not.toHaveBeenCalled();
        expect(store.getSnapshot()).toBe(selectedChat);
      });
    });

    describe("update()", () => {
      it("refreshes the selected chat's draft and notifies subscribers (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        store.select(context("chat-1", "How do embeddings work?"));
        const updatedChat = context("chat-1", "How are embeddings stored?");
        const listener = jest.fn(() => store.getSnapshot());
        store.subscribe(listener);

        store.update(updatedChat);

        expect(store.getSnapshot()).toBe(updatedChat);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveReturnedWith(updatedChat);
      });

      it("keeps the selected chat's context when a different chat updates its draft (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        const selectedChat = context("chat-1", "How do embeddings work?");
        store.select(selectedChat);
        const listener = jest.fn();
        store.subscribe(listener);

        store.update(context("chat-2", "How does lexical search work?"));

        expect(store.getSnapshot()).toBe(selectedChat);
        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("clear()", () => {
      it("removes the context source and notifies subscribers when the selected chat is cleared (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        store.select(context("chat-1", "How do embeddings work?"));
        const listener = jest.fn(() => store.getSnapshot());
        store.subscribe(listener);

        store.clear("chat-1");

        expect(store.getSnapshot()).toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveReturnedWith(null);
      });

      it("keeps the selected chat's context when a different chat is cleared (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", () => {
        const store = new ChatRelevantNotesStore();
        const selectedChat = context("chat-1", "How do embeddings work?");
        store.select(selectedChat);
        const listener = jest.fn();
        store.subscribe(listener);

        store.clear("chat-2");

        expect(store.getSnapshot()).toBe(selectedChat);
        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("subscribe()", () => {
      it("notifies every subscriber when the chat context source changes", () => {
        const store = new ChatRelevantNotesStore();
        const firstListener = jest.fn();
        const secondListener = jest.fn();
        store.subscribe(firstListener);
        store.subscribe(secondListener);

        store.select(context("chat-1", "How do embeddings work?"));

        expect(firstListener).toHaveBeenCalledTimes(1);
        expect(secondListener).toHaveBeenCalledTimes(1);
      });

      it("stops notifying an unsubscribed listener while other subscribers still receive changes", () => {
        const store = new ChatRelevantNotesStore();
        const removedListener = jest.fn();
        const activeListener = jest.fn();
        const unsubscribe = store.subscribe(removedListener);
        store.subscribe(activeListener);
        unsubscribe();

        store.select(context("chat-1", "How do embeddings work?"));

        expect(removedListener).not.toHaveBeenCalled();
        expect(activeListener).toHaveBeenCalledTimes(1);
      });
    });

    describe("getSnapshot()", () => {
      it("returns null before any chat has been selected as the Relevant Notes context source", () => {
        expect(new ChatRelevantNotesStore().getSnapshot()).toBeNull();
      });
    });
  });
});
