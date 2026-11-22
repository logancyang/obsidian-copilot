import { fakeChat, fakeChatView } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import {
  AGENT_DRAFT_CARD,
  AGENT_DRAFT_CARD_EXTENSION,
  dismissAgentDraft,
  readAgentDraft,
  showAgentDraft,
} from "@/agents/agentMode/agentDraftCard";
import { AI_SENDER, USER_SENDER } from "@/constants";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/941";
const NORA = { name: "Nora", title: "Family logistics", instruction: "You plan pickups." };

function message(id: string, sender: string): AgentChatMessage {
  return { id, sender, message: id, timestamp: null, isVisible: true };
}

const TWO_TURNS = [
  message("u1", USER_SENDER),
  message("a1", AI_SENDER),
  message("u2", USER_SENDER),
  message("a2", AI_SENDER),
];

describe("agentDraftCard", () => {
  describe("readAgentDraft()", () => {
    it("reads a name, title and instruction, trimmed", () => {
      expect(
        readAgentDraft({ name: " Nora ", title: " Family logistics ", instruction: "Plan.\n" })
      ).toEqual({ name: "Nora", title: "Family logistics", instruction: "Plan." });
    });

    it(`keeps an empty or missing title and instruction for the dialog to check (${ISSUE})`, () => {
      expect(readAgentDraft({ name: "Nora" })).toEqual({
        name: "Nora",
        title: "",
        instruction: "",
      });
      expect(readAgentDraft({ name: "Nora", title: "", instruction: " " })).toEqual({
        name: "Nora",
        title: "",
        instruction: "",
      });
    });

    it.each([
      ["no arguments", undefined],
      ["no name", { instruction: "Plan." }],
      ["an empty name", { name: "  ", instruction: "Plan." }],
      ["a name that is not text", { name: 7, instruction: "Plan." }],
      ["a title that is not text", { name: "Nora", title: ["x"], instruction: "Plan." }],
      ["an instruction that is not text", { name: "Nora", instruction: { text: "Plan." } }],
    ])(`refuses %s (${ISSUE})`, (_label, args) => {
      expect(readAgentDraft(args)).toBeNull();
    });
  });

  describe("showAgentDraft()", () => {
    it("shows the draft after the user's latest turn, naming the agent that drafted it", () => {
      const chat = fakeChat(fakeChatView(TWO_TURNS));

      showAgentDraft(chat, NORA, "coco");

      expect(chat.readChatState(AGENT_DRAFT_CARD)).toEqual({
        draft: NORA,
        draftedBy: "coco",
        afterUserTurn: 2,
      });
    });

    it(`replaces the chat's earlier draft, so only the newest card can open the dialog (${ISSUE})`, () => {
      const transcript = TWO_TURNS.slice(0, 2);
      const chat = fakeChat(fakeChatView(transcript));
      showAgentDraft(chat, NORA, "coco");

      transcript.push(...TWO_TURNS.slice(2));
      const revised = { ...NORA, title: "School runs and swim class" };
      showAgentDraft(chat, revised, "coco");

      expect(chat.readChatState(AGENT_DRAFT_CARD)).toEqual({
        draft: revised,
        draftedBy: "coco",
        afterUserTurn: 2,
      });
    });
  });

  describe("dismissAgentDraft()", () => {
    it(`removes the card, leaving nothing for the chat or its note to show (${ISSUE})`, () => {
      const chat = fakeChat(fakeChatView(TWO_TURNS));
      showAgentDraft(chat, NORA, "coco");

      dismissAgentDraft(chat);

      expect(chat.readChatState(AGENT_DRAFT_CARD)).toBeNull();
    });
  });

  describe("AGENT_DRAFT_CARD_EXTENSION", () => {
    it(`keeps the card across Reload and reads it back from the chat's note (${ISSUE})`, () => {
      const saved = JSON.parse(
        JSON.stringify({ draft: NORA, draftedBy: "coco", afterUserTurn: 1 })
      ) as unknown;

      expect(AGENT_DRAFT_CARD_EXTENSION.keepOnReload).toBe(true);
      expect(AGENT_DRAFT_CARD_EXTENSION.readFromNote?.(saved)).toEqual({
        draft: NORA,
        draftedBy: "coco",
        afterUserTurn: 1,
      });
    });

    it(`reads back a card a Copilot chat drafted, with no drafting agent (${ISSUE})`, () => {
      expect(
        AGENT_DRAFT_CARD_EXTENSION.readFromNote?.({
          draft: NORA,
          draftedBy: null,
          afterUserTurn: 2,
        })
      ).toEqual({ draft: NORA, draftedBy: null, afterUserTurn: 2 });
    });

    it.each([
      ["a list", []],
      ["a draft without a name", { draft: { title: "x" }, draftedBy: "coco", afterUserTurn: 1 }],
      ["no drafting agent", { draft: NORA, afterUserTurn: 1 }],
      ["a turn that is not a whole number", { draft: NORA, draftedBy: "coco", afterUserTurn: "1" }],
    ])(`reads %s edited into the note as no card (${ISSUE})`, (_label, saved) => {
      expect(AGENT_DRAFT_CARD_EXTENSION.readFromNote?.(saved)).toBeNull();
    });
  });
});
