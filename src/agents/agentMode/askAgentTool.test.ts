import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { ASK_AGENT_TOOL_NAME, createAskAgentTool } from "@/agents/agentMode/askAgentTool";
import type { AskAgentResult, HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/944";
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
        isError: false,
      });
    });

    it(`tells the agent to wait for the earlier reply when the agent is still working (${ISSUE})`, async () => {
      const { tool } = buildTool({ asked: { kind: "busy", agent: MAYA } });

      const { text } = await tool.call({ agent: "Maya", message: "Hi" }, CHAT);

      expect(text).toContain("Maya is still working on the earlier request from this chat.");
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
});
