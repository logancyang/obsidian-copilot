import { fakeChat, fakeChatView } from "@/agentMode/session/testing/fakeChat";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { AGENT_DRAFT_CARD } from "@/agents/agentMode/agentDraftCard";
import { createDraftAgentTool, DRAFT_AGENT_TOOL_NAME } from "@/agents/agentMode/draftAgentTool";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { USER_SENDER } from "@/constants";
import { resetSettings } from "@/settings/model";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/941";
const NORA = { name: "Nora", title: "Family logistics", instruction: "You plan pickups." };

function buildTool(
  options: { unlisted?: string[]; copilotChats?: string[]; callerAgent?: string | null } = {}
) {
  return createDraftAgentTool({
    isUnlistedChat: (key) => options.unlisted?.includes(key) ?? false,
    isCopilotChat: (key) => options.copilotChats?.includes(key) ?? false,
    agentOfCaller: (chat) =>
      chat && options.callerAgent !== null ? (options.callerAgent ?? "coco") : null,
  });
}

function cocoChat() {
  return fakeChat(
    fakeChatView([
      { id: "u1", sender: USER_SENDER, message: "hi", timestamp: null, isVisible: true },
    ])
  );
}

describe("draftAgentTool", () => {
  beforeEach(async () => {
    resetSettings();
    await setCustomAgentsAccess("team");
  });

  describe("createDraftAgentTool()", () => {
    describe("listedAs()", () => {
      it(`lists the tool for a custom agent's chat, saying in its opening when to call it and that the user creates the agent (${ISSUE})`, () => {
        const listed = buildTool().listedAs?.({ sessionKey: "coco-chat", backendId: "claude" });

        expect(listed?.name).toBe(DRAFT_AGENT_TOOL_NAME);
        const description = (listed as unknown as { description: string }).description;
        expect(description.slice(0, 120)).toContain("draft of a new custom agent when they ask");
        expect(description).toContain("you can't create an agent yourself, even if asked");
        expect(description).toContain(
          "if you or one of them already handles the job, say so and ask whether they want a new one anyway"
        );
        expect(description).toContain("Each call replaces the card shown earlier in this chat");
      });

      it(`lists the tool for OpenCode's shared folder listing, which can't tell the chat (${ISSUE})`, () => {
        expect(
          buildTool().listedAs?.({ sessionKey: "opencode:/vault", backendId: "opencode" })
        ).not.toBeNull();
      });

      it(`leaves the tool out of a Copilot chat without an agent (${ISSUE})`, () => {
        const tool = buildTool({ copilotChats: ["copilot-chat"] });

        expect(tool.listedAs?.({ sessionKey: "copilot-chat", backendId: "claude" })).toBeNull();
      });

      it(`leaves the tool out of an asked agent's hidden chat (${ISSUE})`, () => {
        const tool = buildTool({ unlisted: ["hidden-1"] });

        expect(tool.listedAs?.({ sessionKey: "hidden-1", backendId: "codex" })).toBeNull();
      });

      it.each(["free", "plus-without-custom-agents"] as const)(
        `leaves the tool out while custom agents aren't available (%s) (${ISSUE})`,
        async (access) => {
          await setCustomAgentsAccess(access);

          expect(
            buildTool().listedAs?.({ sessionKey: "coco-chat", backendId: "claude" })
          ).toBeNull();
        }
      );
    });

    describe("call()", () => {
      it(`shows the draft as a card in the calling chat and tells the agent nothing is created until the user presses Create (${ISSUE})`, async () => {
        const chat = cocoChat();

        const result = await buildTool().call(NORA, chat);

        expect(result).toEqual({
          text: "Shown to the user as a card below your reply, replacing any earlier draft in this chat. Nothing is created until they review it and press Create.",
          isError: false,
        });
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toEqual({
          draft: NORA,
          draftedBy: "coco",
          afterUserTurn: 1,
        });
      });

      it(`writes nothing to the agents folder, even when the agent was asked to just create it (${ISSUE})`, async () => {
        const vault = createFakeAgentVault();
        vault.writeByHand(
          "copilot/agents/coco/instructions.md",
          "---\nname: Coco\n---\nKeep the vault."
        );
        const store = new CustomAgentStore(vault.app);
        await store.start();
        const before = { paths: vault.listPaths(), touched: [...vault.touchedPaths] };

        await buildTool().call({ ...NORA, instruction: "Just create it." }, cocoChat());

        expect(vault.listPaths()).toEqual(before.paths);
        expect(vault.touchedPaths).toEqual(before.touched);
        expect(store.getAgents().map((agent) => agent.name)).toEqual(["Coco"]);
        store.stop();
      });

      it(`refuses a draft without a name as an error the agent can fix, showing nothing (${ISSUE})`, async () => {
        const chat = cocoChat();

        const result = await buildTool().call({ title: "x", instruction: "y" }, chat);

        expect(result).toEqual({
          text: "name must be a non-empty string, and title and instruction must be strings.",
          isError: true,
        });
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toBeNull();
      });

      it(`refuses a call from a chat that isn't a custom agent's chat the user sees, as from a hidden chat on OpenCode, and shows nothing (${ISSUE})`, async () => {
        const chat = cocoChat();

        const fromHidden = await buildTool().call(NORA, null);
        const fromCopilot = await buildTool({ callerAgent: null }).call(NORA, chat);

        const refused = {
          text: `Only a custom agent can draft an agent, in its own chat. Don't call ${DRAFT_AGENT_TOOL_NAME} again.`,
          isError: false,
        };
        expect(fromHidden).toEqual(refused);
        expect(fromCopilot).toEqual(refused);
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toBeNull();
      });

      it(`refuses while custom agents aren't available and shows nothing (${ISSUE})`, async () => {
        await setCustomAgentsAccess("free");
        const chat: ChatStateHost = cocoChat();

        const result = await buildTool().call(NORA, chat);

        expect(result).toEqual({
          text: "Custom agents aren't available right now. Tell the user.",
          isError: false,
        });
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toBeNull();
      });
    });
  });
});
