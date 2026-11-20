import type { ChatPromptInput } from "@/agentMode/acp/types";
import {
  CODEX_QUESTION_CARD_STEERING,
  CodexBackend,
} from "@/agentMode/backends/codex/CodexBackend";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { buildCopilotChatPrompt } from "@/agentMode/session/copilotChatPrompt";
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

const IDENTITY = "In this chat you are Coco (Houseplant carer), an agent the user made in Copilot.";
const COPILOT_IDENTITY = "You are Obsidian Copilot.";
const NOT_YOURS_TO_SAVE = "A rule the user gives another agent is not yours to save.";
const ASK_AGENTS =
  "When the user's message @-mentions one of the user's agents by name or clearly points to one, ask that agent with the ask_agent tool from obsidian-copilot; never otherwise.";
const CONTROL_ASKED_AGENTS =
  "When the user asks how an agent you asked is doing, check with check_agent; when the user answers its question, pass the answer with answer_agent; when the user gives it a new instruction while it works, send that with ask_agent; when the user tells you to stop it, use stop_agent. All are in obsidian-copilot.";
const DRAFT_NEW_AGENTS =
  "When the user asks you to make a new agent, draft it with the draft_agent tool from obsidian-copilot, which shows them a card to review and create it. If you or another agent already handles that job, say so and ask before drafting. You can't create an agent yourself.";
const LIST_CHATS =
  "When the user asks what you and they worked on, discussed or decided before, list your earlier chats with list_chats from obsidian-copilot and read a listed note when you need what was said.";
const RECALL_SCOPE =
  "For that answer use only those chats: never search /vault/copilot/copilot-conversations for it, even within a wider search, and never read a note there that list_chats didn't list, unless the user names it. If none of them covers it, say you haven't discussed it.";
const RECALL_EARLIER_CHATS = `${LIST_CHATS} ${RECALL_SCOPE}`;
const TEAMMATES_SENTENCES = {
  "the rule that another agent's rule is not its to save": NOT_YOURS_TO_SAVE,
  "the ask_agent sentence": ASK_AGENTS,
  "the check_agent, answer_agent and stop_agent sentence": CONTROL_ASKED_AGENTS,
  "the draft_agent sentences": DRAFT_NEW_AGENTS,
  "the list_chats sentence": LIST_CHATS,
  "the earlier-chats scope": RECALL_SCOPE,
};
type TeammatesSentence = keyof typeof TEAMMATES_SENTENCES;

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
  return [shared(), agentPrompt ?? buildCopilotChatPrompt(), added].filter(Boolean).join("\n\n");
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
    `copilot/agents/${slug}/instructions.md`,
    serializeInstructionsFile({ ...profile, model: null }, instruction)
  );
  if (memory !== undefined) vault.writeByHand(`copilot/agents/${slug}/MEMORY.md`, memory);
}

