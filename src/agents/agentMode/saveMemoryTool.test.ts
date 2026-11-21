import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { fakeChat } from "@/agentMode/session/testing/fakeChat";
import type { BackendState, CopilotMode } from "@/agentMode/session/types";
import { localDate } from "@/agents/agentMemoryFile";
import {
  createSaveMemoryTool,
  SAVE_MEMORY_TOOL_NAME,
  type SaveMemoryCaller,
} from "@/agents/agentMode/saveMemoryTool";
import { AGENT_SETS, CHAT_LISTINGS, listingCases } from "@/agents/agentMode/testing/toolListings";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault, type FakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { AI_SENDER, USER_SENDER } from "@/constants";
import type { Vault } from "obsidian";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/988";
const COCO = {
  slug: "coco",
  name: "Coco",
  title: "Houseplant carer",
  memoryPath: "copilot/teammates/coco/MEMORY.md",
} as CustomAgent;
const MAYA = {
  slug: "maya",
  name: "Maya",
  title: "Product critic",
  memoryPath: "copilot/teammates/maya/MEMORY.md",
} as CustomAgent;
const WATER = "Water the ferns on Sundays.";
const SUNDAY_CONTEXT = "2026-11-01 · Asked to remember";
const MEETINGS = "Meeting notes are in meeting-notes/.";
const MEETINGS_CONTEXT = "2026-11-02 · Said while looking for notes";
const SAVED = "Saved. The chat shows the user each save, so don't announce it in your reply.";

function session(agentSlug: string | null, mode: CopilotMode | null = "default") {
  const store = new AgentMessageStore();
  store.addMessage({
    id: "u1",
    sender: USER_SENDER,
    message: "remember this",
    timestamp: null,
    isVisible: true,
  });
  store.addMessage({ id: "a1", sender: AI_SENDER, message: "", timestamp: null, isVisible: true });
  return {
    agentSlug,
    store,
    getState: () => ({ mode: { current: mode } }) as BackendState,
  };
}

function buildTool(
  options: {
    agents?: readonly CustomAgent[];
    caller?: SaveMemoryCaller | null;
    vault?: Vault;
  } = {}
) {
  const caller =
    options.caller === undefined ? { session: session("coco"), askedFrom: null } : options.caller;
  return createSaveMemoryTool({
    agents: () => options.agents ?? [COCO, MAYA],
    callerOf: (chat: ChatStateHost | null) => (chat ? caller : null),
    vault: options.vault ?? createFakeAgentVault().app.vault,
  });
}

function memory(howToWork: string[], whereToFind: string[] = []): string {
  return `## How to work\n\n${howToWork.join("\n\n")}\n\n## Where to find things\n\n${whereToFind.join("\n\n")}\n`;
}

