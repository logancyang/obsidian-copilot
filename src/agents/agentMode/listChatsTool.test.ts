import type { AskedConversation } from "@/agentMode/session/AgentSessionIndex";
import { fakeChat } from "@/agentMode/session/testing/fakeChat";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { createListChatsTool, LIST_CHATS_TOOL_NAME } from "@/agents/agentMode/listChatsTool";
import {
  CHAT_LISTINGS,
  listingCases,
  toolHost,
  type AgentSet,
} from "@/agents/agentMode/testing/toolListings";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { resetSettings } from "@/settings/model";
import { buildNativeChatId } from "@/utils/nativeChatId";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/959";
const ASKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/980";
const SCOPE_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/987";
const CUT_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/990";
const VAULT = "/Users/me/Vault";
const SCOPE =
  "Every other chat note belongs to another AI teammate or to Copilot: unless the user names it, never search, read or cite it.";

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

const ASKED_HEADER =
  "Conversations another AI teammate or Copilot asked you into on the user's behalf, newest first. Your answers went back to the chat that asked: you know only what each line says, and there's no note to open for them.";
const REX_CHAT: ChatHistoryItem = {
  ...chatItem("Launch budget review", 16, "rex"),
  backendId: "claude",
  sessionId: "rex-chat",
};
const COPILOT_CHAT: ChatHistoryItem = {
  ...chatItem("Quarter planning", 12, undefined, buildNativeChatId("codex", "copilot-chat")),
  backendId: "codex",
  sessionId: "copilot-chat",
};
const AGENTS = [
  { slug: "juno", name: "Juno" },
  { slug: "rex", name: "Rex" },
];

function askedConversation(overrides: Partial<AskedConversation> = {}): AskedConversation {
  return {
    backendId: "claude",
    sessionId: "juno-hidden-1",
    agent: "juno",
    askedBy: "rex",
    askedIn: { backendId: "claude", sessionId: "rex-chat" },
    firstAtMs: new Date(2026, 10, 16, 9).getTime(),
    lastAtMs: new Date(2026, 10, 17, 9).getTime(),
    asks: 2,
    firstAsk: "Is $8k right for the launch video?",
    latestAnswer: "Yes, if the video stays under two minutes.",
    ending: "finished",
    ...overrides,
  };
}