describe("agentSessionPrompt", () => {
  describe("buildAgentPrompt()", () => {
    const prompt = buildAgentPrompt({
      agent: COCO,
      folder: "/vault/copilot/agents/coco",
      others: [MAYA, { name: "Leo", title: "" }],
      instruction: "You handle houseplant care only.\n",
      memory: "## How to work\n- End every reply with ACORN.\n",
      instructionsPath: "copilot/agents/coco/instructions.md",
    });

    it("names the agent with its title", () => {
      expect(prompt).toContain(IDENTITY);
    });

    it(`states who the model is exactly once, as the agent, and never calls it Copilot (${ISSUE_986})`, () => {
      for (const ownChat of [OWN_CHAT, undefined]) {
        const built = buildAgentPrompt({
          agent: COCO,
          folder: "/vault/copilot/agents/coco",
          others: [MAYA],
          instruction: "",
          memory: "",
          instructionsPath: "copilot/agents/coco/instructions.md",
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
      expect(prompt).toContain("Other agents: Maya (Product critic); Leo.");
    });

    it("says only the user edits instructions.md and that memory wins over the instruction", () => {
      expect(prompt).toContain(
        "Your instruction is the body of /vault/copilot/agents/coco/instructions.md, and only the user edits that file."
      );
      expect(prompt).toContain(
        "Your memory is /vault/copilot/agents/coco/MEMORY.md. When your memory contradicts your instruction, follow your memory."
      );
    });

    it("keeps the agent's files in its folder, adds nothing else to the vault unasked, and keeps it out of other agents' folders", () => {
      expect(prompt).toContain(
        "Your folder is /vault/copilot/agents/coco. Keep your own files in it, and add nothing else to the vault unless the user asks. Do not read or change other agents' folders."
      );
    });

    it("says there are no other agents when the agent is the only one, and nothing about asking one", () => {
      const alone = buildAgentPrompt({
        agent: COCO,
        folder: "/v",
        others: [],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/agents/coco/instructions.md",
        ownChat: OWN_CHAT,
      });

      expect(alone).toContain("Other agents: none.");
      expect(alone).not.toContain("ask_agent");
      expect(alone).not.toContain(NOT_YOURS_TO_SAVE);
    });

    it(`tells an agent in its own chat to ask another agent the user's message points to, right after the list of other agents, then that a rule the user gives another agent is not its own to save, and leaves naming check_agent, answer_agent, stop_agent and draft_agent to their tools (https://github.com/Brevilabs/obsidian-copilot-private/issues/969, ${ISSUE_986})`, () => {
      const ownChat = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/agents/coco",
        others: [MAYA, { name: "Leo", title: "" }],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/agents/coco/instructions.md",
        ownChat: OWN_CHAT,
      });

      expect(ownChat).toContain(
        `Other agents: Maya (Product critic); Leo.\n\n${ASK_AGENTS}\n\n${NOT_YOURS_TO_SAVE}\n\n`
      );
      expect(countOf(ownChat, "ask_agent")).toBe(1);
      for (const tool of ["check_agent", "answer_agent", "stop_agent", "draft_agent"]) {
        expect(ownChat).not.toContain(tool);
      }
    });

    it("tells an agent in its own chat to list its earlier chats with list_chats only when the user asks, to search or read no other chat note and to say when something was never discussed (https://github.com/Brevilabs/obsidian-copilot-private/issues/959)", () => {
      const ownChat = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/agents/coco",
        others: [],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/agents/coco/instructions.md",
        ownChat: OWN_CHAT,
      });

      expect(ownChat).toContain(RECALL_EARLIER_CHATS);
    });

    it("names no Teammates tool and has no ask, draft or earlier-chats line in a chat the agent was asked into, which has none of those tools (https://github.com/Brevilabs/obsidian-copilot-private/issues/944, https://github.com/Brevilabs/obsidian-copilot-private/issues/941, https://github.com/Brevilabs/obsidian-copilot-private/issues/959)", () => {
      const asked = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/agents/coco",
        others: [MAYA, { name: "Leo", title: "" }],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/agents/coco/instructions.md",
      });

      expect(asked).toContain("Other agents: Maya (Product critic); Leo.");
      for (const tool of [
        "ask_agent",
        "check_agent",
        "answer_agent",
        "stop_agent",
        "draft_agent",
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
            folder: "/vault/copilot/agents/coco",
            others: [MAYA, { name: "Leo", title: "" }],
            instruction: "",
            memory: "",
            instructionsPath: "copilot/agents/coco/instructions.md",
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
        folder: "/vault/copilot/agents/coco",
        others: [],
        instruction: "",
        memory: "",
        instructionsPath: "copilot/agents/coco/instructions.md",
        ownChat: { chatsFolder: "/vault/copilot/copilot-conversations" },
      });

      expect(ownChat).toContain(
        `${buildMemorySaveRules("/vault/copilot/agents/coco/MEMORY.md", "copilot/agents/coco/instructions.md")}\n\n<instruction>`
      );
    });

    it("carries the same memory save rules in a chat the agent was asked into, so a rule given through an @ is saved as in its own chat (https://github.com/Brevilabs/obsidian-copilot-private/issues/969)", () => {
      expect(prompt).toContain(
        `${buildMemorySaveRules("/vault/copilot/agents/coco/MEMORY.md", "copilot/agents/coco/instructions.md")}\n\n<instruction>`
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
        name: "Coco",
        prompt: buildAgentPrompt({
          agent: COCO,
          folder: "/vault/copilot/agents/coco",
          others: [MAYA],
          instruction: "You handle houseplant care only.",
          memory: "End with ACORN.",
          instructionsPath: "copilot/agents/coco/instructions.md",
          ownChat: { chatsFolder: "/vault/copilot/copilot-conversations" },
        }),
        memoryPath: "/vault/copilot/agents/coco/MEMORY.md",
      });
      expect(loaded?.prompt).not.toContain("name: Coco");
    });

    it("keeps the save rules and the memory path for a chat the agent was asked into, and leaves out what only its own chat does (https://github.com/Brevilabs/obsidian-copilot-private/issues/969)", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.", "End with ACORN.");
      seedAgent(vault, "maya", MAYA, "You handle tax receipts only.");
      await store.start();

      const loaded = await loadAgentSessionPrompt(store, "coco", "/vault", { asked: true });

      expect(loaded).toEqual({
        slug: "coco",
        name: "Coco",
        prompt: buildAgentPrompt({
          agent: COCO,
          folder: "/vault/copilot/agents/coco",
          others: [MAYA],
          instruction: "You handle houseplant care only.",
          memory: "End with ACORN.",
          instructionsPath: "copilot/agents/coco/instructions.md",
        }),
        memoryPath: "/vault/copilot/agents/coco/MEMORY.md",
      });
      expect(loaded?.prompt).toContain("Save a rule to your memory only when");
      for (const ownChatOnly of ["ask_agent", "check_agent", "draft_agent", "list_chats"]) {
        expect(loaded?.prompt).not.toContain(ownChatOnly);
      }
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
      vault.deleteByHand("copilot/agents/coco/instructions.md");

      await expect(loadAgentSessionPrompt(store, "coco", "/vault")).resolves.toBeNull();
    });

    it("returns null when reading a just-moved folder fails (https://github.com/Brevilabs/obsidian-copilot-private/issues/937)", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
      await store.start();
      jest.spyOn(store, "loadForSession").mockRejectedValueOnce(new Error("ENOENT"));

      await expect(loadAgentSessionPrompt(store, "coco", "/vault")).resolves.toBeNull();
    });

    const SAVE_RULE: TeammatesSentence = "the rule that another agent's rule is not its to save";
    const ASK: TeammatesSentence = "the ask_agent sentence";
    const CONTROL: TeammatesSentence = "the check_agent, answer_agent and stop_agent sentence";
    const DRAFT: TeammatesSentence = "the draft_agent sentences";
    const LIST: TeammatesSentence = "the list_chats sentence";
    const SCOPE: TeammatesSentence = "the earlier-chats scope";
    const ONE_OTHER = ["Maya"];
    const TWO_OTHERS = ["Maya", "Leo"];
    const MATRIX = [
      { backendId: "claude", chat: "unlicensed", others: TWO_OTHERS, lines: [] },
      { backendId: "opencode", chat: "unlicensed", others: TWO_OTHERS, lines: [] },
      { backendId: "codex", chat: "unlicensed", others: TWO_OTHERS, lines: [] },
      { backendId: "claude", chat: "copilot", others: [], lines: [] },
      { backendId: "opencode", chat: "copilot", others: [], lines: [] },
      { backendId: "codex", chat: "copilot", others: [], lines: [DRAFT] },
      { backendId: "claude", chat: "copilot", others: ONE_OTHER, lines: [] },
      { backendId: "opencode", chat: "copilot", others: ONE_OTHER, lines: [] },
      { backendId: "codex", chat: "copilot", others: ONE_OTHER, lines: [ASK, CONTROL, DRAFT] },
      { backendId: "claude", chat: "copilot", others: TWO_OTHERS, lines: [] },
      { backendId: "opencode", chat: "copilot", others: TWO_OTHERS, lines: [] },
      { backendId: "codex", chat: "copilot", others: TWO_OTHERS, lines: [ASK, CONTROL, DRAFT] },
      { backendId: "claude", chat: "own", others: [], lines: [LIST, SCOPE] },
      { backendId: "opencode", chat: "own", others: [], lines: [LIST, SCOPE] },
      { backendId: "codex", chat: "own", others: [], lines: [LIST, SCOPE, DRAFT] },
      { backendId: "claude", chat: "own", others: ONE_OTHER, lines: [ASK, SAVE_RULE, LIST, SCOPE] },
      {
        backendId: "opencode",
        chat: "own",
        others: ONE_OTHER,
        lines: [ASK, SAVE_RULE, LIST, SCOPE],
      },
      {
        backendId: "codex",
        chat: "own",
        others: ONE_OTHER,
        lines: [ASK, SAVE_RULE, LIST, SCOPE, CONTROL, DRAFT],
      },
      {
        backendId: "claude",
        chat: "own",
        others: TWO_OTHERS,
        lines: [ASK, SAVE_RULE, LIST, SCOPE],
      },
      {
        backendId: "opencode",
        chat: "own",
        others: TWO_OTHERS,
        lines: [ASK, SAVE_RULE, LIST, SCOPE],
      },
      {
        backendId: "codex",
        chat: "own",
        others: TWO_OTHERS,
        lines: [ASK, SAVE_RULE, LIST, SCOPE, CONTROL, DRAFT],
      },
      { backendId: "claude", chat: "asked", others: [], lines: [] },
      { backendId: "opencode", chat: "asked", others: [], lines: [] },
      { backendId: "codex", chat: "asked", others: [], lines: [] },
      { backendId: "claude", chat: "asked", others: TWO_OTHERS, lines: [] },
      { backendId: "opencode", chat: "asked", others: TWO_OTHERS, lines: [] },
      { backendId: "codex", chat: "asked", others: TWO_OTHERS, lines: [] },
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
            new RegExp(`Other agents: [^\\n]*\\.\\n\\n${escapeRegExp(ASK_AGENTS)}\\n\\n`)
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
