import { buildAgentPrompt, loadAgentSessionPrompt } from "@/agents/agentSessionPrompt";
import { CustomAgentStore } from "@/agents/CustomAgentStore";
import { serializeInstructionsFile } from "@/agents/customAgentFiles";
import { buildMemorySaveRules } from "@/agents/memorySaveRules";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault, type FakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { setSettings } from "@/settings/model";

jest.mock("@/entitlement");

const COCO = { name: "Coco", title: "Houseplant carer" };
const MAYA = { name: "Maya", title: "Product critic" };

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
    });

    it("names the agent with its title", () => {
      expect(prompt).toContain(
        "In this chat you are Coco (Houseplant carer), a custom agent the user made in Copilot."
      );
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
      });

      expect(alone).toContain("Other agents: none.");
      expect(alone).not.toContain("ask_agent");
    });

    it("tells the agent in a chat of its own to ask another agent with ask_agent only when the user @-mentions or points to it (https://github.com/Brevilabs/obsidian-copilot-private/issues/944)", () => {
      const ownChat = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/agents/coco",
        others: [MAYA, { name: "Leo", title: "" }],
        instruction: "",
        memory: "",
        saveRules: { instructionsPath: "copilot/agents/coco/instructions.md" },
      });

      expect(ownChat).toContain(
        "Other agents: Maya (Product critic); Leo.\n\nWhen the user's message @-mentions one of them by name or clearly points to one, ask that agent with the ask_agent tool from obsidian-copilot; never otherwise."
      );
    });

    it("says nothing about ask_agent in a chat the agent was asked into, which has no save rules and no ask_agent (https://github.com/Brevilabs/obsidian-copilot-private/issues/944)", () => {
      expect(prompt).toContain("Other agents: Maya (Product critic); Leo.");
      expect(prompt).not.toContain("ask_agent");
    });

    it("tells the agent in a chat of its own, even with no other agents, to draft a new agent with draft_agent, to say first when it or another agent already handles the job, and that it can't create one (https://github.com/Brevilabs/obsidian-copilot-private/issues/941)", () => {
      const ownChat = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/agents/coco",
        others: [],
        instruction: "",
        memory: "",
        saveRules: { instructionsPath: "copilot/agents/coco/instructions.md" },
      });

      expect(ownChat).toContain(
        "When the user asks you to make a new agent, draft it with the draft_agent tool from obsidian-copilot, which shows them a card to review and create it. If you or another agent already handles that job, say so and ask before drafting. You can't create an agent yourself."
      );
    });

    it("says nothing about draft_agent in a chat the agent was asked into, which refuses it (https://github.com/Brevilabs/obsidian-copilot-private/issues/941)", () => {
      expect(prompt).not.toContain("draft_agent");
    });

    it("carries no memory save rules unless asked for them", () => {
      expect(prompt).not.toContain("Save a rule to your memory");
    });

    it("carries the memory save rules for its own MEMORY.md before the instruction when asked for them", () => {
      const withRules = buildAgentPrompt({
        agent: COCO,
        folder: "/vault/copilot/agents/coco",
        others: [],
        instruction: "",
        memory: "",
        saveRules: { instructionsPath: "copilot/agents/coco/instructions.md" },
      });

      expect(withRules).toContain(
        `${buildMemorySaveRules("/vault/copilot/agents/coco/MEMORY.md", "copilot/agents/coco/instructions.md")}\n\n<instruction>`
      );
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
          saveRules: { instructionsPath: "copilot/agents/coco/instructions.md" },
        }),
        memoryPath: "/vault/copilot/agents/coco/MEMORY.md",
      });
      expect(loaded?.prompt).not.toContain("name: Coco");
    });

    it("leaves out the save rules and the memory path for a caller that asks for none, such as a hidden session (https://github.com/Brevilabs/obsidian-copilot-private/issues/944)", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.", "End with ACORN.");
      await store.start();

      const loaded = await loadAgentSessionPrompt(store, "coco", "/vault", { saveRules: false });

      expect(loaded).toEqual({
        slug: "coco",
        name: "Coco",
        prompt: buildAgentPrompt({
          agent: COCO,
          folder: "/vault/copilot/agents/coco",
          others: [],
          instruction: "You handle houseplant care only.",
          memory: "End with ACORN.",
        }),
      });
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

    it("tells the agent's own chat about draft_agent while custom agents are available, and leaves it out of a hidden chat's prompt (https://github.com/Brevilabs/obsidian-copilot-private/issues/941)", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
      await store.start();

      const own = await loadAgentSessionPrompt(store, "coco", "/vault");
      const hidden = await loadAgentSessionPrompt(store, "coco", "/vault", { saveRules: false });

      expect(own?.prompt).toContain("draft it with the draft_agent tool from obsidian-copilot");
      expect(hidden?.prompt).not.toContain("draft_agent");
    });

    it("reads nothing and returns null while custom agents are hidden", async () => {
      seedAgent(vault, "coco", COCO, "You handle houseplant care only.");
      await store.start();
      await setCustomAgentsAccess("free");
      vault.touchedPaths.length = 0;

      await expect(loadAgentSessionPrompt(store, "coco", "/vault")).resolves.toBeNull();
      expect(vault.touchedPaths).toEqual([]);
    });
  });
});
