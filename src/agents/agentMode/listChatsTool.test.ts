import { fakeChat } from "@/agentMode/session/testing/fakeChat";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { createListChatsTool, LIST_CHATS_TOOL_NAME } from "@/agents/agentMode/listChatsTool";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { resetSettings } from "@/settings/model";
import { buildNativeChatId } from "@/utils/nativeChatId";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/959";
const VAULT = "/Users/me/Vault";
const SCOPE =
  "Every other chat note belongs to another agent or to Copilot: unless the user names it, never search, read or cite it.";

function chatItem(
  title: string,
  day: number,
  agent: string | undefined,
  id = `copilot/copilot-conversations/${title}.md`
): ChatHistoryItem {
  const at = new Date(2026, 10, day, 12);
  return { id, title, createdAt: at, lastAccessedAt: at, ...(agent ? { agent } : {}) };
}

const JUNO_CHATS = [
  chatItem("Release video plan", 11, "juno"),
  chatItem("Launch announcement draft", 15, "juno"),
  chatItem("Sync conflict crash triage", 13, "juno", buildNativeChatId("claude", "s-13")),
];
const OTHER_CHATS = [
  chatItem("Release video feedback", 10, "rex"),
  chatItem("Release video music", 9, undefined),
];

function buildTool(options: { caller?: string | null; history?: ChatHistoryItem[] } = {}) {
  return createListChatsTool({
    earlierChats: async (chat) =>
      chat && options.caller !== undefined
        ? { agent: options.caller, chats: options.history ?? [...JUNO_CHATS, ...OTHER_CHATS] }
        : null,
    vaultBase: () => VAULT,
  });
}

describe("listChatsTool", () => {
  beforeEach(async () => {
    resetSettings();
    await setCustomAgentsAccess("team");
  });

  describe("createListChatsTool()", () => {
    describe("listedAs()", () => {
      it(`lists the tool, saying in its opening when to call it (${ISSUE})`, () => {
        const listed = buildTool().listedAs?.({ sessionKey: "juno-chat", backendId: "claude" });

        expect(listed?.name).toBe(LIST_CHATS_TOOL_NAME);
        const description = (listed as unknown as { description: string }).description;
        expect(description.slice(0, 120)).toContain("when the user asks about earlier chats");
      });

      it.each(["free", "plus-without-custom-agents"] as const)(
        `leaves the tool out while custom agents aren't available (%s) (${ISSUE})`,
        async (access) => {
          await setCustomAgentsAccess(access);

          expect(
            buildTool().listedAs?.({ sessionKey: "juno-chat", backendId: "claude" })
          ).toBeNull();
        }
      );
    });

    describe("call()", () => {
      it(`lists only a custom agent's own chats, newest first, with each one's date, title and note path (${ISSUE})`, async () => {
        const result = await buildTool({ caller: "juno" }).call({}, fakeChat());

        expect(result).toEqual({
          text: [
            `Your earlier chats with the user, newest first. Open a listed note with your file or shell tools to see what was said. ${SCOPE}`,
            `- 2026-11-15 · Launch announcement draft · ${VAULT}/copilot/copilot-conversations/Launch announcement draft.md`,
            "- 2026-11-13 · Sync conflict crash triage · not saved as a note, so only its title and date are known",
            `- 2026-11-11 · Release video plan · ${VAULT}/copilot/copilot-conversations/Release video plan.md`,
          ].join("\n"),
          isError: false,
        });
      });

      it(`lists only the chats without a custom agent for a Copilot chat (${ISSUE})`, async () => {
        const result = await buildTool({ caller: null }).call({}, fakeChat());

        expect(result.text).toBe(
          [
            "Your earlier chats with the user, newest first. Open a listed note with your file or shell tools to see what was said. Every other chat note belongs to a custom agent: unless the user names it, never search, read or cite it.",
            `- 2026-11-09 · Release video music · ${VAULT}/copilot/copilot-conversations/Release video music.md`,
          ].join("\n")
        );
      });

      it(`lists at most the 20 newest chats, so a long history can't flood the agent's context (${ISSUE})`, async () => {
        const history = Array.from({ length: 25 }, (_, i) =>
          chatItem(`Chat ${i + 1}`, i + 1, "juno")
        );

        const { text } = await buildTool({ caller: "juno", history }).call({}, fakeChat());

        const lines = text.split("\n").slice(1);
        expect(lines).toHaveLength(20);
        expect(lines[0]).toContain("Chat 25");
        expect(lines[19]).toContain("Chat 6");
      });

      it(`leaves out a chat the user archived, as Recent chats does (${ISSUE})`, async () => {
        const archived = { ...chatItem("Old beta plan", 14, "juno"), archivedAt: Date.now() };

        const { text } = await buildTool({
          caller: "juno",
          history: [...JUNO_CHATS, archived],
        }).call({}, fakeChat());

        expect(text).toContain("Launch announcement draft");
        expect(text).not.toContain("Old beta plan");
      });

      it(`says there are none when the caller has no earlier chats, so it doesn't invent one (${ISSUE})`, async () => {
        const result = await buildTool({ caller: "juno", history: OTHER_CHATS }).call(
          {},
          fakeChat()
        );

        expect(result).toEqual({
          text: `You have no earlier chats with the user. ${SCOPE}`,
          isError: false,
        });
      });

      it(`tells an asked agent's hidden chat, which the user never had, that it has no earlier chats, and lists nothing (${ISSUE})`, async () => {
        const fromHidden = await buildTool({ caller: "juno" }).call({}, null);
        const fromUnknown = await buildTool().call({}, fakeChat());

        const refused = {
          text: `Another agent asked you into this chat, so it has no earlier chats with the user. Say so, and don't call ${LIST_CHATS_TOOL_NAME} again.`,
          isError: false,
        };
        expect(fromHidden).toEqual(refused);
        expect(fromUnknown).toEqual(refused);
      });

      it(`refuses while custom agents aren't available and lists nothing (${ISSUE})`, async () => {
        await setCustomAgentsAccess("free");

        const result = await buildTool({ caller: "juno" }).call({}, fakeChat());

        expect(result).toEqual({
          text: "Custom agents aren't available right now. Tell the user.",
          isError: false,
        });
      });
    });
  });
});
