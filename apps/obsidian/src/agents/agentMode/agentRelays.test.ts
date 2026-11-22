import { directCopilotToolUse } from "@/agentMode/session/copilotToolCalls";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import type { AgentMention } from "@/agents/agentMentions";
import { findRun, relayRuns, restoreRelayedRuns } from "@/agents/agentMode/agentRelays";
import { formatAgentReply, type AgentReplyRelay } from "@/agents/agentReply";
import { AI_SENDER, USER_SENDER } from "@/constants";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const SEVERAL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/949";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const NO_NOTE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/976";

const LEO_RUN: AgentMention = {
  id: "run-1",
  agent: "leo",
  name: "Leo",
  status: "finished",
  startedAt: 1,
};

function message(
  id: string,
  text: string,
  change: Partial<AgentChatMessage> = {}
): AgentChatMessage {
  return { id, sender: USER_SENDER, message: text, timestamp: null, isVisible: true, ...change };
}

const LEO_MARKER = { agent: "leo", name: "Leo", mention: "run-1" };

function relay(id: string, reply: string): AgentChatMessage {
  return message(
    id,
    formatAgentReply({
      ...LEO_MARKER,
      reply,
      changed: [],
    })
  );
}

const CHAT = [
  message("ask", "@Leo reconcile October", { agentMentions: [LEO_RUN] }),
  message("answer", "Leo has it.", { sender: AI_SENDER }),
  relay("question", "October or November?"),
  message("reply-1", "Leo needs one call from you.", { sender: AI_SENDER }),
  relay("report", "October reconciles."),
];

