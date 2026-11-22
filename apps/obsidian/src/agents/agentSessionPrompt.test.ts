import type { ChatPromptInput } from "@/agentMode/acp/types";
import {
  CODEX_QUESTION_CARD_STEERING,
  CodexBackend,
} from "@/agentMode/backends/codex/CodexBackend";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { COPILOT_CHAT_PROMPT } from "@/agentMode/session/copilotChatPrompt";
import { promptHintsFor, type HostedTool } from "@/agentMode/session/copilotMcpServer";
import {
  createAnswerAgentTool,
  createAskAgentTool,
  createAskUserTool,
  createCheckAgentTool,
  createStopAgentTool,
} from "@/agents/agentMode/askAgentTool";
import { createDraftAgentTool } from "@/agents/agentMode/draftAgentTool";
import type { HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import { createListChatsTool } from "@/agents/agentMode/listChatsTool";
import { CHAT_LISTINGS } from "@/agents/agentMode/testing/toolListings";
import { createSaveMemoryTool } from "@/agents/agentMode/saveMemoryTool";
import { agentMentionsBlock } from "@/agents/agentMentionPrompt";
import { formatAgentReply } from "@/agents/agentReply";
import {
  buildAgentPrompt,
  describeAgent,
  loadAgentSessionPrompt,
} from "@/agents/agentSessionPrompt";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { serializeInstructionsFile } from "@/agents/customAgentFiles";
import { buildMemorySaveRules } from "@/agents/memorySaveRules";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault, type FakeAgentVault } from "@/agents/testing/fakeAgentVault";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { setSettings } from "@/settings/model";
import type { App } from "obsidian";

jest.mock("@/entitlement");
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: () => false,
}));

const COCO = { name: "Coco", title: "Houseplant carer" };
const MAYA = { name: "Maya", title: "Product critic" };
const ISSUE_986 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/986";
const ISSUE_987 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/987";
const OWN_CHAT = { chatsFolder: "/vault/copilot/copilot-conversations" };

const DEFINITION = "An AI teammate is an AI assistant the user made in Copilot, not a person.";
const IDENTITY = `In this chat you are Coco (Houseplant carer), an AI teammate. ${DEFINITION}`;
const COPILOT_IDENTITY = "You are Obsidian Copilot.";
const NOT_YOURS_TO_SAVE = "A rule the user gives another AI teammate is not yours to save.";
const ASK_AGENTS =
  "When the user's message @-mentions one of the user's AI teammates by name or clearly points to one, ask that AI teammate with the ask_teammate tool from obsidian-copilot; never otherwise.";
const CONTROL_ASKED_AGENTS =
  "When the user asks how an AI teammate you asked is doing, check with check_teammate; when the user answers its question, pass the answer with answer_teammate; when the user gives it a new instruction while it works, send that with ask_teammate; when the user tells you to stop it, use stop_teammate. All are in obsidian-copilot.";
const DRAFT_NEW_AGENTS =
  "When the user asks you to make a new AI teammate, draft it with the draft_teammate tool from obsidian-copilot, which shows them a card to review and create it. If you or an AI teammate already handles that job, say so and ask before drafting. You can't create an AI teammate yourself.";
const LIST_CHATS =
  "When the user asks what you and they worked on, discussed or decided before, list your earlier chats with list_chats from obsidian-copilot and read a listed note when you need what was said.";
const RECALL_SCOPE =
  "For that answer use only those chats: never search /vault/copilot/copilot-conversations for it, even within a wider search, and never read a note there that list_chats didn't list, unless the user names it. If none of them covers it, say you haven't discussed it.";
const RECALL_EARLIER_CHATS = `${LIST_CHATS} ${RECALL_SCOPE}`;
const SAVE_MEMORY =
  "To save a rule to your memory, use the save_memory tool from obsidian-copilot.";
