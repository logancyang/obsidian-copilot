import type { AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentMention } from "@/agents/agentMentions";
import { overflowDot, tabDot, type TabDotChat } from "@/agents/agentMode/tabDot";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/948";

function askedLeo(status: AgentMention["status"]): AgentChatMessage[] {
  return [
    {
      id: "asked",
      sender: "user",
      timestamp: null,
      isVisible: true,
      message: "@Leo reconcile October",
      agentMentions: [{ id: "run", agent: "leo", name: "Leo", status, startedAt: 0 }],
    },
  ];
}

function chat({
  status,
  needsAttention,
  messages,
}: {
  status: AgentSessionStatus;
  needsAttention: boolean;
  messages: readonly AgentChatMessage[];
}): TabDotChat {
  return {
    getStatus: () => status,
    getNeedsAttention: () => needsAttention,
    store: { getDisplayMessages: () => messages },
  } as unknown as TabDotChat;
}

describe("tabDot", () => {
  describe("tabDot()", () => {
    it(`marks a chat that finished while the user was elsewhere green, including after relaying an asked agent's reply (${ISSUE})`, () => {
      expect(tabDot(chat({ status: "idle", needsAttention: true, messages: [] }))).toBe("done");
      expect(
        tabDot(chat({ status: "idle", needsAttention: true, messages: askedLeo("finished") }))
      ).toBe("done");
    });

    it.each(["question", "permission"] as const)(
      `marks a chat whose asked agent waits on a %s orange (${ISSUE})`,
      (status) => {
        expect(
          tabDot(chat({ status: "idle", needsAttention: true, messages: askedLeo(status) }))
        ).toBe("waiting");
      }
    );

    it(`marks a background chat orange while an agent it asked waits for the user's OK, though no turn ran in it, and not the chat on screen (${ISSUE})`, () => {
      const waiting = chat({
        status: "idle",
        needsAttention: false,
        messages: askedLeo("permission"),
      });

      expect(tabDot(waiting)).toBe("waiting");
      expect(tabDot(waiting, true)).toBeNull();
    });

    it(`marks a chat waiting on the user's permission orange (${ISSUE})`, () => {
      expect(
        tabDot(chat({ status: "awaiting_permission", needsAttention: true, messages: [] }))
      ).toBe("waiting");
    });

    it(`shows no dot while the chat responds, or once the user has seen it, apart from an error (${ISSUE})`, () => {
      expect(tabDot(chat({ status: "running", needsAttention: true, messages: [] }))).toBeNull();
      expect(
        tabDot(chat({ status: "idle", needsAttention: false, messages: askedLeo("question") }))
      ).toBeNull();
      expect(tabDot(chat({ status: "error", needsAttention: false, messages: [] }))).toBe("error");
    });
  });

  describe("overflowDot()", () => {
    it(`puts the most urgent dot of the chats in the menu on its button: waiting, then done (${ISSUE})`, () => {
      expect(overflowDot([null, "done", "waiting", "error"])).toBe("waiting");
      expect(overflowDot(["error", "done"])).toBe("done");
      expect(overflowDot(["error"])).toBe("error");
      expect(overflowDot([null, null])).toBeNull();
    });
  });
});
