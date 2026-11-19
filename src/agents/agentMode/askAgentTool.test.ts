import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import {
  ASK_AGENT_TOOL_NAME,
  createAskAgentTool,
  CHECK_AGENT_TOOL_NAME,
  createCheckAgentTool,
  createStopAgentTool,
  STOP_AGENT_TOOL_NAME,
} from "@/agents/agentMode/askAgentTool";
import type {
  AskAgentResult,
  CheckAgentResult,
  HiddenAgentChats,
  StopAgentResult,
} from "@/agents/agentMode/hiddenAgentChats";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/944";
const CONTROL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/945";
const COCO = { slug: "coco", name: "Coco", title: "Keeps the whole vault in view" } as CustomAgent;
const MAYA = { slug: "maya", name: "Maya", title: "Product critic" } as CustomAgent;
const LEO = { slug: "leo", name: "Leo", title: "" } as CustomAgent;
const CHAT = {} as ChatStateHost;

function buildTool(
  options: {
    agents?: readonly CustomAgent[];
    unlisted?: string[];
    agentOfChat?: Record<string, string>;
    asked?: AskAgentResult;
  } = {}
) {
  const ask = jest.fn(() => options.asked ?? { kind: "asked" as const, agent: MAYA });
  const tool = createAskAgentTool({ ask } as unknown as HiddenAgentChats, {
    agents: () => options.agents ?? [COCO, MAYA, LEO],
    isUnlistedChat: (key) => options.unlisted?.includes(key) ?? false,
    agentOfChat: (key) => options.agentOfChat?.[key] ?? null,
  });
  return { tool, ask };
}

const HOST = {
  agents: () => [COCO, MAYA, LEO],
  isUnlistedChat: (key: string) => key.startsWith("hidden"),
  agentOfChat: () => null,
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
    it(`lists the tool for an agent's chat with every other agent by name and title, leaving the chat's own agent out (${ISSUE})`, () => {
      const { tool } = buildTool({ agentOfChat: { "chat-1": "coco" } });

      const description = descriptionFor(tool, "chat-1");

      expect(description).toContain("- Maya (Product critic)\n- Leo");
      expect(description).not.toContain("- Coco");
    });

    it(`lists the tool for a Copilot chat with every agent (${ISSUE})`, () => {
      const { tool } = buildTool();

      expect(descriptionFor(tool, "chat-1")).toContain(
        "- Coco (Keeps the whole vault in view)\n- Maya (Product critic)\n- Leo"
      );
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
      expect(description).toContain("can't save rules to its memory or change its instruction");
    });

    it(`leaves the tool out of an asked agent's own chat (${ISSUE})`, () => {
      const { tool } = buildTool({ unlisted: ["hidden-1"] });

      expect(tool.listedAs?.({ sessionKey: "hidden-1", backendId: "claude" })).toBeNull();
    });

    it(`leaves the tool out when there is no other agent to ask (${ISSUE})`, () => {
      expect(
        buildTool({ agents: [] }).tool.listedAs?.({ sessionKey: "c", backendId: "x" })
      ).toBeNull();
      expect(
        buildTool({ agents: [COCO], agentOfChat: { c: "coco" } }).tool.listedAs?.({
          sessionKey: "c",
          backendId: "x",
        })
      ).toBeNull();
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

    it("names the agents to ask when the name matches none", async () => {
      const { tool } = buildTool({ asked: { kind: "unknown_agent", roster: [MAYA, LEO] } });

      await expect(tool.call({ agent: "Nora", message: "Hi" }, CHAT)).resolves.toEqual({
        text: "No custom agent has that name. Agents you can ask: Maya, Leo.",
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

  describe("createCheckAgentTool()", () => {
    function buildCheck(result: CheckAgentResult) {
      const check = jest.fn(() => result);
      return { tool: createCheckAgentTool({ check } as unknown as HiddenAgentChats, HOST), check };
    }

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
});