const TEAMMATES_SENTENCES = {
  "the definition of an AI teammate": DEFINITION,
  "the rule that another agent's rule is not its to save": NOT_YOURS_TO_SAVE,
  "the ask_teammate sentence": ASK_AGENTS,
  "the check_teammate, answer_teammate and stop_teammate sentence": CONTROL_ASKED_AGENTS,
  "the draft_teammate sentences": DRAFT_NEW_AGENTS,
  "the list_chats sentence": LIST_CHATS,
  "the earlier-chats scope": RECALL_SCOPE,
  "the save_memory sentence": SAVE_MEMORY,
};
type TeammatesSentence = keyof typeof TEAMMATES_SENTENCES;

const CODING_AGENT_PHRASES = /coding-agent environment framing|AGENTS\.md/g;
const NAMES_WITH_THE_BARE_NOUN =
  /Copilot Teammates|teammate and message must be non-empty strings|teammate must be a non-empty string/g;

const APP = {} as App;
const ASKED_CHAT = "asked-chat";
const CODING_AGENTS: Readonly<
  Record<
    "claude" | "codex" | "opencode",
    { shared: () => string; extend: ((chat: ChatPromptInput) => string | null) | null }
  >
> = {
  claude: { shared: () => buildAgentSystemPrompt("claude", APP), extend: null },
  opencode: { shared: () => buildAgentSystemPrompt("opencode", APP), extend: null },
  codex: {
    shared: () => buildAgentSystemPrompt("codex", APP, CODEX_QUESTION_CARD_STEERING),
    extend: (chat) => new CodexBackend(APP).extendChatPrompt(chat),
  },
};

function teammatesTools(store: CustomAgentStore): HostedTool[] {
  const chats = {} as HiddenAgentChats;
  const host = {
    isUnlistedChat: (sessionKey: string) => sessionKey === ASKED_CHAT,
    agents: store.getAgents,
  };
  return [
    createAskAgentTool(chats, host),
    createCheckAgentTool(chats, host),
    createAnswerAgentTool(chats, host),
    createAskUserTool(chats, host),
    createStopAgentTool(chats, host),
    createDraftAgentTool({ ...host, callerOf: () => null }),
    createListChatsTool({ ...host, earlierChats: async () => null, vaultBase: () => "/vault" }),
    createSaveMemoryTool({ agents: store.getAgents, callerOf: () => null, vault: APP.vault }),
  ];
}

