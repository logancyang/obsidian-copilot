import {
  EMPTY_CHAT_STATES,
  withChatState,
  type ChatStateKey,
} from "@/agentMode/session/chatExtension";
import { fakeChat } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  defineChatCardSlot,
  findTrailingCardIndex,
  NO_PLACED_CHAT_CARDS,
  placeChatCards,
} from "./chatCards";

jest.mock("@/constants", () => ({ USER_SENDER: "user" }));

function message(id: string, sender: "user" | "AI"): AgentChatMessage {
  return { id, sender, message: id, timestamp: null, isVisible: true };
}

const TRANSCRIPT = [
  message("user-1", "user"),
  message("ai-1", "AI"),
  message("user-2", "user"),
  message("ai-2a", "AI"),
  message("ai-2b", "AI"),
  message("user-3", "user"),
  message("ai-3", "AI"),
];

const NOTES: ChatStateKey<readonly { id: string; after: string }[]> = Object.freeze({
  id: "notes",
  initial: [],
});

const NOTES_SLOT = defineChatCardSlot({
  key: NOTES,
  place: (notes) => notes.map(({ id, after }) => ({ id, afterUserMessageId: after })),
  render: (_notes, cardId) => <div>card {cardId}</div>,
});

const CTX = { plugin: {} as CopilotPlugin, chat: fakeChat() };

describe("chatCards", () => {
  describe("findTrailingCardIndex()", () => {
    it("places a card after the last reply of the turn that raised it", () => {
      expect(findTrailingCardIndex(TRANSCRIPT, "user-2")).toBe(4);
    });

    it("places a card at the end while the raising turn is still the latest", () => {
      expect(findTrailingCardIndex(TRANSCRIPT.slice(0, 5), "user-2")).toBe(4);
    });

    it("places a card at the end when the raising message is no longer in the transcript", () => {
      expect(findTrailingCardIndex(TRANSCRIPT.slice(0, 2), null)).toBe(1);
    });

    it("finds no place in an empty transcript", () => {
      expect(findTrailingCardIndex([], "user-2")).toBe(-1);
    });
  });

  describe("placeChatCards()", () => {
    it("renders each slot's cards after the turns that raised them, in slot order", () => {
      const states = withChatState(EMPTY_CHAT_STATES, NOTES, [
        { id: "a", after: "user-1" },
        { id: "b", after: "user-2" },
        { id: "c", after: "user-2" },
      ]);

      const placed = placeChatCards(TRANSCRIPT, states, CTX, [NOTES_SLOT]);

      expect([...placed.keys()]).toEqual([1, 4]);
      render(<>{placed.get(4)}</>);
      expect(screen.getAllByText(/^card /).map((node) => node.textContent)).toEqual([
        "card b",
        "card c",
      ]);
    });

    it("places nothing for a slot whose state is still its initial one, or in an empty transcript", () => {
      const states = withChatState(EMPTY_CHAT_STATES, NOTES, [{ id: "a", after: "user-1" }]);

      expect(placeChatCards(TRANSCRIPT, EMPTY_CHAT_STATES, CTX, [NOTES_SLOT]).size).toBe(0);
      expect(placeChatCards([], states, CTX, [NOTES_SLOT]).size).toBe(0);
    });
  });

  describe("defineChatCardSlot()", () => {
    it("returns the slot unchanged and frozen", () => {
      expect(NOTES_SLOT.key).toBe(NOTES);
      expect(Object.isFrozen(NOTES_SLOT)).toBe(true);
      expect(NOTES_SLOT.place([])).toEqual(NO_PLACED_CHAT_CARDS);
    });
  });
});