describe("saveMemoryTool", () => {
  let vault: FakeAgentVault;
  let today: string;

  beforeEach(async () => {
    await setCustomAgentsAccess("team");
    vault = createFakeAgentVault();
    today = localDate(new Date());
  });

  describe("createSaveMemoryTool()", () => {
    describe("listedAs()", () => {
      it("describes the tool in one sentence and its arguments as what the model writes into each", () => {
        const listed = buildTool().listedAs?.(CHAT_LISTINGS["Coco's own chat"]) as unknown as {
          name: string;
          description: string;
          inputSchema: { properties: Record<string, { description: string }>; required: string[] };
        };

        expect(listed.name).toBe(SAVE_MEMORY_TOOL_NAME);
        expect(listed.description).toBe(
          "Save one rule, or where something lives in the vault, to your memory, or replace one in it."
        );
        expect(listed.inputSchema.required).toEqual(["rule", "why"]);
        expect(listed.inputSchema.properties.rule.description).toBe(
          'Write each rule as one plain sentence the user would agree with. If it only holds until a date, start with "Until YYYY-MM-DD:".'
        );
        expect(Object.keys(listed.inputSchema.properties)).toEqual([
          "rule",
          "why",
          "replaces",
          "contradicts",
        ]);
        expect(listed.inputSchema.properties.contradicts.description).toContain(
          "A rule that goes against your instruction is still saved when the user doesn't ask to change the instruction itself."
        );
      });

      it.each(
        listingCases({
          "a Copilot chat": [],
          "Coco's own chat": ["no agent", "only Coco", "Coco and Maya", "Coco, Maya and Leo"],
          "the chat Coco runs when asked": [
            "no agent",
            "only Coco",
            "Coco and Maya",
            "Coco, Maya and Leo",
          ],
          "OpenCode's shared folder listing": ["only Coco", "Coco and Maya", "Coco, Maya and Leo"],
        })
      )(
        `$label: it is offered wherever an agent may save, its own chat and the chat it runs when asked, and in a folder's shared listing while any agent exists (${ISSUE})`,
        ({ chat, agents, listed }) => {
          expect(
            buildTool({ agents: AGENT_SETS[agents] }).listedAs?.(CHAT_LISTINGS[chat])?.name ?? null
          ).toBe(listed ? SAVE_MEMORY_TOOL_NAME : null);
        }
      );

      it("leaves the tool out while custom agents aren't available", async () => {
        await setCustomAgentsAccess("free");

        expect(buildTool().listedAs?.(CHAT_LISTINGS["Coco's own chat"])).toBeNull();
      });
    });

    describe("promptHint", () => {
      it(`names the tool for a model that can't see its description (${ISSUE})`, () => {
        expect(buildTool().promptHint).toBe(
          "To save a rule to your memory, use the save_memory tool from obsidian-copilot."
        );
      });
    });

    describe("call()", () => {
      it("writes the rule to the calling agent's MEMORY.md, and keeps the save on the reply being written for the chat to draw", async () => {
        const coco = session("coco");
        const tool = buildTool({
          caller: { session: coco, askedFrom: null },
          vault: vault.app.vault,
        });

        const result = await tool.call({ rule: WATER, why: "Asked to remember" }, fakeChat());

        expect(result).toEqual({ text: SAVED, isError: false });
        expect(vault.readText(COCO.memoryPath)).toBe(`${WATER}\n${today} · Asked to remember\n`);
        expect(coco.store.getMessage("a1")?.memorySaves).toEqual([
          { rule: WATER, agentName: "Coco", memoryPath: COCO.memoryPath },
        ]);
      });

      it(`adds to the end of a memory file written with the current release's two headings, adding no heading and leaving the rest byte for byte (${ISSUE})`, async () => {
        vault.writeByHand(
          COCO.memoryPath,
          memory([`${WATER}\n${SUNDAY_CONTEXT}`], [`${MEETINGS}\n${MEETINGS_CONTEXT}`])
        );

        await buildTool({ vault: vault.app.vault }).call(
          { rule: "Receipts are in finance/.", why: "Said" },
          fakeChat()
        );

        expect(vault.readText(COCO.memoryPath)).toBe(
          `${memory([`${WATER}\n${SUNDAY_CONTEXT}`], [`${MEETINGS}\n${MEETINGS_CONTEXT}`])}\nReceipts are in finance/.\n${today} · Said\n`
        );
      });

      it(`replaces one rule in place and draws it as a replacement, leaving the others untouched (${ISSUE})`, async () => {
        vault.writeByHand(
          COCO.memoryPath,
          memory([`${WATER}\n${SUNDAY_CONTEXT}`], [`${MEETINGS}\n${MEETINGS_CONTEXT}`])
        );
        const coco = session("coco");

        const result = await buildTool({
          caller: { session: coco, askedFrom: null },
          vault: vault.app.vault,
        }).call(
          {
            rule: "Water the ferns on Saturdays.",
            why: "Corrected",
            replaces: WATER,
          },
          fakeChat()
        );

        expect(result).toEqual({ text: SAVED, isError: false });
        expect(vault.readText(COCO.memoryPath)).toBe(
          memory(
            [
              `Water the ferns on Saturdays.\n${today} · Replaces "${WATER}" (2026-11-01) · Corrected`,
            ],
            [`${MEETINGS}\n${MEETINGS_CONTEXT}`]
          )
        );
        expect(coco.store.getMessage("a1")?.memorySaves).toEqual([
          {
            rule: "Water the ferns on Saturdays.",
            replaced: WATER,
            agentName: "Coco",
            memoryPath: COCO.memoryPath,
          },
        ]);
      });

      it(`answers a rule to replace that isn't in the memory by naming it, saves nothing and flags no error (${ISSUE})`, async () => {
        const before = memory(
          [`${WATER}\n${SUNDAY_CONTEXT}`],
          [`${MEETINGS}\n${MEETINGS_CONTEXT}`]
        );
        vault.writeByHand(COCO.memoryPath, before);
        const coco = session("coco");

        const result = await buildTool({
          caller: { session: coco, askedFrom: null },
          vault: vault.app.vault,
        }).call(
          {
            rule: "Mist daily.",
            why: "Corrected",
            replaces: "Water weekly.",
          },
          fakeChat()
        );

        expect(result).toEqual({
          text: 'Nothing saved: your memory has no rule "Water weekly.".',
          isError: false,
        });
        expect(vault.readText(COCO.memoryPath)).toBe(before);
        expect(coco.store.getMessage("a1")?.memorySaves).toBeUndefined();
      });

      it(`saves a rule that goes against the instruction with the sentence it goes against, for the chat's warning (${ISSUE})`, async () => {
        const coco = session("coco");

        await buildTool({
          caller: { session: coco, askedFrom: null },
          vault: vault.app.vault,
        }).call(
          {
            rule: "Taxes are Leo's job now.",
            why: "Said while planning Q4",
            contradicts: "File quarterly estimated taxes.",
          },
          fakeChat()
        );

        expect(vault.readText(COCO.memoryPath)).toContain(
          `Taxes are Leo's job now.\n${today} · Said while planning Q4 · Contradicts instruction: "File quarterly estimated taxes."`
        );
        expect(coco.store.getMessage("a1")?.memorySaves).toEqual([
          {
            rule: "Taxes are Leo's job now.",
            contradicts: "File quarterly estimated taxes.",
            agentName: "Coco",
            memoryPath: COCO.memoryPath,
          },
        ]);
      });

      it(`saves a rule given to an asked agent to that agent's memory and keeps it on the asked chat's reply, which the asking chat relays (${ISSUE})`, async () => {
        const maya = session("maya");

        await buildTool({
          caller: { session: maya, askedFrom: session(null) },
          vault: vault.app.vault,
        }).call({ rule: "Lead with the budget.", why: "Told through Coco" }, fakeChat());

        expect(vault.readText(MAYA.memoryPath)).toContain("Lead with the budget.");
        expect(vault.readText(COCO.memoryPath)).toBeUndefined();
        expect(maya.store.getMessage("a1")?.memorySaves).toEqual([
          { rule: "Lead with the budget.", agentName: "Maya", memoryPath: MAYA.memoryPath },
        ]);
      });

      it.each([
        ["the chat is in Plan mode", { session: session("coco", "plan"), askedFrom: null }],
        [
          "the chat that asked the agent is in Plan mode",
          { session: session("coco"), askedFrom: session(null, "plan") },
        ],
      ])(
        `saves nothing and says it can't save in this mode when %s (${ISSUE})`,
        async (_when, caller) => {
          const result = await buildTool({ caller, vault: vault.app.vault }).call(
            { rule: WATER, why: "Asked" },
            fakeChat()
          );

          expect(result).toEqual({
            text: "Nothing saved: you can't save a rule in this mode. Tell the user.",
            isError: false,
          });
          expect(vault.listPaths()).toEqual([]);
          expect(caller.session.store.getMessage("a1")?.memorySaves).toBeUndefined();
        }
      );

      it.each([
        ["a Copilot chat in OpenCode's shared folder, which runs as no agent", session(null)],
        ["a chat whose agent was deleted", session("leo")],
      ])(`turns down %s without an error (${ISSUE})`, async (_chat, caller) => {
        const result = await buildTool({
          caller: { session: caller, askedFrom: null },
          vault: vault.app.vault,
        }).call({ rule: WATER, why: "Asked" }, fakeChat());

        expect(result).toEqual({
          text: "This chat has no memory to save to. Don't call save_memory again.",
          isError: false,
        });
        expect(vault.listPaths()).toEqual([]);
      });

      it("turns down a call Copilot can't trace to a chat", async () => {
        const result = await buildTool({ caller: null }).call({ rule: WATER, why: "Asked" }, null);

        expect(result.text).toBe(
          "This chat has no memory to save to. Don't call save_memory again."
        );
      });

      it("flags a call without a rule or why as an error and writes nothing", async () => {
        const tool = buildTool({ vault: vault.app.vault });

        for (const args of [{ why: "Asked" }, { rule: WATER }, { rule: " ", why: "Asked" }]) {
          await expect(tool.call(args, fakeChat())).resolves.toEqual({
            text: "rule and why must be non-empty strings.",
            isError: true,
          });
        }
        expect(vault.listPaths()).toEqual([]);
      });

      it("collapses line breaks in what it writes, so a rule stays on one line", async () => {
        await buildTool({ vault: vault.app.vault }).call(
          { rule: "Water the ferns\non Sundays.", why: " Asked\n" },
          fakeChat()
        );

        expect(vault.readText(COCO.memoryPath)).toContain(`${WATER}\n${today} · Asked\n`);
      });

      it("answers that Teammates isn't available while custom agents are locked", async () => {
        await setCustomAgentsAccess("free");

        await expect(
          buildTool({ vault: vault.app.vault }).call({ rule: WATER, why: "Asked" }, fakeChat())
        ).resolves.toEqual({
          text: "Copilot Teammates isn't available right now. Tell the user.",
          isError: false,
        });
        expect(vault.listPaths()).toEqual([]);
      });

      it(`keeps both rules when a model saves two at once into a memory that doesn't exist yet (${ISSUE})`, async () => {
        const fake = vault.app.vault;
        let finishCreating!: () => void;
        const creating = new Promise<void>((resolve) => (finishCreating = resolve));
        const slowCreate = Object.assign(Object.create(fake) as Vault, {
          create: async (path: string, text: string) => {
            const exists = fake.getAbstractFileByPath(path) !== null;
            await creating;
            if (exists) throw new Error("File already exists.");
            vault.writeByHand(path, text);
            return fake.getAbstractFileByPath(path);
          },
        });
        const tool = buildTool({ vault: slowCreate });

        const saves = Promise.all([
          tool.call({ rule: WATER, why: "Asked" }, fakeChat()),
          tool.call({ rule: MEETINGS, why: "Said" }, fakeChat()),
        ]);
        finishCreating();

        await expect(saves).resolves.toEqual([
          { text: SAVED, isError: false },
          { text: SAVED, isError: false },
        ]);
        expect(vault.readText(COCO.memoryPath)).toBe(
          `${WATER}\n${today} · Asked\n\n${MEETINGS}\n${today} · Said\n`
        );
      });

      it("flags a failed write as an error and keeps no save", async () => {
        const coco = session("coco");
        const failing = {
          getAbstractFileByPath: () => null,
          create: async () => {
            throw new Error("Folder is gone.");
          },
        } as unknown as Vault;

        const result = await buildTool({
          caller: { session: coco, askedFrom: null },
          vault: failing,
        }).call({ rule: WATER, why: "Asked" }, fakeChat());

        expect(result).toEqual({ text: "Couldn't save: Folder is gone.", isError: true });
        expect(coco.store.getMessage("a1")?.memorySaves).toBeUndefined();
      });
    });
  });
});