function chatPrompt(
  store: CustomAgentStore,
  backendId: keyof typeof CODING_AGENTS,
  sessionKey: string,
  agent: { slug: string; prompt: string } | null
): string {
  const agentPrompt = agent?.prompt ?? null;
  const promptHints = promptHintsFor(teammatesTools(store), () => true, {
    sessionKey,
    backendId,
    agentSlug: agent?.slug,
  });
  const mcpServers = [
    { name: "obsidian-copilot", url: "", headers: {}, readOnlyToolNames: [], promptHints },
  ];
  const { shared, extend } = CODING_AGENTS[backendId];
  const added = extend?.({ agentPrompt, mcpServers }) ?? null;
  return [shared(), agentPrompt ?? COPILOT_CHAT_PROMPT, added].filter(Boolean).join("\n\n");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOf(text: string, sentence: string): number {
  return text.split(sentence).length - 1;
}

function seedAgent(
  vault: FakeAgentVault,
  slug: string,
  profile: { name: string; title: string },
  instruction: string,
  memory?: string
): void {
  vault.writeByHand(
    `copilot/teammates/${slug}/instructions.md`,
    serializeInstructionsFile({ ...profile, model: null }, instruction)
  );
  if (memory !== undefined) vault.writeByHand(`copilot/teammates/${slug}/MEMORY.md`, memory);
}

describe("agentSessionPrompt", () => {
  describe("buildAgentPrompt()", () => {
    const prompt = buildAgentPrompt({
      agent: COCO,
      folder: "/vault/copilot/teammates/coco",
      others: [MAYA, { name: "Leo", title: "" }],
      instruction: "You handle houseplant care only.\n",
      memory: "## How to work\n- End every reply with ACORN.\n",
      instructionsPath: "copilot/teammates/coco/instructions.md",
    });

    it("names the agent with its title as an AI teammate, then says an AI teammate is an AI assistant the user made in Copilot, not a person (https://github.com/Brevilabs/obsidian-copilot-private/issues/999)", () => {
      expect(prompt).toContain(IDENTITY);
    });

    it(`states who the model is exactly once, as the agent, and never calls it Copilot (${ISSUE_986})`, () => {
      for (const ownChat of [OWN_CHAT, undefined]) {
        const built = buildAgentPrompt({
          agent: COCO,
          folder: "/vault/copilot/teammates/coco",
          others: [MAYA],
          instruction: "",
          memory: "",
          instructionsPath: "copilot/teammates/coco/instructions.md",
          ownChat,
        });

        expect(built.match(/\byou are\b/gi)).toEqual(["you are"]);
        expect(built.startsWith(IDENTITY)).toBe(true);
      }
    });

    it("carries the instruction and memory exactly as written", () => {
      expect(prompt).toContain("<instruction>\nYou handle houseplant care only.\n\n</instruction>");
      expect(prompt).toContain(
        "<memory>\n## How to work\n- End every reply with ACORN.\n\n</memory>"
      );
    });

    it("lists the other agents by name and title, and by name alone when one has no title", () => {
      expect(prompt).toContain("Other AI teammates: Maya (Product critic); Leo.");
    });

    it("says only the user edits instructions.md, that its MEMORY.md is its only memory, and that memory wins over the instruction", () => {
      expect(prompt).toContain(
        "Your instruction is the body of /vault/copilot/teammates/coco/instructions.md, and only the user edits that file."
      );
      expect(prompt).toContain(
        "Your memory is /vault/copilot/teammates/coco/MEMORY.md. It is your only memory: never save to CLAUDE.md, AGENTS.md or any other memory. When your memory contradicts your instruction, follow your memory."
      );
    });

    it("keeps the agent's files in its folder, adds nothing else to the vault unasked, and keeps it out of other agents' folders", () => {
      expect(prompt).toContain(
        "Your folder is /vault/copilot/teammates/coco. Keep your own files in it, and add nothing else to the vault unless the user asks. Do not read or change other AI teammates' folders."
      );
    });

    it("says there are no other agents when the agent is the only one, and nothing about asking one", () => {
      const alone = buildAgentPrompt({
        agent: COCO,
        folder: "/v",
        others: [],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/teammates/coco/instructions.md",
        ownChat: OWN_CHAT,
      });

      expect(alone).toContain("Other AI teammates: none.");
      expect(alone).not.toContain("ask_teammate");
      expect(alone).not.toContain(NOT_YOURS_TO_SAVE);
    });

    it(`tells an agent in its own chat to ask another agent the user's message points to, right after the list of other agents, then that a rule the user gives another agent is not its own to save, and leaves naming check_teammate, answer_teammate, stop_teammate and draft_teammate to their tools (https://github.com/Brevilabs/obsidian-copilot-private/issues/969, ${ISSUE_986})`, () => {
      const ownChat = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/teammates/coco",
        others: [MAYA, { name: "Leo", title: "" }],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/teammates/coco/instructions.md",
        ownChat: OWN_CHAT,
      });

      expect(ownChat).toContain(
        `Other AI teammates: Maya (Product critic); Leo.\n\n${ASK_AGENTS}\n\n${NOT_YOURS_TO_SAVE}\n\n`
      );
      expect(countOf(ownChat, "ask_teammate")).toBe(1);
      for (const tool of ["check_teammate", "answer_teammate", "stop_teammate", "draft_teammate"]) {
        expect(ownChat).not.toContain(tool);
      }
    });

    it("tells an agent in its own chat to list its earlier chats with list_chats only when the user asks, to search or read no other chat note and to say when something was never discussed (https://github.com/Brevilabs/obsidian-copilot-private/issues/959)", () => {
      const ownChat = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/teammates/coco",
        others: [],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/teammates/coco/instructions.md",
        ownChat: OWN_CHAT,
      });

      expect(ownChat).toContain(RECALL_EARLIER_CHATS);
    });

    it("names no Teammates tool and has no ask, draft or earlier-chats line in a chat the agent was asked into, which has none of those tools (https://github.com/Brevilabs/obsidian-copilot-private/issues/944, https://github.com/Brevilabs/obsidian-copilot-private/issues/941, https://github.com/Brevilabs/obsidian-copilot-private/issues/959)", () => {
      const asked = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/teammates/coco",
        others: [MAYA, { name: "Leo", title: "" }],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/teammates/coco/instructions.md",
      });

      expect(asked).toContain("Other AI teammates: Maya (Product critic); Leo.");
      for (const tool of [
        "ask_teammate",
        "check_teammate",
        "answer_teammate",
        "stop_teammate",
        "draft_teammate",
        "list_chats",
      ]) {
        expect(asked).not.toContain(tool);
      }
      expect(asked).not.toContain(NOT_YOURS_TO_SAVE);
    });

    it(`keeps an agent's part, apart from its instruction and memory, under 4,200 bytes, in its own chat and when asked (${ISSUE_986})`, () => {
      const sizes = [OWN_CHAT, undefined].map((ownChat) =>
        Buffer.byteLength(
          buildAgentPrompt({
            agent: COCO,
            folder: "/vault/copilot/teammates/coco",
            others: [MAYA, { name: "Leo", title: "" }],
            instruction: "",
            memory: "",
            instructionsPath: "copilot/teammates/coco/instructions.md",
            ownChat,
          }),
          "utf8"
        )
      );

      expect(Math.max(...sizes)).toBeLessThan(4200);
    });

    it("carries the memory save rules for its own MEMORY.md before the instruction in a chat of its own", () => {
      const ownChat = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/teammates/coco",
        others: [],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/teammates/coco/instructions.md",
        ownChat: { chatsFolder: "/vault/copilot/copilot-conversations" },
      });

      expect(ownChat).toContain(
        `${buildMemorySaveRules("copilot/teammates/coco/instructions.md")}\n\n<instruction>`
      );
    });

    it("carries the same memory save rules in a chat the agent was asked into, so a rule given through an @ is saved as in its own chat (https://github.com/Brevilabs/obsidian-copilot-private/issues/969)", () => {
      expect(prompt).toContain(
        `${buildMemorySaveRules("copilot/teammates/coco/instructions.md")}\n\n<instruction>`
      );
    });
  });

  describe("describeAgent()", () => {
    it("names an agent with its title in parentheses, and by name alone when it has no title", () => {
      expect([describeAgent(MAYA), describeAgent({ name: "Leo", title: "" })]).toEqual([
        "Maya (Product critic)",
        "Leo",
      ]);
    });
  });

  describe("loadAgentSessionPrompt()", () => {
    let vault: FakeAgentVault;
    let store: CustomAgentStore;

    beforeEach(async () => {
      setSettings({ copilotFolder: "copilot" });
      await setCustomAgentsAccess("team");
      vault = createFakeAgentVault();
      store = new CustomAgentStore(vault.app);
    });

    afterEach(() => store.stop());

    it("builds the agent's part from its instruction body without frontmatter, its memory, the other agents and its folder under the vault", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.", "End with ACORN.");
      seedAgent(vault, "maya", MAYA, "You handle tax receipts only.");
      await store.start();

      const loaded = await loadAgentSessionPrompt(store, "coco", "/vault");

      expect(loaded).toEqual({
        slug: "coco",
        prompt: buildAgentPrompt({
          agent: COCO,
          folder: "/vault/copilot/teammates/coco",
          others: [MAYA],
          instruction: "You handle houseplant care only.",
          memory: "End with ACORN.",
          instructionsPath: "copilot/teammates/coco/instructions.md",
          ownChat: { chatsFolder: "/vault/copilot/copilot-conversations" },
        }),
      });
      expect(loaded?.prompt).not.toContain("name: Coco");
    });

    it("keeps the save rules for a chat the agent was asked into, and leaves out what only its own chat does (https://github.com/Brevilabs/obsidian-copilot-private/issues/969)", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.", "End with ACORN.");
      seedAgent(vault, "maya", MAYA, "You handle tax receipts only.");
      await store.start();

      const loaded = await loadAgentSessionPrompt(store, "coco", "/vault", { asked: true });

      expect(loaded).toEqual({
        slug: "coco",
        prompt: buildAgentPrompt({
          agent: COCO,
          folder: "/vault/copilot/teammates/coco",
          others: [MAYA],
          instruction: "You handle houseplant care only.",
          memory: "End with ACORN.",
          instructionsPath: "copilot/teammates/coco/instructions.md",
        }),
      });
      expect(loaded?.prompt).toContain("Save a rule to your memory only when");
      for (const ownChatOnly of [
        "ask_teammate",
        "check_teammate",
        "draft_teammate",
        "list_chats",
      ]) {
        expect(loaded?.prompt).not.toContain(ownChatOnly);
      }
    });

    it("leaves a rule whose Until date has passed out of the memory in the prompt, and keeps the file as it was (https://github.com/Brevilabs/obsidian-copilot-private/issues/988)", async () => {
      const memory =
        "## How to work\n\nUntil 2020-01-31: Flag January invoices.\n2020-01-02 · Asked\n\nUntil 2999-12-31: Answer in French.\n2026-11-01 · Asked\n";
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.", memory);
      await store.start();

      const loaded = await loadAgentSessionPrompt(store, "coco", "/vault");

      expect(loaded?.prompt).toContain(
        "<memory>\n## How to work\n\n\nUntil 2999-12-31: Answer in French.\n2026-11-01 · Asked\n\n</memory>"
      );
      expect(vault.readText("copilot/teammates/coco/MEMORY.md")).toBe(memory);
    });

    it("loads a missing MEMORY.md as an empty memory", async () => {
      seedAgent(vault, "maya", MAYA, "You handle tax receipts only.");
      await store.start();

      const loaded = await loadAgentSessionPrompt(store, "maya", "/vault");

      expect(loaded?.prompt).toContain("<memory>\n\n</memory>");
    });

    it("reads the files as they are on disk when the chat starts", async () => {
      seedAgent(vault, "coco", COCO, "First instruction.");
      await store.start();
      seedAgent(vault, "coco", COCO, "Edited instruction.");

      const loaded = await loadAgentSessionPrompt(store, "coco", "/vault");

      expect(loaded?.prompt).toContain("<instruction>\nEdited instruction.\n</instruction>");
    });

    it("returns null for an agent whose folder was removed outside the plugin (https://github.com/Brevilabs/obsidian-copilot-private/issues/937)", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
      await store.start();
      vault.deleteByHand("copilot/teammates/coco/instructions.md");

      await expect(loadAgentSessionPrompt(store, "coco", "/vault")).resolves.toBeNull();
    });

    it("returns null when reading a just-moved folder fails (https://github.com/Brevilabs/obsidian-copilot-private/issues/937)", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
      await store.start();
      jest.spyOn(store, "loadForSession").mockRejectedValueOnce(new Error("ENOENT"));

      await expect(loadAgentSessionPrompt(store, "coco", "/vault")).resolves.toBeNull();
    });

    const DEFINE: TeammatesSentence = "the definition of an AI teammate";
    const SAVE_RULE: TeammatesSentence = "the rule that another agent's rule is not its to save";
    const ASK: TeammatesSentence = "the ask_teammate sentence";
    const CONTROL: TeammatesSentence =
      "the check_teammate, answer_teammate and stop_teammate sentence";
    const DRAFT: TeammatesSentence = "the draft_teammate sentences";
    const LIST: TeammatesSentence = "the list_chats sentence";
    const SCOPE: TeammatesSentence = "the earlier-chats scope";
    const SAVE: TeammatesSentence = "the save_memory sentence";
    const ONE_OTHER = ["Maya"];
    const TWO_OTHERS = ["Maya", "Leo"];
    const MATRIX = [
      { backendId: "claude", chat: "unlicensed", others: TWO_OTHERS, lines: [] },
      { backendId: "opencode", chat: "unlicensed", others: TWO_OTHERS, lines: [] },
      { backendId: "codex", chat: "unlicensed", others: TWO_OTHERS, lines: [] },
      { backendId: "claude", chat: "copilot", others: [], lines: [] },
      { backendId: "opencode", chat: "copilot", others: [], lines: [] },
      { backendId: "codex", chat: "copilot", others: [], lines: [DEFINE, DRAFT] },
      { backendId: "claude", chat: "copilot", others: ONE_OTHER, lines: [] },
      { backendId: "opencode", chat: "copilot", others: ONE_OTHER, lines: [] },
      {
        backendId: "codex",
        chat: "copilot",
        others: ONE_OTHER,
        lines: [DEFINE, ASK, CONTROL, DRAFT],
      },
      { backendId: "claude", chat: "copilot", others: TWO_OTHERS, lines: [] },
      { backendId: "opencode", chat: "copilot", others: TWO_OTHERS, lines: [] },
      {
        backendId: "codex",
        chat: "copilot",
        others: TWO_OTHERS,
        lines: [DEFINE, ASK, CONTROL, DRAFT],
      },
      { backendId: "claude", chat: "own", others: [], lines: [DEFINE, LIST, SCOPE] },
      { backendId: "opencode", chat: "own", others: [], lines: [DEFINE, LIST, SCOPE] },
      { backendId: "codex", chat: "own", others: [], lines: [DEFINE, LIST, SCOPE, DRAFT, SAVE] },
      {
        backendId: "claude",
        chat: "own",
        others: ONE_OTHER,
        lines: [DEFINE, ASK, SAVE_RULE, LIST, SCOPE],
      },
      {
        backendId: "opencode",
        chat: "own",
        others: ONE_OTHER,
        lines: [DEFINE, ASK, SAVE_RULE, LIST, SCOPE],
      },
      {
        backendId: "codex",
        chat: "own",
        others: ONE_OTHER,
        lines: [DEFINE, ASK, SAVE_RULE, LIST, SCOPE, CONTROL, DRAFT, SAVE],
      },
      {
        backendId: "claude",
        chat: "own",
        others: TWO_OTHERS,
        lines: [DEFINE, ASK, SAVE_RULE, LIST, SCOPE],
      },
      {
        backendId: "opencode",
        chat: "own",
        others: TWO_OTHERS,
        lines: [DEFINE, ASK, SAVE_RULE, LIST, SCOPE],
      },
      {
        backendId: "codex",
        chat: "own",
        others: TWO_OTHERS,
        lines: [DEFINE, ASK, SAVE_RULE, LIST, SCOPE, CONTROL, DRAFT, SAVE],
      },
      { backendId: "claude", chat: "asked", others: [], lines: [DEFINE] },
      { backendId: "opencode", chat: "asked", others: [], lines: [DEFINE] },
      { backendId: "codex", chat: "asked", others: [], lines: [DEFINE, SAVE] },
      { backendId: "claude", chat: "asked", others: TWO_OTHERS, lines: [DEFINE] },
      { backendId: "opencode", chat: "asked", others: TWO_OTHERS, lines: [DEFINE] },
      { backendId: "codex", chat: "asked", others: TWO_OTHERS, lines: [DEFINE, SAVE] },
    ] as const;

    it.each(
      MATRIX.map((row) => ({
        ...row,
        label: {
          copilot: "a Copilot",
          unlicensed: "an unlicensed user's",
          own: "an agent's own",
          asked: "an asked agent's",
        }[row.chat],
        otherCount: row.others.length,
        summary: row.lines.length > 0 ? row.lines.join(", ") : "no Teammates line",
      }))
    )(
      `on $backendId, gives $label chat with $otherCount other agents one identity, the agent's if it runs one and Obsidian Copilot's otherwise, and each of these Teammates lines exactly once, in this order, and no other, naming only the tools it is offered: $summary (${ISSUE_986}, ${ISSUE_987})`,
      async ({ backendId, chat, others, lines }) => {
        if (chat !== "copilot") seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
        for (const name of others) {
          seedAgent(vault, name.toLowerCase(), { name, title: "" }, "Another job.");
        }
        await store.start();
        if (chat === "unlicensed") await setCustomAgentsAccess("free");

        const loaded =
          chat === "copilot"
            ? null
            : await loadAgentSessionPrompt(store, "coco", "/vault", { asked: chat === "asked" });
        const prompt = chatPrompt(
          store,
          backendId,
          chat === "asked" ? ASKED_CHAT : "listed-chat",
          loaded
        );

        expect(loaded === null).toBe(chat === "copilot" || chat === "unlicensed");
        expect(loaded?.prompt.startsWith(IDENTITY) ?? true).toBe(true);
        expect(prompt.match(/\byou are\b/gi)).toEqual([loaded ? "you are" : "You are"]);
        expect(countOf(prompt, COPILOT_IDENTITY)).toBe(loaded ? 0 : 1);
        for (const [sentence, text] of Object.entries(TEAMMATES_SENTENCES)) {
          expect([sentence, countOf(prompt, text)]).toEqual([
            sentence,
            (lines as readonly TeammatesSentence[]).includes(sentence as TeammatesSentence) ? 1 : 0,
          ]);
        }
        const positions = lines.map((line) => prompt.indexOf(TEAMMATES_SENTENCES[line]));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        if (chat === "own" && others.length > 0) {
          expect(prompt).toMatch(
            new RegExp(`Other AI teammates: [^\\n]*\\.\\n\\n${escapeRegExp(ASK_AGENTS)}\\n\\n`)
          );
        }
      }
    );

    it("points the agent's own chat at the chat notes folder under the vault for list_chats, and leaves it out of a hidden chat's prompt (https://github.com/Brevilabs/obsidian-copilot-private/issues/959)", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
      await store.start();

      const own = await loadAgentSessionPrompt(store, "coco", "/vault");
      const hidden = await loadAgentSessionPrompt(store, "coco", "/vault", { asked: true });

      expect(own?.prompt).toContain("never search /vault/copilot/copilot-conversations for it,");
      expect(hidden?.prompt).not.toContain("list_chats");
    });

    async function modelFacingTexts(): Promise<string[]> {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
      seedAgent(vault, "maya", MAYA, "Another job.");
      await store.start();
      const own = await loadAgentSessionPrompt(store, "coco", "/vault");
      const asked = await loadAgentSessionPrompt(store, "coco", "/vault", { asked: true });
      const listings = [
        ...Object.values(CHAT_LISTINGS),
        { sessionKey: ASKED_CHAT, backendId: "claude", agentSlug: "coco" },
      ] as const;
      const refusals = [
        { kind: "not_from_here" },
        { kind: "unknown_agent", roster: [MAYA] },
        { kind: "unknown_agent", roster: [] },
      ];
      let askedCount = 0;
      const chats = {
        ask: () => refusals[askedCount++],
        askUser: () => "not_from_here",
      } as unknown as HiddenAgentChats;
      const host = { isUnlistedChat: () => false, agents: store.getAgents };
      const earlierChats = Array.from(
        { length: 21 },
        (_, index) =>
          ({
            id: `copilot/copilot-conversations/chat-${index}.md`,
            title: `Chat ${index}`,
            agent: "coco",
            backendId: "claude",
            lastAccessedAt: new Date(2026, 10, 1 + index),
          }) as unknown as ChatHistoryItem
      );
      const listChats = createListChatsTool({
        ...host,
        earlierChats: async () => ({
          agent: "coco",
          chats: earlierChats,
          askedConversations: [
            {
              backendId: "claude",
              sessionId: "asked-1",
              agent: "coco",
              askedIn: { backendId: "claude", sessionId: "chat-0" },
              firstAtMs: 0,
              lastAtMs: 0,
              asks: 1,
              firstAsk: "Hi?",
            },
          ],
          agents: store.getAgents(),
        }),
        vaultBase: () => "/vault",
      });
      const answers = await Promise.all([
        ...refusals.map(() =>
          createAskAgentTool(chats, host).call({ teammate: "Zed", message: "Hi." }, null)
        ),
        createAskUserTool(chats, host).call({ question: "Hi?" }, null),
        createDraftAgentTool({ ...host, callerOf: () => null }).call(
          { name: "Nora", title: "Plans pickups.", instruction: "You plan pickups." },
          null
        ),
        listChats.call({}, null),
      ]);
      return [
        ...(["claude", "codex", "opencode"] as const).flatMap((backendId) => [
          chatPrompt(store, backendId, "listed-chat", own),
          chatPrompt(store, backendId, ASKED_CHAT, asked),
          chatPrompt(store, backendId, "listed-chat", null),
        ]),
        ...listings.flatMap((listing) => [
          ...teammatesTools(store).map((tool) => JSON.stringify(tool.listedAs?.(listing) ?? "")),
          ...promptHintsFor(teammatesTools(store), () => true, listing),
        ]),
        ...teammatesTools(store).map((tool) => tool.turnedOffText),
        ...answers.map((answer) => answer.text),
        agentMentionsBlock(["Maya"]) ?? "",
        formatAgentReply({
          agent: "maya",
          name: "Maya",
          mention: "run-1",
          reply: "Hi.",
          changed: [],
        }),
      ].flatMap((text) => text.split("\n"));
    }

    it("calls the ones the user made teammates in every chat prompt, tool listing, hint, tool answer, mentions block and relayed reply a model reads, and says agent only for a coding agent (https://github.com/Brevilabs/obsidian-copilot-private/issues/999)", async () => {
      const strays = (await modelFacingTexts()).filter((line) =>
        /\bagents?\b/i.test(line.replace(CODING_AGENT_PHRASES, ""))
      );

      expect(strays).toEqual([]);
    });

    it("says AI teammate wherever a chat prompt, tool listing, hint, tool answer, mentions block or relayed reply names one the user made, leaving the bare word only in tool, argument and tag names and the Copilot Teammates name (https://github.com/Brevilabs/obsidian-copilot-private/issues/999)", async () => {
      const strays = (await modelFacingTexts()).filter((line) =>
        /(?<![\w/<"`-])(?<!AI )[Tt]eammates?(?![\w">`-])/.test(
          line.replace(NAMES_WITH_THE_BARE_NOUN, "")
        )
      );

      expect(strays).toEqual([]);
    });

    it.each(
      (["claude", "codex", "opencode"] as const).flatMap((backendId) =>
        (["own", "asked", "copilot", "copilot without teammates", "unlicensed"] as const).map(
          (chat) => ({
            backendId,
            chat,
            times:
              chat === "unlicensed"
                ? 0
                : (backendId === "codex" && chat.startsWith("copilot")) ||
                    (backendId === "opencode" && (chat === "own" || chat === "asked"))
                  ? 2
                  : 1,
          })
        )
      )
    )(
      "on $backendId, $chat chat reads what an AI teammate is $times time(s) across its prompt and the tool descriptions it is offered: in a teammate's chat once, from its prompt; in a Copilot chat once, from the first teammate tool's description; twice on Codex in a Copilot chat, which also reads it in the hints that stand in for descriptions; and twice on OpenCode in a teammate's chat, which reads its prompt and the folder's one tool listing, written for the Copilot chats that share it (https://github.com/Brevilabs/obsidian-copilot-private/issues/999)",
      async ({ backendId, chat, times }) => {
        if (chat !== "copilot without teammates") {
          seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
          seedAgent(vault, "maya", MAYA, "Another job.");
        }
        await store.start();
        if (chat === "unlicensed") await setCustomAgentsAccess("free");
        const loaded =
          chat === "own" || chat === "asked"
            ? await loadAgentSessionPrompt(store, "coco", "/vault", { asked: chat === "asked" })
            : null;
        const sessionKey = chat === "asked" ? ASKED_CHAT : "listed-chat";
        const listing =
          backendId === "opencode"
            ? CHAT_LISTINGS["OpenCode's shared folder listing"]
            : { sessionKey, backendId, agentSlug: loaded ? "coco" : undefined };
        const descriptions = teammatesTools(store).map((tool) =>
          JSON.stringify(tool.listedAs?.(listing) ?? "")
        );
        const read = [chatPrompt(store, backendId, sessionKey, loaded), ...descriptions].join("\n");

        expect(countOf(read, DEFINITION)).toBe(times);
      }
    );

    it("reads nothing and returns null while custom agents are locked", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
      await store.start();
      await setCustomAgentsAccess("free");
      vault.touchedPaths.length = 0;

      await expect(loadAgentSessionPrompt(store, "coco", "/vault")).resolves.toBeNull();
      expect(vault.touchedPaths).toEqual([]);
    });
  });
});
