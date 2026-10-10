import { describeChatDelete, formatChatDeleteNotice } from "@/lib/chatDeleteText";

const AGENTS = [
  ["Claude Code", { displayName: "Claude", agentProductName: "Claude Code" }],
  ["Codex", { displayName: "Codex" }],
  ["opencode", { displayName: "opencode" }],
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
});