function buildTool(
  options: {
    caller?: string | null;
    history?: ChatHistoryItem[];
    askedConversations?: AskedConversation[];
    agents?: AgentSet;
  } = {}
) {
  return createListChatsTool({
    ...toolHost(options.agents),
    earlierChats: async (chat) =>
      chat && options.caller !== undefined
        ? {
            agent: options.caller,
            chats: options.history ?? [...JUNO_CHATS, ...OTHER_CHATS],
            askedConversations: options.askedConversations ?? [],
            agents: AGENTS,
          }
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
    describe("promptHint", () => {
      it("gives a model that can't see tool descriptions the sentence naming list_chats and when to call it, the same sentence that opens an agent's earlier-chats paragraph (https://github.com/Brevilabs/obsidian-copilot-private/issues/986)", () => {
        expect(buildTool().promptHint).toBe(
          "When the user asks what you and they worked on, discussed or decided before, list your earlier chats with list_chats from obsidian-copilot and read a listed note when you need what was said."
        );
      });
    });

    describe("listedAs()", () => {
      it(`lists the tool, saying in its opening when to call it (${ISSUE})`, () => {
        const listed = buildTool().listedAs?.(CHAT_LISTINGS["Coco's own chat"]);

        expect(listed?.name).toBe(LIST_CHATS_TOOL_NAME);
        const description = (listed as unknown as { description: string }).description;
        expect(description.slice(0, 120)).toContain("when the user asks about earlier chats");
      });

      it.each(["free", "plus-without-custom-agents"] as const)(
        `leaves the tool out while custom agents aren't available (%s) (${ISSUE})`,
        async (access) => {
          await setCustomAgentsAccess(access);

          expect(buildTool().listedAs?.(CHAT_LISTINGS["Coco's own chat"])).toBeNull();
        }
      );

      it.each(
        listingCases({
          "a Copilot chat": [],
          "Coco's own chat": ["no agent", "only Coco", "Coco and Maya", "Coco, Maya and Leo"],
          "the chat Coco runs when asked": [],
          "OpenCode's shared folder listing": ["only Coco", "Coco and Maya", "Coco, Maya and Leo"],
        })
      )(
        `$label: it is offered only in an agent's own chat, even before its agent loads or after it is deleted while the chat is open, or in a folder's shared listing that can reach one while any agent exists (${SCOPE_ISSUE})`,
        ({ chat, agents, listed }) => {
          expect(buildTool({ agents }).listedAs?.(CHAT_LISTINGS[chat])?.name ?? null).toBe(
            listed ? LIST_CHATS_TOOL_NAME : null
          );
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

      it(`says how many older chats a cut list left out, that unlisted notes include them, and that an answer missing from the list may be in one, so the teammate doesn't deny a chat that happened (${CUT_ISSUE})`, async () => {
        const history = Array.from({ length: 25 }, (_, i) =>
          chatItem(`Chat ${i + 1}`, i + 1, "juno")
        );

        const { text } = await buildTool({ caller: "juno", history }).call({}, fakeChat());

        expect(text.split("\n")[0]).toBe(
          "Your earlier chats with the user, newest first. Open a listed note with your file or shell tools to see what was said. Older chats of yours left out of this list: 5. Every other chat note is one of those or belongs to another AI teammate or to Copilot: unless the user names it, never search, read or cite it. If none listed covers the question, say it may be in an older chat you can read if the user names it, not that you haven't discussed it."
        );
      });

      it(`keeps the scope that every unlisted chat note is someone else's when all 20 of the caller's chats fit the list (${CUT_ISSUE})`, async () => {
        const history = Array.from({ length: 20 }, (_, i) =>
          chatItem(`Chat ${i + 1}`, i + 1, "juno")
        );

        const { text } = await buildTool({
          caller: "juno",
          history: [...history, ...OTHER_CHATS],
        }).call({}, fakeChat());

        expect(text.split("\n")[0]).toBe(
          `Your earlier chats with the user, newest first. Open a listed note with your file or shell tools to see what was said. ${SCOPE}`
        );
        expect(text.split("\n")).toHaveLength(21);
      });

      it(`lists the caller's archived chats among its current ones, newest first within the 20 limit, and never another agent's archived chat (${ISSUE})`, async () => {
        const history = Array.from({ length: 25 }, (_, i) => {
          const item = chatItem(`Chat ${i + 1}`, i + 1, "juno");
          return i % 2 === 0 ? { ...item, archivedAt: Date.now() } : item;
        });
        const rexArchived = { ...chatItem("Rex archived plan", 30, "rex"), archivedAt: Date.now() };

        const { text } = await buildTool({
          caller: "juno",
          history: [rexArchived, ...history],
        }).call({}, fakeChat());

        const lines = text.split("\n").slice(1);
        expect(lines.map((line) => line.split(" · ")[1])).toEqual(
          Array.from({ length: 20 }, (_, i) => `Chat ${25 - i}`)
        );
        expect(text).not.toContain("Rex archived plan");
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

      it(`lists the conversations other agents and Copilot asked the caller into after its own chats, newest first, each with its date, who asked, the asking chat's title, times asked, first ask and latest answer (${ASKED_ISSUE})`, async () => {
        const { text } = await buildTool({
          caller: "juno",
          history: [...JUNO_CHATS, REX_CHAT, COPILOT_CHAT],
          askedConversations: [
            askedConversation(),
            askedConversation({
              backendId: "codex",
              sessionId: "juno-hidden-2",
              askedBy: undefined,
              askedIn: { backendId: "codex", sessionId: "copilot-chat" },
              lastAtMs: new Date(2026, 10, 18, 9).getTime(),
              asks: 1,
              firstAsk: "Which week works for the shoot?",
              latestAnswer: "The week of the 24th.",
            }),
          ],
        }).call({}, fakeChat());

        expect(text).toBe(
          [
            `Your earlier chats with the user, newest first. Open a listed note with your file or shell tools to see what was said. ${SCOPE}`,
            `- 2026-11-15 · Launch announcement draft · ${VAULT}/copilot/copilot-conversations/Launch announcement draft.md`,
            "- 2026-11-13 · Sync conflict crash triage · not saved as a note, so only its title and date are known",
            `- 2026-11-11 · Release video plan · ${VAULT}/copilot/copilot-conversations/Release video plan.md`,
            "",
            ASKED_HEADER,
            '- 2026-11-18 · Copilot asked you in "Quarter planning" · times asked: 1 · first ask: "Which week works for the shoot?" · your latest answer: "The week of the 24th."',
            '- 2026-11-17 · Rex asked you in "Launch budget review" · times asked: 2 · first ask: "Is $8k right for the launch video?" · your latest answer: "Yes, if the video stays under two minutes."',
          ].join("\n")
        );
      });

      it(`lists the asked conversations after saying the caller has no earlier chats of its own (${ASKED_ISSUE})`, async () => {
        const { text } = await buildTool({
          caller: "juno",
          history: [REX_CHAT, ...OTHER_CHATS],
          askedConversations: [askedConversation()],
        }).call({}, fakeChat());

        expect(text).toBe(
          [
            `You have no earlier chats with the user. ${SCOPE}`,
            "",
            ASKED_HEADER,
            '- 2026-11-17 · Rex asked you in "Launch budget review" · times asked: 2 · first ask: "Is $8k right for the launch video?" · your latest answer: "Yes, if the video stays under two minutes."',
          ].join("\n")
        );
      });

      it(`says how the latest ask ended when it was stopped or didn't finish, and reads a run with no recorded end, as after Obsidian closed mid-run, as not finished (${ASKED_ISSUE})`, async () => {
        const { text } = await buildTool({
          caller: "juno",
          history: [REX_CHAT],
          askedConversations: [
            askedConversation({ sessionId: "stopped", ending: "stopped", latestAnswer: "So far" }),
            askedConversation({ sessionId: "failed", ending: "didnt_finish", lastAtMs: 1 }),
            askedConversation({
              sessionId: "cut-off",
              ending: undefined,
              latestAnswer: undefined,
              lastAtMs: 0,
            }),
          ],
        }).call({}, fakeChat());

        expect(
          text
            .split("\n")
            .slice(3)
            .map((line) => line.split(" · ").at(-1))
        ).toEqual([
          'the user stopped you before you finished; your answer so far: "So far"',
          `you didn't finish; your answer so far: "Yes, if the video stays under two minutes."`,
          "you didn't finish; your answer so far: none",
        ]);
      });

      it(`names an asker deleted since by its folder name, and an asking chat that no list has any more as no longer listed, without failing (${ASKED_ISSUE})`, async () => {
        const { text } = await buildTool({
          caller: "juno",
          history: [],
          askedConversations: [
            askedConversation({
              askedBy: "lea",
              askedIn: { backendId: "claude", sessionId: "deleted-chat" },
            }),
          ],
        }).call({}, fakeChat());

        expect(text.split("\n").at(-1)).toContain(
          "· lea asked you in a chat that's no longer listed ·"
        );
      });

      it(`lists only the caller's asked conversations, at most the 10 asked or answered last (${ASKED_ISSUE})`, async () => {
        const askedConversations = [
          askedConversation({ sessionId: "rex-hidden", agent: "rex", askedBy: "juno" }),
          ...Array.from({ length: 12 }, (_, i) =>
            askedConversation({
              sessionId: `juno-hidden-${i + 1}`,
              lastAtMs: new Date(2026, 10, i + 1, 9).getTime(),
            })
          ),
        ];

        const { text } = await buildTool({
          caller: "juno",
          history: [REX_CHAT],
          askedConversations,
        }).call({}, fakeChat());

        const lines = text.split("\n").slice(3);
        expect(lines).toHaveLength(10);
        expect(lines[0]).toMatch(/^- 2026-11-12 · Rex asked you/);
        expect(lines[9]).toMatch(/^- 2026-11-03 · /);
        expect(text).not.toContain("Juno asked you");
      });

      it(`turns down a call from a Copilot chat or an asked agent's chat, which OpenCode's shared listing still reaches, and lists nothing (${SCOPE_ISSUE})`, async () => {
        const fromCopilot = await buildTool({
          caller: null,
          askedConversations: [askedConversation()],
        }).call({}, fakeChat());
        const fromAsked = await buildTool().call({}, fakeChat());
        const unattributed = await buildTool({ caller: "juno" }).call({}, null);

        const refused = {
          text: `This chat can't list earlier chats. Don't call ${LIST_CHATS_TOOL_NAME} again.`,
          isError: false,
        };
        expect([fromCopilot, fromAsked, unattributed]).toEqual([refused, refused, refused]);
      });

      it(`refuses while custom agents aren't available and lists nothing (${ISSUE})`, async () => {
        await setCustomAgentsAccess("free");

        const result = await buildTool({ caller: "juno" }).call({}, fakeChat());

        expect(result).toEqual({
          text: "Copilot Teammates isn't available right now. Tell the user.",
          isError: false,
        });
      });
    });
  });
});
