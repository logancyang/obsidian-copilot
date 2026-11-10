import {
  defineChatExtension,
  EMPTY_CHAT_STATES,
  readChatState,
  withChatState,
  type ChatStateKey,
} from "./chatExtension";

const COUNTER: ChatStateKey<number> = Object.freeze({ id: "counter", initial: 0 });

describe("chatExtension", () => {
  describe("readChatState()", () => {
    it("returns a feature's stored state, or its initial state before anything is stored", () => {
      expect(readChatState(EMPTY_CHAT_STATES, COUNTER)).toBe(0);
      expect(readChatState(withChatState(EMPTY_CHAT_STATES, COUNTER, 3), COUNTER)).toBe(3);
    });
  });

  describe("withChatState()", () => {
    it("returns a new frozen snapshot with the feature's state and leaves the old one untouched", () => {
      const next = withChatState(EMPTY_CHAT_STATES, COUNTER, 1);

      expect(next).not.toBe(EMPTY_CHAT_STATES);
      expect(Object.isFrozen(next)).toBe(true);
      expect(readChatState(EMPTY_CHAT_STATES, COUNTER)).toBe(0);
    });

    it("returns the same snapshot when the state did not change, so nothing re-renders", () => {
      const states = withChatState(EMPTY_CHAT_STATES, COUNTER, 1);

      expect(withChatState(states, COUNTER, 1)).toBe(states);
      expect(withChatState(EMPTY_CHAT_STATES, COUNTER, 0)).toBe(EMPTY_CHAT_STATES);
    });
  });

  describe("defineChatExtension()", () => {
    it("returns the extension unchanged and frozen", () => {
      const onTurnFailed = (count: number) => count + 1;

      const extension = defineChatExtension({ key: COUNTER, onTurnFailed });

      expect(extension.key).toBe(COUNTER);
      expect(extension.onTurnFailed).toBe(onTurnFailed);
      expect(Object.isFrozen(extension)).toBe(true);
    });
  });
});