describe("agentRelays", () => {
  describe("relayRuns()", () => {
    it(`reads each relay's words and finds its run on the message that asked (${ISSUE})`, () => {
      expect(relayRuns(CHAT).get("report")).toEqual({
        relay: { marker: LEO_MARKER, reply: "October reconciles." },
        run: LEO_RUN,
      });
      expect(relayRuns(CHAT).get("question")).toEqual({
        relay: { marker: LEO_MARKER, reply: "October or November?" },
        run: LEO_RUN,
      });
    });

    it(`finds each agent's run when two agents asked in one message relay in turn (${SEVERAL})`, () => {
      const mayaRun: AgentMention = { ...LEO_RUN, id: "run-2", agent: "maya", name: "Maya" };
      const maya = (id: string, reply: string) =>
        message(
          id,
          formatAgentReply({
            agent: "maya",
            name: "Maya",
            mention: "run-2",
            reply,
            changed: [],
          })
        );
      const runs = relayRuns([
        message("ask", "@Leo @Maya does the budget hold?", { agentMentions: [LEO_RUN, mayaRun] }),
        maya("maya-question", "Count the shoot?"),
        relay("leo-report", "The line has $6,200 left."),
        maya("maya-report", "Drop the paid ads."),
      ]);

      expect([...runs].map(([id, { run }]) => [id, run?.agent])).toEqual([
        ["maya-question", "maya"],
        ["leo-report", "leo"],
        ["maya-report", "maya"],
      ]);
    });

    it("reads nothing from an agent's own reply that quotes the marker", () => {
      const quoted = { ...relay("quoted", "October reconciles."), sender: AI_SENDER };

      expect(relayRuns([quoted]).size).toBe(0);
    });

    it("lists only relays, and a relay whose asking message is gone without a run", () => {
      const runs = relayRuns(CHAT.slice(2));

      expect([...runs.keys()]).toEqual(["question", "report"]);
      expect(runs.get("report")?.run).toBeUndefined();
    });
  });

  describe("findRun()", () => {
    const mayaRun: AgentMention = { ...LEO_RUN, id: "run-2", agent: "maya", name: "Maya" };
    const askCall = (id: string): AgentChatMessage["parts"] => [
      { kind: "tool_call", id, title: "ask_teammate", status: "completed" },
    ];
    const ASKS = [
      message("ask", "@Leo @Maya does the budget hold?", { agentMentions: [LEO_RUN, mayaRun] }),
      message("asking", "", { sender: AI_SENDER, parts: askCall("call-leo") }),
      message("more", "Tell Leo to skip Adobe."),
      message("sent", "", { sender: AI_SENDER, parts: askCall("call-more") }),
    ];

    it(`finds a run by its id, as the running agents list and a reply card open it (${CARDS})`, () => {
      expect(findRun(ASKS, { runId: "run-2" })).toBe(mayaRun);
    });

    it(`finds the run an ask started on the last message before its call, for that agent (${CARDS})`, () => {
      expect(findRun(ASKS, { callId: "call-leo", agent: "leo" })).toBe(LEO_RUN);
      expect(findRun(ASKS, { callId: "call-leo", agent: "maya" })).toBe(mayaRun);
    });

    it(`finds the run a later message to an agent already working went to, saved on an earlier message (${CARDS})`, () => {
      expect(findRun(ASKS, { callId: "call-more", agent: "leo" })).toBe(LEO_RUN);
    });

    it("finds nothing for a call or run the chat doesn't hold", () => {
      expect(findRun(ASKS, { callId: "call-gone", agent: "leo" })).toBeUndefined();
      expect(findRun(ASKS, { runId: "run-gone" })).toBeUndefined();
    });
  });

  describe("restoreRelayedRuns()", () => {
    const LEO_CHAT = { backendId: "claude", sessionId: "leo-chat" };
    const ASKED_AT = { epoch: 1_000, display: "10:00", fileName: "1000" };

    function askCall(id: string, agent: string): NonNullable<AgentChatMessage["parts"]>[number] {
      const input = { teammate: agent, message: "Reconcile October." };
      return {
        kind: "tool_call",
        id,
        title: ASK_AGENT_TOOL_NAME,
        status: "completed",
        mcpServer: "obsidian-copilot",
        vendorToolName: ASK_AGENT_TOOL_NAME,
        input,
        copilotTools: directCopilotToolUse("obsidian-copilot", ASK_AGENT_TOOL_NAME, input),
      };
    }

    function asking(id: string, ...calls: [string, string][]): AgentChatMessage {
      return message(id, "Asked.", {
        sender: AI_SENDER,
        parts: calls.map(([callId, agent]) => askCall(callId, agent)),
      });
    }

    function relayed(
      id: string,
      run: Partial<AgentReplyRelay> & Record<string, unknown> = {}
    ): AgentChatMessage {
      return message(
        id,
        formatAgentReply({
          ...LEO_MARKER,
          reply: "October reconciles.",
          changed: [],
          status: "finished",
          chat: LEO_CHAT,
          ...run,
        })
      );
    }

    function reopen(messages: AgentChatMessage[]): AgentChatMessage[] {
      const chat = {
        getDisplayMessages: () => messages,
        setAgentMentions: (id: string, mentions: readonly AgentMention[]) => {
          const at = messages.findIndex((m) => m.id === id);
          messages[at] = { ...messages[at], agentMentions: mentions };
        },
      };
      restoreRelayedRuns(chat);
      return messages;
    }

    const REBUILT: AgentMention = { ...LEO_RUN, startedAt: ASKED_AT.epoch, chat: LEO_CHAT };

    it(`rebuilds a relayed run from its marker on the message that asked, so its cards and the next ask find it in a chat reopened without a note (${NO_NOTE})`, () => {
      const chat = reopen([
        message("ask", "@Leo reconcile October", { timestamp: ASKED_AT }),
        asking("answer", ["call-1", "Leo"]),
        relayed("report"),
      ]);

      expect(chat[0].agentMentions).toEqual([REBUILT]);
      expect(findRun(chat, { callId: "call-1", agent: "leo" })).toEqual(REBUILT);
      expect(relayRuns(chat).get("report")?.run).toEqual(REBUILT);
    });

    it(`takes the run's ending from its last relay, and reads a question never answered as didn't finish (${NO_NOTE})`, () => {
      const answered = reopen([
        message("ask", "@Leo reconcile October", { timestamp: ASKED_AT }),
        asking("answer", ["call-1", "Leo"]),
        relayed("question", { status: "question", question: true }),
        message("month", "October."),
        relayed("report", { status: "stopped" }),
      ]);
      const waiting = reopen([
        message("ask", "@Leo reconcile October", { timestamp: ASKED_AT }),
        asking("answer", ["call-1", "Leo"]),
        relayed("question", { status: "question", question: true }),
      ]);

      expect(answered[0].agentMentions).toEqual([{ ...REBUILT, status: "stopped" }]);
      expect(waiting[0].agentMentions).toEqual([{ ...REBUILT, status: "didnt_finish" }]);
    });

    it(`puts each run on the message before its first ask, so a later message to the same agent and each agent asked together find their own run (${NO_NOTE})`, () => {
      const mayaChat = { backendId: "claude", sessionId: "maya-chat" };
      const chat = reopen([
        message("ask", "@Leo @Maya does the budget hold?", { timestamp: ASKED_AT }),
        asking("answer", ["call-leo", "Leo"], ["call-maya", "Maya"]),
        message("more", "Tell Leo to skip Adobe."),
        asking("sent", ["call-more", "Leo"]),
        relayed("leo-report"),
        relayed("maya-report", { agent: "maya", name: "Maya", mention: "run-2", chat: mayaChat }),
        message("again", "@Leo and November?", { timestamp: { ...ASKED_AT, epoch: 2_000 } }),
        asking("again-answer", ["call-again", "Leo"]),
        relayed("again-report", { mention: "run-3" }),
      ]);

      const maya = { ...REBUILT, id: "run-2", agent: "maya", name: "Maya", chat: mayaChat };
      expect(chat[0].agentMentions).toEqual([REBUILT, maya]);
      expect(chat[6].agentMentions).toEqual([{ ...REBUILT, id: "run-3", startedAt: 2_000 }]);
      expect(findRun(chat, { callId: "call-more", agent: "leo" })).toEqual(REBUILT);
      expect(findRun(chat, { callId: "call-maya", agent: "maya" })).toEqual(maya);
    });

    it(`keeps the run a chat's note saved over the one its relay names (${NO_NOTE})`, () => {
      const saved: AgentMention = { ...LEO_RUN, status: "stopped" };

      const chat = reopen([
        message("ask", "@Leo reconcile October", { agentMentions: [saved] }),
        asking("answer", ["call-1", "Leo"]),
        relayed("report"),
      ]);

      expect(chat[0].agentMentions).toEqual([saved]);
    });

    it(`rebuilds a later run the note lacks on its own ask, after a run the note saved for the same agent (${NO_NOTE})`, () => {
      const chat = reopen([
        message("ask", "@Leo reconcile October", { agentMentions: [LEO_RUN] }),
        asking("answer", ["call-1", "Leo"]),
        relayed("report"),
        message("again", "@Leo and November?", { timestamp: ASKED_AT }),
        asking("again-answer", ["call-2", "Leo"]),
        relayed("again-report", { mention: "run-2" }),
      ]);

      expect(chat[3].agentMentions).toEqual([{ ...REBUILT, id: "run-2" }]);
      expect(findRun(chat, { callId: "call-2", agent: "leo" })?.id).toBe("run-2");
    });

    it.each<[string, Record<string, unknown>]>([
      [
        "without the ending and chat, as written before relays carried them",
        { status: undefined, chat: undefined },
      ],
      ["with an ending it doesn't know", { status: "done" }],
      ["with a chat of the wrong shape", { chat: { backendId: "claude", sessionId: 7 } }],
    ])(`rebuilds no run from a relay %s, and still reads its reply (${NO_NOTE})`, (_case, run) => {
      const chat = reopen([
        message("ask", "@Leo reconcile October", { timestamp: ASKED_AT }),
        asking("answer", ["call-1", "Leo"]),
        relayed("report", run),
      ]);

      expect(chat[0].agentMentions).toBeUndefined();
      expect(relayRuns(chat).get("report")?.relay.reply).toBe("October reconciles.");
      expect(relayRuns(chat).get("report")?.run).toBeUndefined();
    });

    it(`rebuilds no run from a relay with no ask before it in the chat, as when the ask came before the chat it was continued from (${NO_NOTE})`, () => {
      const chat = reopen([message("ask", "Go on."), relayed("report")]);

      expect(chat.map((m) => m.agentMentions)).toEqual([undefined, undefined]);
    });
  });
});
