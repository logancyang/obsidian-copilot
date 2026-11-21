import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import {
  ANSWER_AGENT_TOOL_NAME,
  CHECK_AGENT_TOOL_NAME,
  STOP_AGENT_TOOL_NAME,
} from "@/agents/agentMode/agentToolCalls";
import {
  ASK_USER_TOOL_NAME,
  createAnswerAgentTool,
  createAskUserTool,
  createAskAgentTool,
  createCheckAgentTool,
  createStopAgentTool,
  relistOnCustomAgentsGateChange,
} from "@/agents/agentMode/askAgentTool";
import type {
  AnswerAgentResult,
  AskAgentResult,
  CheckAgentResult,
  HiddenAgentChats,
  StopAgentResult,
} from "@/agents/agentMode/hiddenAgentChats";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { setSettings } from "@/settings/model";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/944";
const CONTROL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/945";
const MAYA = { slug: "maya", name: "Maya", title: "Product critic" } as CustomAgent;
const LEO = { slug: "leo", name: "Leo", title: "" } as CustomAgent;
const CHAT = {} as ChatStateHost;
const HINTS_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/986";
const CONTROL_HINT =
  "When the user asks how an agent you asked is doing, check with check_agent; when the user answers its question, pass the answer with answer_agent; when the user gives it a new instruction while it works, send that with ask_agent; when the user tells you to stop it, use stop_agent. All are in obsidian-copilot.";

function buildTool(options: { unlisted?: string[]; asked?: AskAgentResult } = {}) {
  const ask = jest.fn(() => options.asked ?? { kind: "asked" as const, agent: MAYA });
  const tool = createAskAgentTool({ ask } as unknown as HiddenAgentChats, {
    isUnlistedChat: (key) => options.unlisted?.includes(key) ?? false,
  });
  return { tool, ask };
}

const HOST = {
  isUnlistedChat: (key: string) => key.startsWith("hidden"),
};

function descriptionFor(
  tool: ReturnType<typeof buildTool>["tool"],
  sessionKey: string
): string | null {
  const listed = tool.listedAs?.({ sessionKey, backendId: "claude" });
  return listed ? (listed as unknown as { description: string }).description : null;
}

