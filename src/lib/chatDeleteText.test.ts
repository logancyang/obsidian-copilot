import {
  describeChatDelete,
  describeChatsDelete,
  formatChatDeleteNotice,
  formatChatsDeleteNotice,
} from "@/lib/chatDeleteText";

const AGENTS = [
  ["Claude Code", { displayName: "Claude", agentProductName: "Claude Code" }],
  ["Codex", { displayName: "Codex" }],
] as const;

describe("chatDeleteText", () => {
  describe("describeChatDelete()", () => {
    it.each(AGENTS)("names %s as the agent that may keep its own copy", (name, descriptor) => {
      expect(describeChatDelete(descriptor)).toBe(
        `Delete this chat from Copilot? ${name} may keep its own copy of this conversation on this computer.`
      );
    });

    it("asks only about Copilot when the chat has no known agent", () => {
      expect(describeChatDelete(undefined)).toBe("Delete this chat from Copilot?");
    });
  });

  describe("formatChatDeleteNotice()", () => {
    it.each(AGENTS)(
      "says the chat left Copilot and %s may keep its own copy",
      (name, descriptor) => {
        expect(formatChatDeleteNotice(descriptor)).toBe(
          `Chat deleted from Copilot. ${name} may keep its own copy.`
        );
      }
    );

    it("says only that the chat left Copilot when the chat has no known agent", () => {
      expect(formatChatDeleteNotice(undefined)).toBe("Chat deleted from Copilot.");
    });
  });

  describe("describeChatsDelete()", () => {
    it("asks to delete the number of chats and warns that their agents may keep their own copies", () => {
      expect(describeChatsDelete([AGENTS[0][1], AGENTS[1][1], undefined])).toBe(
        "Delete 3 chats from Copilot? Their agents may keep their own copies of these conversations on this computer."
      );
    });

    it("asks only about Copilot when none of the chats has a known agent", () => {
      expect(describeChatsDelete([undefined, undefined])).toBe("Delete 2 chats from Copilot?");
    });
  });

  describe("formatChatsDeleteNotice()", () => {
    it("says how many chats left Copilot", () => {
      expect(formatChatsDeleteNotice(3)).toBe("3 chats deleted from Copilot.");
    });

    it("uses the singular when only one chat was deleted", () => {
      expect(formatChatsDeleteNotice(1)).toBe("1 chat deleted from Copilot.");
    });
  });
});
