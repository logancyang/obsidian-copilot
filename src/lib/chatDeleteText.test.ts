import {
  describeChatDelete,
  describeChatsDelete,
  formatChatDeleteNotice,
  formatChatsResultNotice,
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

  describe("formatChatsResultNotice()", () => {
    it("says how many chats left Copilot when every delete succeeded", () => {
      expect(formatChatsResultNotice("delete", 3, 0)).toBe("3 chats deleted from Copilot.");
    });

    it("says how many chats were deleted and how many could not be", () => {
      expect(formatChatsResultNotice("delete", 2, 1)).toBe(
        "2 chats deleted from Copilot. 1 chat could not be deleted."
      );
    });

    it("says only how many chats could not be deleted when every delete failed", () => {
      expect(formatChatsResultNotice("delete", 0, 2)).toBe("2 chats could not be deleted.");
    });

    it("reports archiving in the same shape", () => {
      expect(formatChatsResultNotice("archive", 1, 2)).toBe(
        "1 chat archived. 2 chats could not be archived."
      );
    });
  });
});