describe("askAgentTool", () => {
  beforeEach(() => setCustomAgentsAccess("team"));

  describe("createAskAgentTool()", () => {
    it(`gives a model that can't see tool descriptions the sentence naming ask_agent and when to call it (${HINTS_ISSUE})`, () => {
      expect(buildTool().tool.promptHint).toBe(
        "When the user's message @-mentions one of the user's agents by name or clearly points to one, ask that agent with the ask_agent tool from obsidian-copilot; never otherwise."
      );
    });

    it(`lists one definition naming no agent for every chat the user sees, so an agent created, renamed or deleted after an agent listed its tools is asked by its current name (${ISSUE})`, () => {
      const { tool } = buildTool();

      const listed = ["coco-chat", "copilot-chat", "opencode:/vault"].map((sessionKey) =>
        tool.listedAs?.({ sessionKey, backendId: "opencode" })
      );

      expect(listed).toEqual([tool.definition, tool.definition, tool.definition]);
      expect(descriptionFor(tool, "coco-chat")).not.toContain("Agents you can ask");
    });

    it(`says when to call it in the opening that OpenCode's catalog shows, to call it with the name or job the user gave since no agent is listed, then to answer in one line and end the turn (${ISSUE})`, () => {
      const description = descriptionFor(buildTool().tool, "chat-1")!;

      expect(description.slice(0, 120)).toContain(
        "only when the user's message @-mentions it by name or clearly points to it"
      );
      expect(description).toContain(
        "tell the user in one short line who you asked and that you'll bring back the reply, and end your turn"
      );
      expect(description).toContain(
        "When the user names an agent without an @, or only describes its job, call this with the name or job they gave: a name no agent has answers with the agents you can ask."
      );
      expect(description).toContain(RELAY_PRINCIPLE);
    });

    it(`tells the asking agent to pass a rule for the asked agent on in the user's own words (https://github.com/Brevilabs/obsidian-copilot-private/issues/969)`, () => {
      const description = descriptionFor(buildTool().tool, "chat-1")!;

      expect(description).toContain(
        "Pass a rule the user gives it for later in the user's own words."
      );
      expect(description).not.toContain("can't save");
    });

    it(`leaves the tool out of an asked agent's own chat (${ISSUE})`, () => {
      const { tool } = buildTool({ unlisted: ["hidden-1"] });

      expect(tool.listedAs?.({ sessionKey: "hidden-1", backendId: "claude" })).toBeNull();
    });

    it(`leaves the tool out while custom agents are not available (${ISSUE})`, async () => {
      await setCustomAgentsAccess("free");

      expect(buildTool().tool.listedAs?.({ sessionKey: "chat-1", backendId: "claude" })).toBeNull();
    });

    it(`asks the named agent for the calling chat and tells the agent to answer in one line and end its turn (${ISSUE})`, async () => {
      const { tool, ask } = buildTool();

      const result = await tool.call({ agent: "Maya", message: "Review the plan." }, CHAT);

      expect(ask).toHaveBeenCalledWith(CHAT, "Maya", "Review the plan.");
      expect(result).toEqual({
        text: "Maya is working on it in the background. Tell the user in one short line that you asked Maya and will bring back the reply, then end your turn.",
        isError: false,
      });
    });

    it(`names the agents to ask, each with its title, when the name matches none, so a chat that knows only a job finds the agent from the answer (${ISSUE})`, async () => {
      const { tool } = buildTool({ asked: { kind: "unknown_agent", roster: [MAYA, LEO] } });

      await expect(tool.call({ agent: "Nora", message: "Hi" }, CHAT)).resolves.toEqual({
        text: "No agent has that name. Agents you can ask: Maya (Product critic); Leo.",
        isError: true,
      });
    });

    it(`tells a chat with no other agent that there is no one to ask, since the tool is listed before any other agent exists (${ISSUE})`, async () => {
      const { tool } = buildTool({ asked: { kind: "unknown_agent", roster: [] } });

      await expect(tool.call({ agent: "Maya", message: "Hi" }, CHAT)).resolves.toEqual({
        text: "There are no other agents to ask.",
        isError: true,
      });
    });

    it(`tells an agent that asked itself to answer directly (${ISSUE})`, async () => {
      const { tool } = buildTool({ asked: { kind: "self", agent: MAYA } });

      await expect(tool.call({ agent: "Maya", message: "Hi" }, CHAT)).resolves.toEqual({
        text: "You are Maya; you can't ask yourself. Answer the user directly.",
        isError: true,
      });
    });

    it(`tells the agent its message reached the working agent in the same chat, now or after its current step, as a call that succeeded (${CONTROL})`, async () => {
      const now = await buildTool({ asked: { kind: "sent", agent: MAYA, now: true } }).tool.call(
        { agent: "Maya", message: "Skip the outro." },
        CHAT
      );
      const later = await buildTool({ asked: { kind: "sent", agent: MAYA, now: false } }).tool.call(
        { agent: "Maya", message: "Skip the outro." },
        CHAT
      );

      expect(now.text).toBe(
        "Sent Maya your message in the chat Maya is working in; Maya reads it now. Tell the user in one short line, then end your turn."
      );
      expect(later.text).toBe(
        "Sent Maya your message in the chat Maya is working in; Maya gets it after the current step. Tell the user in one short line, then end your turn."
      );
      expect([now.isError, later.isError]).toEqual([false, false]);
    });

    it(`fails a call for an agent waiting on the user's answer, quoting the question and saying to ask the user, end the turn and pass the user's reply, even a change of plan, with answer_agent (${CONTROL})`, async () => {
      const { tool } = buildTool({
        asked: { kind: "awaiting_answer", agent: LEO, question: "Which month?" },
      });

      await expect(
        tool.call({ agent: "Leo", message: "Which month should I use?" }, CHAT)
      ).resolves.toEqual({
        text: "Nothing was sent: Leo is waiting for the user's answer to this question:\nWhich month?\n\nAsk the user this question in your own words if you haven't yet, then end your turn. When the user replies to it, even with a change of plan, pass their words to Leo with answer_agent.",
        isError: true,
      });
    });

    it(`fails a call for an agent whose model can't run on this device, giving the reason to tell the user and where to fix it (https://github.com/Brevilabs/obsidian-copilot-private/issues/962)`, async () => {
      const { tool } = buildTool({
        asked: {
          kind: "cannot_run",
          agent: LEO,
          reason: "Leo runs on OpenCode, which isn't set up on this device.",
        },
      });

      await expect(tool.call({ agent: "Leo", message: "Check the books." }, CHAT)).resolves.toEqual(
        {
          text: "Nothing was sent: Leo runs on OpenCode, which isn't set up on this device. Tell the user, and that they can pick another model in Leo's profile.",
          isError: true,
        }
      );
    });

    it("rejects a call without an agent or a message", async () => {
      const { tool, ask } = buildTool();

      await expect(tool.call({ agent: "Maya", message: " " }, CHAT)).resolves.toEqual({
        text: "agent and message must be non-empty strings.",
        isError: true,
      });
      expect(ask).not.toHaveBeenCalled();
      expect(tool.definition.name).toBe(ASK_AGENT_TOOL_NAME);
    });
  });

  describe("createAnswerAgentTool()", () => {
    function buildAnswer(result: AnswerAgentResult) {
      const answer = jest.fn(() => result);
      return {
        tool: createAnswerAgentTool({ answer } as unknown as HiddenAgentChats, HOST),
        answer,
      };
    }

    it(`gives a model that can't see tool descriptions the one sentence naming check_agent, answer_agent and stop_agent (${HINTS_ISSUE})`, () => {
      expect(buildAnswer({ kind: "answered", agent: MAYA }).tool.promptHint).toBe(CONTROL_HINT);
    });

    it(`lists the answer tool for the chats that can ask, and leaves it out of an asked agent's own chat (${CONTROL})`, () => {
      const { tool } = buildAnswer({ kind: "answered", agent: MAYA });

      expect(tool.listedAs?.({ sessionKey: "chat-1", backendId: "claude" })?.name).toBe(
        ANSWER_AGENT_TOOL_NAME
      );
      expect(tool.listedAs?.({ sessionKey: "hidden-1", backendId: "claude" })).toBeNull();
    });

    it(`passes the user's answer to the named agent for the calling chat and tells the agent to say so in one line (${CONTROL})`, async () => {
      const { tool, answer } = buildAnswer({ kind: "answered", agent: MAYA });

      const result = await tool.call({ agent: "Maya", answer: "October." }, CHAT);

      expect(answer).toHaveBeenCalledWith(CHAT, "Maya", "October.");
      expect(result).toEqual({
        text: "Passed the answer to Maya, who carries on. Tell the user in one short line, then end your turn.",
        isError: false,
      });
    });

    it(`marks the call failed when no answer was passed, saying the agent has no question waiting and pointing to ask_agent (${CONTROL})`, async () => {
      const { tool } = buildAnswer({ kind: "no_question", agent: MAYA });

      await expect(tool.call({ agent: "Maya", answer: "October." }, CHAT)).resolves.toEqual({
        text: "Maya has no question waiting. To send Maya a new instruction, use ask_agent.",
        isError: true,
      });
      await expect(
        buildAnswer({ kind: "not_from_here" }).tool.call(
          { agent: "Maya", answer: "October." },
          CHAT
        )
      ).resolves.toEqual(expect.objectContaining({ isError: true }));
    });

    it("rejects a call without an answer", async () => {
      const { tool, answer } = buildAnswer({ kind: "answered", agent: MAYA });

      await expect(tool.call({ agent: "Maya", answer: " " }, CHAT)).resolves.toEqual({
        text: "answer must be a non-empty string.",
        isError: true,
      });
      expect(answer).not.toHaveBeenCalled();
    });
  });

  describe("createAskUserTool()", () => {
    function buildAskUser(result: "asked" | "unavailable" | "not_from_here") {
      const askUser = jest.fn(() => result);
      return { tool: createAskUserTool({ askUser } as unknown as HiddenAgentChats, HOST), askUser };
    }

    it(`has no prompt hint, since the message that asks the agent already names ask_user (${HINTS_ISSUE})`, () => {
      expect(buildAskUser("asked").tool.promptHint).toBeUndefined();
    });

    it(`lists the question tool only for an asked agent's own chat, or a folder's shared listing that also reaches it, and never for a chat the user sees (${CONTROL})`, () => {
      const { tool } = buildAskUser("asked");

      expect(tool.listedAs?.({ sessionKey: "hidden-1", backendId: "claude" })?.name).toBe(
        ASK_USER_TOOL_NAME
      );
      expect(
        tool.listedAs?.({ sessionKey: "opencode:/vault", backendId: "opencode", shared: true })
          ?.name
      ).toBe(ASK_USER_TOOL_NAME);
      expect(tool.listedAs?.({ sessionKey: "chat-1", backendId: "claude" })).toBeNull();
    });

    it(`leaves the question tool out while custom agents are not available (${CONTROL})`, async () => {
      await setCustomAgentsAccess("free");

      expect(
        buildAskUser("asked").tool.listedAs?.({ sessionKey: "hidden-1", backendId: "claude" })
      ).toBeNull();
    });

    it(`passes the question on for the calling chat and tells the asked agent to end its turn and wait for the answer (${CONTROL})`, async () => {
      const { tool, askUser } = buildAskUser("asked");

      const result = await tool.call({ question: "October or November?" }, CHAT);

      expect(askUser).toHaveBeenCalledWith(CHAT, "October or November?");
      expect(result).toEqual({
        text: "Your question is on its way to the user. End your turn now without saying more; the answer comes back as your next message.",
        isError: false,
      });
    });

    it(`tells a chat the user sees to ask the user directly, marking the call failed (${CONTROL})`, async () => {
      await expect(
        buildAskUser("not_from_here").tool.call({ question: "October?" }, CHAT)
      ).resolves.toEqual({
        text: "Only an agent asked into another agent's chat can use ask_user. Ask the user directly in your reply.",
        isError: true,
      });
    });
  });

  describe("createCheckAgentTool()", () => {
    function buildCheck(result: CheckAgentResult) {
      const check = jest.fn(() => result);
      return { tool: createCheckAgentTool({ check } as unknown as HiddenAgentChats, HOST), check };
    }

    it(`gives a model that can't see tool descriptions the one sentence naming check_agent, answer_agent and stop_agent (${HINTS_ISSUE})`, () => {
      expect(buildCheck({ kind: "not_asked", agent: MAYA }).tool.promptHint).toBe(CONTROL_HINT);
    });

    it(`lists the check tool for the chats that can ask, says to call it each time the user asks, and leaves it out of an asked agent's own chat (${CONTROL})`, () => {
      const { tool } = buildCheck({ kind: "not_asked", agent: MAYA });

      const listed = tool.listedAs?.({ sessionKey: "chat-1", backendId: "claude" });

      expect(listed?.name).toBe(CHECK_AGENT_TOOL_NAME);
      expect((listed as unknown as { description: string }).description.slice(0, 120)).toContain(
        "each time the user asks how an agent you asked is doing"
      );
      expect(tool.listedAs?.({ sessionKey: "hidden-1", backendId: "claude" })).toBeNull();
    });

    it(`returns the agent's progress for the calling chat to retell in the agent's own words (${CONTROL})`, async () => {
      const { tool, check } = buildCheck({
        kind: "progress",
        agent: MAYA,
        progress: "Maya has been working for 3 min.",
      });

      const result = await tool.call({ agent: "Maya" }, CHAT);

      expect(check).toHaveBeenCalledWith(CHAT, "Maya");
      expect(result).toEqual({
        text: "Maya has been working for 3 min.\n\nTell the user in your own words how far Maya got. Don't paste this.",
        isError: false,
      });
    });

    it(`says the agent isn't working and how to send it back when no run from this chat is known, as after a reload, and turns down a call from an asked agent's own chat, failing both calls so the chat doesn't show a check (${CONTROL})`, async () => {
      await expect(
        buildCheck({ kind: "not_asked", agent: MAYA }).tool.call({ agent: "Maya" }, CHAT)
      ).resolves.toEqual({
        text: "Maya isn't working on anything from this chat now. To send Maya back to it, use ask_agent.",
        isError: true,
      });
      await expect(
        buildCheck({ kind: "not_from_here" }).tool.call({ agent: "Maya" }, CHAT)
      ).resolves.toEqual({
        text: "You can't ask another agent from this chat. Don't call check_agent again.",
        isError: true,
      });
    });
  });

  describe("createStopAgentTool()", () => {
    function buildStop(result: StopAgentResult) {
      const stop = jest.fn(() => result);
      return { tool: createStopAgentTool({ stop } as unknown as HiddenAgentChats, HOST), stop };
    }

    it(`gives a model that can't see tool descriptions the one sentence naming check_agent, answer_agent and stop_agent (${HINTS_ISSUE})`, () => {
      expect(buildStop({ kind: "not_asked", agent: MAYA }).tool.promptHint).toBe(CONTROL_HINT);
    });

    it(`lists the stop tool for the chats that can ask, and leaves it out of an asked agent's own chat (${CONTROL})`, () => {
      const { tool } = buildStop({ kind: "stopped", agent: MAYA });

      expect(tool.listedAs?.({ sessionKey: "chat-1", backendId: "claude" })?.name).toBe(
        STOP_AGENT_TOOL_NAME
      );
      expect(tool.listedAs?.({ sessionKey: "hidden-1", backendId: "claude" })).toBeNull();
    });

    it(`stops the named agent for the calling chat and tells the agent to end its turn until the report comes back (${CONTROL})`, async () => {
      const { tool, stop } = buildStop({ kind: "stopped", agent: MAYA });

      const result = await tool.call({ agent: "Maya" }, CHAT);

      expect(stop).toHaveBeenCalledWith(CHAT, "Maya");
      expect(result).toEqual({
        text: "Stopped Maya. Maya's changes stay. End your turn now; Maya's report comes next, and then you tell the user how far Maya got and what changed.",
        isError: false,
      });
    });

    it(`says there is nothing to stop when the agent isn't working, and that it isn't working when no run from this chat is known, as after a reload, and fails the call so the chat doesn't show it as stopped (${CONTROL})`, async () => {
      await expect(
        buildStop({ kind: "not_working", agent: MAYA }).tool.call({ agent: "Maya" }, CHAT)
      ).resolves.toEqual({
        text: "Maya isn't working on anything from this chat, so there is nothing to stop.",
        isError: true,
      });
      await expect(
        buildStop({ kind: "not_asked", agent: MAYA }).tool.call({ agent: "Maya" }, CHAT)
      ).resolves.toEqual({
        text: "Maya isn't working on anything from this chat now.",
        isError: true,
      });
    });

    it(`turns down a call from a chat no list shows, such as an asked agent's own chat (${CONTROL})`, async () => {
      const { tool } = buildStop({ kind: "not_from_here" });

      await expect(tool.call({ agent: "Maya" }, CHAT)).resolves.toEqual({
        text: "You can't ask another agent from this chat. Don't call stop_agent again.",
        isError: true,
      });
    });

    it("rejects a call without an agent", async () => {
      const { tool, stop } = buildStop({ kind: "stopped", agent: MAYA });

      await expect(tool.call({ agent: " " }, CHAT)).resolves.toEqual({
        text: "agent must be a non-empty string.",
        isError: true,
      });
      expect(stop).not.toHaveBeenCalled();
    });
  });

  describe("relistOnCustomAgentsGateChange()", () => {
    it(`asks agents to list the tools again each time custom agents turn available or unavailable, and not on other settings changes, so a license entered while OpenCode runs offers the asking tools (${ISSUE})`, async () => {
      await setCustomAgentsAccess("free");
      const relist = jest.fn();
      const stop = relistOnCustomAgentsGateChange(relist);

      setSettings({ userId: "user-2" });
      expect(relist).not.toHaveBeenCalled();
      await setCustomAgentsAccess("team");
      expect(relist).toHaveBeenCalledTimes(1);
      await setCustomAgentsAccess("free");
      expect(relist).toHaveBeenCalledTimes(2);

      stop();
      await setCustomAgentsAccess("team");
      expect(relist).toHaveBeenCalledTimes(2);
    });
  });
});
