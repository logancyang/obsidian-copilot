import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import {
  ANSWER_AGENT_TOOL_NAME,
  CHECK_AGENT_TOOL_NAME,
  STOP_AGENT_TOOL_NAME,
} from "@/agents/agentMode/agentToolCalls";
import { promptHintsFor } from "@/agentMode/session/copilotMcpServer";
import {
  ASK_USER_TOOL_NAME,
  createAnswerAgentTool,
  createAskUserTool,
  createAskAgentTool,
  createCheckAgentTool,
  createStopAgentTool,
  relistOnAgentsChange,
} from "@/agents/agentMode/askAgentTool";
import type {
  AnswerAgentResult,
  AskAgentResult,
  CheckAgentResult,
  HiddenAgentChats,
  StopAgentResult,
} from "@/agents/agentMode/hiddenAgentChats";
import {
  CHAT_LISTINGS,
  listingCases,
  toolHost,
  type AgentSet,
  type ChatKind,
} from "@/agents/agentMode/testing/toolListings";
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
const SCOPE_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/987";
const DEFINITION_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/999";
const DEFINITION = "An AI teammate is an AI assistant the user made in Copilot, not a person.";
const ASKING_TOOLS_LISTED_FOR: Record<ChatKind, AgentSet[]> = {
  "a Copilot chat": ["only Coco", "Coco and Maya", "Coco, Maya and Leo"],
  "Coco's own chat": ["Coco and Maya", "Coco, Maya and Leo"],
  "the chat Coco runs when asked": [],
  "OpenCode's shared folder listing": ["only Coco", "Coco and Maya", "Coco, Maya and Leo"],
};
const CONTROL_HINT =
  "When the user asks how an AI teammate you asked is doing, check with check_teammate; when the user answers its question, pass the answer with answer_teammate; when the user gives it a new instruction while it works, send that with ask_teammate; when the user tells you to stop it, use stop_teammate. All are in obsidian-copilot.";

function buildTool(options: { unlisted?: string[]; asked?: AskAgentResult } = {}) {
  const ask = jest.fn(() => options.asked ?? { kind: "asked" as const, agent: MAYA });
  const tool = createAskAgentTool({ ask } as unknown as HiddenAgentChats, {
    isUnlistedChat: (key) => options.unlisted?.includes(key) ?? false,
    agents: () => [MAYA, LEO],
  });
  return { tool, ask };
}

const HOST = {
  isUnlistedChat: (key: string) => key.startsWith("hidden"),
  agents: () => [MAYA, LEO],
};

function descriptionFor(
  tool: ReturnType<typeof buildTool>["tool"],
  sessionKey: string
): string | null {
  const listed = tool.listedAs?.({ sessionKey, backendId: "claude", agentSlug: "coco" });
  return listed ? (listed as unknown as { description: string }).description : null;
}

