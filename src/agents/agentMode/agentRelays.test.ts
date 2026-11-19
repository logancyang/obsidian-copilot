import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentMention } from "@/agents/agentMentions";
import { findRun, relayRuns, useRelayRuns } from "@/agents/agentMode/agentRelays";
import { formatAgentReply } from "@/agents/agentReply";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { setCustomAgentsLaunched } from "@/agents/testing/customAgentsLaunched";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { resetSettings } from "@/settings/model";
import { renderHook } from "@testing-library/react";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const SEVERAL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/949";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";

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
  beforeEach(() => resetSettings());

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
      { kind: "tool_call", id, title: "ask_agent", status: "completed" },
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

  describe("useRelayRuns()", () => {
    it("indexes the chat's relays while custom agents are available", async () => {
      await setCustomAgentsAccess("team");

      const { result } = renderHook(() => useRelayRuns(CHAT));

      expect(result.current.size).toBe(2);
    });

    it("still indexes the relays after the license lapsed (https://github.com/Brevilabs/obsidian-copilot-private/issues/950)", async () => {
      await setCustomAgentsAccess("free");
      setCustomAgentsLaunched(true);
      const { result } = renderHook(() => useRelayRuns(CHAT));

      expect(result.current.size).toBe(2);
    });

    it(`indexes nothing without a license that includes custom agents (${ISSUE})`, async () => {
      await setCustomAgentsAccess("free");

      const { result } = renderHook(() => useRelayRuns(CHAT));

      expect(result.current.size).toBe(0);
    });
  });
});
