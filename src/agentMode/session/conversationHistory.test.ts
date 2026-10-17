import {
  buildConversationHistoryBlock,
  CONVERSATION_HISTORY_MAX_CHARS,
} from "@/agentMode/session/conversationHistory";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";
import type { MessageContext } from "@/types/message";

const histMsg = (sender: string, message: string): AgentChatMessage => ({
  id: `${sender}-${message.slice(0, 8)}`,
  sender,
  timestamp: null,
  isVisible: true,
  message,
});

describe("conversationHistory", () => {
  describe("buildConversationHistoryBlock()", () => {
    it("renders prior turns labeled by role, framed as read-only history", () => {
      const block = buildConversationHistoryBlock(
        [histMsg(USER_SENDER, "What is the plan?"), histMsg(AI_SENDER, "Here is the plan.")],
        CONVERSATION_HISTORY_MAX_CHARS
      )!;
      expect(block).toContain("<conversation_history>");
      expect(block).toContain("</conversation_history>");
      expect(block).toContain('<turn role="user">');
      expect(block).toContain('<turn role="assistant">');
      expect(block).toContain("What is the plan?");
      expect(block).toContain("Here is the plan.");
      expect(block.toLowerCase()).toContain("do not");
      expect(block.indexOf("What is the plan?")).toBeLessThan(block.indexOf("Here is the plan."));
    });

    it("returns null for an empty transcript", () => {
      expect(buildConversationHistoryBlock([], CONVERSATION_HISTORY_MAX_CHARS)).toBeNull();
    });

    it("drops the oldest turns first and prepends a truncation marker past the cap", () => {
      const big = "x".repeat(400);
      const messages = Array.from({ length: 20 }, (_, i) =>
        histMsg(i % 2 === 0 ? USER_SENDER : AI_SENDER, `turn-${i}-${big}`)
      );
      const block = buildConversationHistoryBlock(messages, 1000)!;
      expect(block).toContain("[earlier conversation truncated]");
      expect(block).not.toContain("turn-0-");
      expect(block).toContain("turn-19-");
    });

    const withContext = (
      sender: string,
      message: string,
      context: MessageContext
    ): AgentChatMessage => ({ ...histMsg(sender, message), context });

    it("includes the user's attached context (a selected-text excerpt) in history", () => {
      const msg = withContext(USER_SENDER, "explain the selected excerpt above", {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "s1",
            sourceType: "note",
            noteTitle: "DesignDoc",
            notePath: "DesignDoc.md",
            startLine: 3,
            endLine: 9,
            content: "the fan-out renderer drops context",
          },
        ],
      });
      const block = buildConversationHistoryBlock([msg], CONVERSATION_HISTORY_MAX_CHARS)!;
      expect(block).toContain("[context]");
      expect(block).toContain("[selected from DesignDoc]");
      expect(block).toContain("the fan-out renderer drops context");
    });
  });
});