describe("askAgentTool", () => {
  beforeEach(() => setCustomAgentsAccess("team"));

  describe("createAskAgentTool()", () => {
    it(`gives a model that can't see tool descriptions the sentence naming ask_teammate and when to call it (${HINTS_ISSUE})`, () => {
      expect(
        promptHintsFor([buildTool().tool], () => true, CHAT_LISTINGS["Coco's own chat"])
      ).toEqual([
        "When the user's message @-mentions one of the user's AI teammates by name or clearly points to one, ask that AI teammate with the ask_teammate tool from obsidian-copilot; never otherwise.",
      ]);
    });

    it(`opens its description and its hint with what an AI teammate is in a listing that can reach a Copilot chat: a Copilot chat's own, and OpenCode's shared folder listing, which a teammate's own chat in the folder reads too; not in a teammate's own listing, since its prompt says it (${DEFINITION_ISSUE})`, () => {
      const tool = createAskAgentTool({} as HiddenAgentChats, toolHost("Coco and Maya"));
      const listedFor = (chat: ChatKind) => ({
        description: (tool.listedAs?.(CHAT_LISTINGS[chat]) as unknown as { description: string })
          .description,
        hint: promptHintsFor([tool], () => true, CHAT_LISTINGS[chat])[0],
      });
      const own = listedFor("Coco's own chat");

      expect(listedFor("a Copilot chat")).toEqual({
        description: `${DEFINITION} ${own.description}`,
        hint: `${DEFINITION} ${own.hint}`,
      });
      expect(own.description).toMatch(/^Ask another AI teammate only when/);
      expect(own.hint).toMatch(
        /^When the user's message @-mentions one of the user's AI teammates/
      );
      expect(listedFor("OpenCode's shared folder listing")).toEqual(listedFor("a Copilot chat"));
    });

    it(`lists one definition naming no agent for every chat the user sees, so an agent created, renamed or deleted after an agent listed its tools is asked by its current name (${ISSUE})`, () => {
      const { tool } = buildTool();

      const listed = Object.values(CHAT_LISTINGS).map((listing) =>
        JSON.stringify(tool.listedAs?.(listing) ?? null)
      );

      expect(tool.listedAs?.(CHAT_LISTINGS["Coco's own chat"])).toBe(tool.definition);
      expect(listed.filter((text) => /Maya|Leo|you can ask:/.test(text))).toEqual([]);
    });

    it(`says when to call it in the opening that OpenCode's catalog shows, then to answer in one line and end the turn (${ISSUE})`, () => {
      const description = descriptionFor(buildTool().tool, "chat-1")!;

      expect(description.slice(0, 120)).toContain(
        "only when the user's message @-mentions it by name or clearly points to it"
      );
      expect(description).toContain(
        "tell the user in one short line who you asked and that you'll bring back the reply, and end your turn"
      );
      expect(description).toContain(RELAY_PRINCIPLE);
    });

    it(`tells it, right after when to call it, to call with the name or job the user gave when they name an agent without an @ or only describe its job, since a Copilot chat has no list of the agents, and doesn't say the agents aren't listed, since an agent's own chat lists them (${SCOPE_ISSUE})`, () => {
      const description = descriptionFor(buildTool().tool, "chat-1")!;

      expect(description).toContain(
        "Never call it otherwise, and never for yourself.\n\nWhen the user names an AI teammate without an @, or only describes its job, call this with the name or job they gave: a name no AI teammate has answers with the AI teammates you can ask.\n\nThe AI teammate works in the background,"
      );
      expect(description).not.toContain("aren't listed");
    });

    it.each(listingCases(ASKING_TOOLS_LISTED_FOR))(
      `$label: it is offered only while there is another agent to ask, and never in an asked agent's chat (${SCOPE_ISSUE})`,
      ({ chat, agents, listed }) => {
        const tool = createAskAgentTool({} as HiddenAgentChats, toolHost(agents));

        expect(tool.listedAs?.(CHAT_LISTINGS[chat])?.name ?? null).toBe(
          listed ? ASK_AGENT_TOOL_NAME : null
        );
      }
    );

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

      const result = await tool.call({ teammate: "Maya", message: "Review the plan." }, CHAT);

      expect(ask).toHaveBeenCalledWith(CHAT, "Maya", "Review the plan.");
      expect(result).toEqual({
        text: "Maya is working on it in the background. Tell the user in one short line that you asked Maya and will bring back the reply, then end your turn.",
        isError: false,
      });
    });

    it(`names the agents to ask, each with its title, when the name matches none, without failing the call, so the chat draws no failed step and the model isn't told a Copilot tool broke (${SCOPE_ISSUE})`, async () => {
      const { tool } = buildTool({ asked: { kind: "unknown_agent", roster: [MAYA, LEO] } });

      await expect(tool.call({ teammate: "Nora", message: "Hi" }, CHAT)).resolves.toEqual({
        text: "No AI teammate has that name. AI teammates you can ask: Maya (Product critic); Leo.",
        isError: false,
      });
    });

    it(`tells a chat with no other agent that there is no one to ask, without failing the call, as when OpenCode's shared listing offers the tool to the only agent's own chat (${SCOPE_ISSUE})`, async () => {
      const { tool } = buildTool({ asked: { kind: "unknown_agent", roster: [] } });

      await expect(tool.call({ teammate: "Maya", message: "Hi" }, CHAT)).resolves.toEqual({
        text: "There are no other AI teammates to ask.",
        isError: false,
      });
    });

    it(`tells an agent that asked itself to answer directly (${ISSUE})`, async () => {
      const { tool } = buildTool({ asked: { kind: "self", agent: MAYA } });

      await expect(tool.call({ teammate: "Maya", message: "Hi" }, CHAT)).resolves.toEqual({
        text: "You are Maya; you can't ask yourself. Answer the user directly.",
        isError: true,
      });
    });

    it(`tells the agent its message reached the working agent in the same chat, now or after its current step, as a call that succeeded (${CONTROL})`, async () => {
      const now = await buildTool({ asked: { kind: "sent", agent: MAYA, now: true } }).tool.call(
        { teammate: "Maya", message: "Skip the outro." },
        CHAT
      );
      const later = await buildTool({ asked: { kind: "sent", agent: MAYA, now: false } }).tool.call(
        { teammate: "Maya", message: "Skip the outro." },
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

    it(`fails a call for an agent waiting on the user's answer, quoting the question and saying to ask the user, end the turn and pass the user's reply, even a change of plan, with answer_teammate (${CONTROL})`, async () => {
      const { tool } = buildTool({
        asked: { kind: "awaiting_answer", agent: LEO, question: "Which month?" },
      });

      await expect(
        tool.call({ teammate: "Leo", message: "Which month should I use?" }, CHAT)
      ).resolves.toEqual({
        text: "Nothing was sent: Leo is waiting for the user's answer to this question:\nWhich month?\n\nAsk the user this question in your own words if you haven't yet, then end your turn. When the user replies to it, even with a change of plan, pass their words to Leo with answer_teammate.",
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

      await expect(
        tool.call({ teammate: "Leo", message: "Check the books." }, CHAT)
      ).resolves.toEqual({
        text: "Nothing was sent: Leo runs on OpenCode, which isn't set up on this device. Tell the user, and that they can pick another model in Leo's profile.",
        isError: true,
      });
    });

    it("rejects a call without an agent or a message", async () => {
      const { tool, ask } = buildTool();

      await expect(tool.call({ teammate: "Maya", message: " " }, CHAT)).resolves.toEqual({
        text: "teammate and message must be non-empty strings.",
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

    it(`gives a model that can't see tool descriptions the one sentence naming check_teammate, answer_teammate and stop_teammate (${HINTS_ISSUE})`, () => {
      expect(buildAnswer({ kind: "answered", agent: MAYA }).tool.promptHint).toBe(CONTROL_HINT);
    });

    it.each(listingCases(ASKING_TOOLS_LISTED_FOR))(
      `$label, as ask_teammate is (${SCOPE_ISSUE})`,
      ({ chat, agents, listed }) => {
        const tool = createAnswerAgentTool({} as HiddenAgentChats, toolHost(agents));

        expect(tool.listedAs?.(CHAT_LISTINGS[chat])?.name ?? null).toBe(
          listed ? ANSWER_AGENT_TOOL_NAME : null
        );
      }
    );

    it(`passes the user's answer to the named agent for the calling chat and tells the agent to say so in one line (${CONTROL})`, async () => {
      const { tool, answer } = buildAnswer({ kind: "answered", agent: MAYA });

      const result = await tool.call({ teammate: "Maya", answer: "October." }, CHAT);

      expect(answer).toHaveBeenCalledWith(CHAT, "Maya", "October.");
      expect(result).toEqual({
        text: "Passed the answer to Maya, who carries on. Tell the user in one short line, then end your turn.",
        isError: false,
      });
    });

    it(`answers a name no agent has with who can be asked, without failing the call (${SCOPE_ISSUE})`, async () => {
      await expect(
        buildAnswer({ kind: "unknown_agent", roster: [MAYA] }).tool.call(
          { teammate: "Nora", answer: "October." },
          CHAT
        )
      ).resolves.toEqual({
        text: "No AI teammate has that name. AI teammates you can ask: Maya (Product critic).",
        isError: false,
      });
    });

    it(`marks the call failed when no answer was passed, saying the agent has no question waiting and pointing to ask_teammate, since the chat would otherwise draw "Passed your answer" (${CONTROL}, ${SCOPE_ISSUE})`, async () => {
      const { tool } = buildAnswer({ kind: "no_question", agent: MAYA });

      await expect(tool.call({ teammate: "Maya", answer: "October." }, CHAT)).resolves.toEqual({
        text: "Maya has no question waiting. To send Maya a new instruction, use ask_teammate.",
        isError: true,
      });
      await expect(
        buildAnswer({ kind: "not_from_here" }).tool.call(
          { teammate: "Maya", answer: "October." },
          CHAT
        )
      ).resolves.toEqual(expect.objectContaining({ isError: true }));
    });

    it("rejects a call without an answer", async () => {
      const { tool, answer } = buildAnswer({ kind: "answered", agent: MAYA });

      await expect(tool.call({ teammate: "Maya", answer: " " }, CHAT)).resolves.toEqual({
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

    it.each(
      listingCases({
        "a Copilot chat": [],
        "Coco's own chat": [],
        "the chat Coco runs when asked": [
          "no agent",
          "only Coco",
          "Coco and Maya",
          "Coco, Maya and Leo",
        ],
        "OpenCode's shared folder listing": ["only Coco", "Coco and Maya", "Coco, Maya and Leo"],
      })
    )(
      `$label: it is offered only in an asked agent's chat, or in a folder's shared listing that can reach one while any agent exists (${SCOPE_ISSUE})`,
      ({ chat, agents, listed }) => {
        const tool = createAskUserTool({} as HiddenAgentChats, toolHost(agents));

        expect(tool.listedAs?.(CHAT_LISTINGS[chat])?.name ?? null).toBe(
          listed ? ASK_USER_TOOL_NAME : null
        );
      }
    );

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

    it(`tells a chat the user sees, which OpenCode's shared listing reaches, to ask the user directly, without failing the call (${SCOPE_ISSUE})`, async () => {
      await expect(
        buildAskUser("not_from_here").tool.call({ question: "October?" }, CHAT)
      ).resolves.toEqual({
        text: "Only an AI teammate asked into another AI teammate's or Copilot's chat can use ask_user. Ask the user directly in your reply.",
        isError: false,
      });
    });
  });

  describe("createCheckAgentTool()", () => {
    function buildCheck(result: CheckAgentResult) {
      const check = jest.fn(() => result);
      return { tool: createCheckAgentTool({ check } as unknown as HiddenAgentChats, HOST), check };
    }

    it(`gives a model that can't see tool descriptions the one sentence naming check_teammate, answer_teammate and stop_teammate (${HINTS_ISSUE})`, () => {
      expect(buildCheck({ kind: "not_asked", agent: MAYA }).tool.promptHint).toBe(CONTROL_HINT);
    });

    it(`says in its opening to call it each time the user asks how an agent is doing (${CONTROL})`, () => {
      const { tool } = buildCheck({ kind: "not_asked", agent: MAYA });

      const listed = tool.listedAs?.({ sessionKey: "chat-1", backendId: "claude" });

      expect((listed as unknown as { description: string }).description.slice(0, 120)).toContain(
        "call it each time the user asks how an AI teammate"
      );
    });

    it.each(listingCases(ASKING_TOOLS_LISTED_FOR))(
      `$label, as ask_teammate is (${SCOPE_ISSUE})`,
      ({ chat, agents, listed }) => {
        const tool = createCheckAgentTool({} as HiddenAgentChats, toolHost(agents));

        expect(tool.listedAs?.(CHAT_LISTINGS[chat])?.name ?? null).toBe(
          listed ? CHECK_AGENT_TOOL_NAME : null
        );
      }
    );

    it(`returns the agent's progress for the calling chat to retell in the agent's own words (${CONTROL})`, async () => {
      const { tool, check } = buildCheck({
        kind: "progress",
        agent: MAYA,
        progress: "Maya has been working for 3 min.",
      });

      const result = await tool.call({ teammate: "Maya" }, CHAT);

      expect(check).toHaveBeenCalledWith(CHAT, "Maya");
      expect(result).toEqual({
        text: "Maya has been working for 3 min.\n\nTell the user in your own words how far Maya got. Don't paste this.",
        isError: false,
      });
    });

    it(`says the agent isn't working and how to send it back when no run from this chat is known, as after a reload, without failing the call, since the check was made (${SCOPE_ISSUE})`, async () => {
      await expect(
        buildCheck({ kind: "not_asked", agent: MAYA }).tool.call({ teammate: "Maya" }, CHAT)
      ).resolves.toEqual({
        text: "Maya isn't working on anything from this chat now. To send Maya back to it, use ask_teammate.",
        isError: false,
      });
    });

    it(`answers a name no agent has with who can be asked, without failing the call (${SCOPE_ISSUE})`, async () => {
      await expect(
        buildCheck({ kind: "unknown_agent", roster: [] }).tool.call({ teammate: "Nora" }, CHAT)
      ).resolves.toEqual({ text: "There are no other AI teammates to ask.", isError: false });
    });

    it(`turns down a call from an asked agent's own chat, failing it so the chat doesn't show a check (${CONTROL})`, async () => {
      await expect(
        buildCheck({ kind: "not_from_here" }).tool.call({ teammate: "Maya" }, CHAT)
      ).resolves.toEqual({
        text: "You can't ask another AI teammate from this chat. Don't call check_teammate again.",
        isError: true,
      });
    });
  });

  describe("createStopAgentTool()", () => {
    function buildStop(result: StopAgentResult) {
      const stop = jest.fn(() => result);
      return { tool: createStopAgentTool({ stop } as unknown as HiddenAgentChats, HOST), stop };
    }

    it(`gives a model that can't see tool descriptions the one sentence naming check_teammate, answer_teammate and stop_teammate (${HINTS_ISSUE})`, () => {
      expect(buildStop({ kind: "not_asked", agent: MAYA }).tool.promptHint).toBe(CONTROL_HINT);
    });

    it.each(listingCases(ASKING_TOOLS_LISTED_FOR))(
      `$label, as ask_teammate is (${SCOPE_ISSUE})`,
      ({ chat, agents, listed }) => {
        const tool = createStopAgentTool({} as HiddenAgentChats, toolHost(agents));

        expect(tool.listedAs?.(CHAT_LISTINGS[chat])?.name ?? null).toBe(
          listed ? STOP_AGENT_TOOL_NAME : null
        );
      }
    );

    it(`stops the named agent for the calling chat and tells the agent to end its turn until the report comes back (${CONTROL})`, async () => {
      const { tool, stop } = buildStop({ kind: "stopped", agent: MAYA });

      const result = await tool.call({ teammate: "Maya" }, CHAT);

      expect(stop).toHaveBeenCalledWith(CHAT, "Maya");
      expect(result).toEqual({
        text: "Stopped Maya. Maya's changes stay. End your turn now; Maya's report comes next, and then you tell the user how far Maya got and what changed.",
        isError: false,
      });
    });

    it(`answers a name no agent has with who can be asked, without failing the call (${SCOPE_ISSUE})`, async () => {
      await expect(
        buildStop({ kind: "unknown_agent", roster: [LEO] }).tool.call({ teammate: "Nora" }, CHAT)
      ).resolves.toEqual({
        text: "No AI teammate has that name. AI teammates you can ask: Leo.",
        isError: false,
      });
    });

    it(`says there is nothing to stop when the agent isn't working, and that it isn't working when no run from this chat is known, as after a reload, and fails the call so the chat doesn't show it as stopped (${CONTROL}, ${SCOPE_ISSUE})`, async () => {
      await expect(
        buildStop({ kind: "not_working", agent: MAYA }).tool.call({ teammate: "Maya" }, CHAT)
      ).resolves.toEqual({
        text: "Maya isn't working on anything from this chat, so there is nothing to stop.",
        isError: true,
      });
      await expect(
        buildStop({ kind: "not_asked", agent: MAYA }).tool.call({ teammate: "Maya" }, CHAT)
      ).resolves.toEqual({
        text: "Maya isn't working on anything from this chat now.",
        isError: true,
      });
    });

    it(`turns down a call from a chat no list shows, such as an asked agent's own chat (${CONTROL})`, async () => {
      const { tool } = buildStop({ kind: "not_from_here" });

      await expect(tool.call({ teammate: "Maya" }, CHAT)).resolves.toEqual({
        text: "You can't ask another AI teammate from this chat. Don't call stop_teammate again.",
        isError: true,
      });
    });

    it("rejects a call without an agent", async () => {
      const { tool, stop } = buildStop({ kind: "stopped", agent: MAYA });

      await expect(tool.call({ teammate: " " }, CHAT)).resolves.toEqual({
        text: "teammate must be a non-empty string.",
        isError: true,
      });
      expect(stop).not.toHaveBeenCalled();
    });
  });

  describe("relistOnAgentsChange()", () => {
    function fakeStore(initial: readonly CustomAgent[]) {
      let agents = initial;
      const listeners = new Set<() => void>();
      return {
        getAgents: () => agents,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        publish: (next: readonly CustomAgent[]) => {
          agents = next;
          listeners.forEach((listener) => listener());
        },
      };
    }

    it(`asks agents to list the tools again each time custom agents turn available or unavailable, and not on other settings changes, so a license entered while OpenCode runs offers the asking tools (${ISSUE})`, async () => {
      await setCustomAgentsAccess("free");
      const relist = jest.fn();
      const stop = relistOnAgentsChange(fakeStore([]), relist);

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

    it(`asks agents to list the tools again when an agent is created or deleted, as the first is created or the last deleted, and not when an agent's details change, so chats already open gain or lose the asking tools (${SCOPE_ISSUE})`, () => {
      const store = fakeStore([]);
      const relist = jest.fn();
      const stop = relistOnAgentsChange(store, relist);

      store.publish([MAYA]);
      expect(relist).toHaveBeenCalledTimes(1);
      store.publish([{ ...MAYA, title: "Product reviewer" }]);
      expect(relist).toHaveBeenCalledTimes(1);
      store.publish([MAYA, LEO]);
      expect(relist).toHaveBeenCalledTimes(2);
      store.publish([LEO]);
      expect(relist).toHaveBeenCalledTimes(3);
      store.publish([]);
      expect(relist).toHaveBeenCalledTimes(4);

      stop();
      store.publish([MAYA]);
      expect(relist).toHaveBeenCalledTimes(4);
    });
  });
});
