import { promptHintsFor } from "@/agentMode/session/copilotMcpServer";
import { fakeChat, fakeChatView } from "@/agentMode/session/testing/fakeChat";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { AGENT_DRAFT_CARD } from "@/agents/agentMode/agentDraftCard";
import { createDraftAgentTool, DRAFT_AGENT_TOOL_NAME } from "@/agents/agentMode/draftAgentTool";
import {
  CHAT_LISTINGS,
  listingCases,
  toolHost,
  type AgentSet,
  type ChatKind,
} from "@/agents/agentMode/testing/toolListings";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { USER_SENDER } from "@/constants";
import { resetSettings } from "@/settings/model";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/941";
const SCOPE_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/987";
const DEFINITION_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/999";
const DEFINITION = "An AI teammate is an AI assistant the user made in Copilot, not a person.";
const NORA = { name: "Nora", title: "Family logistics", instruction: "You plan pickups." };

function buildTool(
  options: { unlisted?: string[]; callerAgent?: string | null; callerSeen?: boolean } = {}
) {
  return createDraftAgentTool({
    isUnlistedChat: (key) => options.unlisted?.includes(key) ?? false,
    agents: () => [],
    callerOf: (chat) =>
      chat && options.callerSeen !== false
        ? { agent: options.callerAgent === undefined ? "coco" : options.callerAgent }
        : null,
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
    describe("promptHint", () => {
      it("gives a model that can't see tool descriptions the sentences naming draft_teammate, when to call it and that it can't create an agent (https://github.com/Brevilabs/obsidian-copilot-private/issues/986)", () => {
        expect(promptHintsFor([buildTool()], () => true, CHAT_LISTINGS["Coco's own chat"])).toEqual(
          [
            "When the user asks you to make a new AI teammate, draft it with the draft_teammate tool from obsidian-copilot, which shows them a card to review and create it. If you or an AI teammate already handles that job, say so and ask before drafting. You can't create an AI teammate yourself.",
          ]
        );
      });
    });

    describe("listedAs()", () => {
      it.each([
        ["a Copilot chat", "no agent", true],
        ["a Copilot chat", "only Coco", false],
        ["Coco's own chat", "only Coco", false],
        ["OpenCode's shared folder listing", "no agent", true],
        ["OpenCode's shared folder listing", "only Coco", false],
      ] as const)(
        `in %s when the agents are %s, opens its description and hint with what an AI teammate is: %s, since a listing that can reach a Copilot chat needs it and ask_teammate carries it whenever offered (${DEFINITION_ISSUE})`,
        (chat: ChatKind, agents: AgentSet, defines: boolean) => {
          const tool = createDraftAgentTool({ ...toolHost(agents), callerOf: () => null });
          const listed = tool.listedAs?.(CHAT_LISTINGS[chat]) as unknown as { description: string };
          const [hint] = promptHintsFor([tool], () => true, CHAT_LISTINGS[chat]);

          expect([listed.description.startsWith(DEFINITION), hint.startsWith(DEFINITION)]).toEqual([
            defines,
            defines,
          ]);
          expect(listed.description.replace(`${DEFINITION} `, "")).toMatch(
            /^Show the user a draft of a new AI teammate/
          );
        }
      );

      it(`lists the tool for a custom agent's chat, saying in its opening when to call it and that the user creates the agent (${ISSUE})`, () => {
        const listed = buildTool().listedAs?.({
          sessionKey: "coco-chat",
          backendId: "claude",
          agentSlug: "coco",
        });

        expect(listed?.name).toBe(DRAFT_AGENT_TOOL_NAME);
        const description = (listed as unknown as { description: string }).description;
        expect(description.slice(0, 120)).toContain("draft of a new AI teammate when they ask");
        expect(description).toContain("you can't create an AI teammate yourself, even if asked");
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

      it(`lists the tool for a Copilot chat without a custom agent too, so the user can ask Copilot for a new agent (${ISSUE})`, () => {
        expect(
          buildTool({ callerAgent: null }).listedAs?.({
            sessionKey: "copilot-chat",
            backendId: "codex",
          })?.name
        ).toBe(DRAFT_AGENT_TOOL_NAME);
      });

      it(`asks it to check the other agents listed for it only if any are, since a Copilot chat is given no list of agents (${SCOPE_ISSUE})`, () => {
        const listed = buildTool().listedAs?.({ sessionKey: "copilot-chat", backendId: "claude" });

        expect((listed as unknown as { description: string }).description).toContain(
          "Before the first draft, check the other AI teammates listed for you, if any: if you or one of them already handles the job,"
        );
      });

      it.each(
        listingCases({
          "a Copilot chat": ["no agent", "only Coco", "Coco and Maya", "Coco, Maya and Leo"],
          "Coco's own chat": ["no agent", "only Coco", "Coco and Maya", "Coco, Maya and Leo"],
          "the chat Coco runs when asked": [],
          "OpenCode's shared folder listing": [
            "no agent",
            "only Coco",
            "Coco and Maya",
            "Coco, Maya and Leo",
          ],
        })
      )(
        `$label: it stays in every chat the user sees, with or without agents, since asking for one is how a user gets a first agent (${SCOPE_ISSUE})`,
        ({ chat, agents, listed }) => {
          const tool = createDraftAgentTool({ ...toolHost(agents), callerOf: () => null });

          expect(tool.listedAs?.(CHAT_LISTINGS[chat])?.name ?? null).toBe(
            listed ? DRAFT_AGENT_TOOL_NAME : null
          );
        }
      );

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

      it(`shows a Copilot chat's draft as a card drafted by no agent (${ISSUE})`, async () => {
        const chat = cocoChat();

        const result = await buildTool({ callerAgent: null }).call(NORA, chat);

        expect(result.text).toContain("Shown to the user as a card below your reply");
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toEqual({
          draft: NORA,
          draftedBy: null,
          afterUserTurn: 1,
        });
      });

      it(`writes nothing to the agents folder, even when the agent was asked to just create it (${ISSUE})`, async () => {
        const vault = createFakeAgentVault();
        vault.writeByHand(
          "copilot/teammates/coco/instructions.md",
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

      it(`refuses a call from a chat the user doesn't see, as from a hidden chat on OpenCode, and shows nothing (${ISSUE})`, async () => {
        const chat = cocoChat();

        const unknown = await buildTool().call(NORA, null);
        const hidden = await buildTool({ callerSeen: false }).call(NORA, chat);

        const refused = {
          text: `Only a chat the user sees can draft an AI teammate. Don't call ${DRAFT_AGENT_TOOL_NAME} again.`,
          isError: false,
        };
        expect(unknown).toEqual(refused);
        expect(hidden).toEqual(refused);
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toBeNull();
      });

      it(`refuses while custom agents aren't available and shows nothing (${ISSUE})`, async () => {
        await setCustomAgentsAccess("free");
        const chat: ChatStateHost = cocoChat();

        const result = await buildTool().call(NORA, chat);

        expect(result).toEqual({
          text: "Copilot Teammates isn't available right now. Tell the user.",
          isError: false,
        });
        expect(chat.readChatState(AGENT_DRAFT_CARD)).toBeNull();
      });
    });
  });
});
