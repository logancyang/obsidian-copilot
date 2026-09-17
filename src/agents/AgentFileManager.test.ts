import { AgentFileManager } from "@/agents/AgentFileManager";
import { serializeAgentFile } from "@/agents/agentFile";
import type { AgentDraft, CustomAgent } from "@/agents/types";
import { trashFile } from "@/utils/vaultAdapterUtils";
import { App, TFile, TFolder } from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({ getSettings: () => ({ copilotFolder: "copilot" }) }));
jest.mock("@/utils", () => ({ ensureFolderExists: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  trashFile: jest.fn().mockResolvedValue(undefined),
}));

const AGENTS_ROOT = "copilot/agents";

/** Fixed mtime for every seeded file, so memory-timestamp assertions are exact. */
const MEMORY_MTIME_MS = new Date(2026, 8, 14, 15, 0, 0).getTime();

// The Obsidian mock's TFile/TFolder take a path; the published types do not.
const FileCtor = TFile as unknown as new (path: string) => TFile;
const FolderCtor = TFolder as unknown as new (path: string) => TFolder;

const DRAFT: AgentDraft = {
  name: "Jennifer",
  icon: "🪶",
  description: "Skeptical editor. Cuts fluff, argues for the reader.",
  instructions: "You are Jennifer, a developmental editor.\n",
  backendId: "claude",
  modelId: null,
  effort: null,
  memoryEnabled: true,
};

/**
 * Minimal in-memory stand-in for the parts of the vault the manager touches:
 * a path→content map with folders materialized from the paths that exist.
 */
class FakeVault {
  public readonly files = new Map<string, string>();
  public readonly folders = new Set<string>([AGENTS_ROOT]);

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    if (this.files.has(path)) {
      const file = new FileCtor(path);
      // The list row reports memory size, which the real TFile carries in `stat`.
      (file as unknown as { stat: { size: number; mtime: number } }).stat = {
        size: Buffer.byteLength(this.files.get(path) ?? "", "utf8"),
        mtime: MEMORY_MTIME_MS,
      };
      return file;
    }
    if (!this.folders.has(path)) return null;
    const folder = new FolderCtor(path);
    const prefix = `${path}/`;
    const childFolders = [...this.folders]
      .filter(
        (candidate) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/")
      )
      .map((candidate) => new FolderCtor(candidate));
    const childFiles = [...this.files.keys()]
      .filter(
        (candidate) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/")
      )
      .map((candidate) => new FileCtor(candidate));
    folder.children = [...childFolders, ...childFiles];
    return folder;
  }

  create(path: string, content: string): Promise<TFile> {
    if (this.files.has(path)) return Promise.reject(new Error(`File already exists: ${path}`));
    this.files.set(path, content);
    return Promise.resolve(new FileCtor(path));
  }

  modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
    return Promise.resolve();
  }

  read(file: TFile): Promise<string> {
    const content = this.files.get(file.path);
    if (content === undefined) return Promise.reject(new Error(`Not found: ${file.path}`));
    return Promise.resolve(content);
  }

  /** Seed an agent folder the way a previous create (or a hand edit) would leave it. */
  seedAgent(slug: string, agent: Partial<CustomAgent> & { name: string }, memory = ""): void {
    this.folders.add(`${AGENTS_ROOT}/${slug}`);
    this.files.set(
      `${AGENTS_ROOT}/${slug}/agent.md`,
      serializeAgentFile({
        slug,
        description: "",
        icon: "",
        backendId: null,
        modelId: null,
        effort: null,
        memoryEnabled: true,
        created: "2026-01-01T00:00:00Z",
        instructions: "",
        ...agent,
      })
    );
    this.files.set(`${AGENTS_ROOT}/${slug}/MEMORY.md`, memory);
  }
}

function buildManager(): { manager: AgentFileManager; vault: FakeVault } {
  const vault = new FakeVault();
  const app = { vault } as unknown as App;
  return { manager: new AgentFileManager(app), vault };
}

describe("AgentFileManager", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("createAgent()", () => {
    it("writes agent.md and a MEMORY.md skeleton under a folder named after the agent", async () => {
      const { manager, vault } = buildManager();

      const record = await manager.createAgent(DRAFT);

      expect(record.folderPath).toBe("copilot/agents/jennifer");
      expect(record.filePath).toBe("copilot/agents/jennifer/agent.md");
      expect(record.memoryPath).toBe("copilot/agents/jennifer/MEMORY.md");
      expect(vault.files.get(record.filePath)).toContain("copilot-agent-name: Jennifer");
      expect(vault.files.get(record.filePath)).toContain(
        "You are Jennifer, a developmental editor."
      );
      expect(vault.files.get(record.memoryPath)).toBe(
        "# Jennifer's memory\n\n## About the user\n\n## Preferences and standing requests\n\n## Ongoing threads\n\n## Facts and decisions\n"
      );
    });

    it("stamps a creation timestamp on the new record", async () => {
      const { manager } = buildManager();
      const record = await manager.createAgent(DRAFT);
      expect(Number.isNaN(Date.parse(record.agent.created))).toBe(false);
    });

    it("suffixes the folder when another agent already owns the derived slug", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });

      const record = await manager.createAgent(DRAFT);

      expect(record.agent.slug).toBe("jennifer-2");
      expect(vault.files.has("copilot/agents/jennifer/agent.md")).toBe(true);
      expect(vault.files.has("copilot/agents/jennifer-2/agent.md")).toBe(true);
    });

    it("refuses a blank name instead of creating a folder called '_'", async () => {
      const { manager, vault } = buildManager();
      await expect(manager.createAgent({ ...DRAFT, name: "   " })).rejects.toThrow(
        "Give the agent a name."
      );
      expect(vault.files.size).toBe(0);
    });
  });

  describe("listAgents()", () => {
    it("returns every agent folder that has an agent.md, ordered by display name", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("vancat", { name: "Vancat" });
      vault.seedAgent("jennifer", { name: "Jennifer" });

      const records = await manager.listAgents();

      expect(records.map((record) => record.agent.name)).toEqual(["Jennifer", "Vancat"]);
    });

    it("reports each agent's memory size so the list can show it", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "x".repeat(300));

      const [record] = await manager.listAgents();

      expect(record.memoryBytes).toBe(300);
    });

    it("skips a folder that has no agent.md rather than listing a nameless agent", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.folders.add(`${AGENTS_ROOT}/half-made`);

      const records = await manager.listAgents();

      expect(records.map((record) => record.agent.slug)).toEqual(["jennifer"]);
    });

    it("returns nothing when the agents folder does not exist yet", async () => {
      const { manager, vault } = buildManager();
      vault.folders.delete(AGENTS_ROOT);
      await expect(manager.listAgents()).resolves.toEqual([]);
    });
  });

  describe("readAgent()", () => {
    it("returns the agent its folder holds", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer", description: "Skeptical editor." });

      const record = await manager.readAgent("jennifer");

      expect(record?.agent.name).toBe("Jennifer");
      expect(record?.agent.description).toBe("Skeptical editor.");
    });

    it("returns null for a slug with no folder", async () => {
      const { manager } = buildManager();
      await expect(manager.readAgent("nobody")).resolves.toBeNull();
    });
  });

  describe("readMemoryDocument()", () => {
    it("returns the memory file's text with the time it was last written", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "# Jennifer's memory\n");
      await expect(manager.readMemoryDocument("jennifer")).resolves.toEqual({
        text: "# Jennifer's memory\n",
        modifiedAtMs: MEMORY_MTIME_MS,
      });
    });

    it("returns null when the memory file is absent", async () => {
      const { manager } = buildManager();
      await expect(manager.readMemoryDocument("nobody")).resolves.toBeNull();
    });
  });

  describe("updateAgent()", () => {
    it("writes the edited fields back to the same agent.md", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer", description: "Old line." });

      const record = await manager.updateAgent("jennifer", { ...DRAFT, description: "New line." });

      expect(record.agent.description).toBe("New line.");
      expect(vault.files.get("copilot/agents/jennifer/agent.md")).toContain(
        "copilot-agent-description: New line."
      );
    });

    // designdocs/CUSTOM_AGENTS.md §1: the folder name is the stable id, so a
    // display-name change must not move it — saved chats resolve by slug.
    it("leaves the folder where it is when the display name changes", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });

      const record = await manager.updateAgent("jennifer", { ...DRAFT, name: "Jen" });

      expect(record.agent.slug).toBe("jennifer");
      expect(record.folderPath).toBe("copilot/agents/jennifer");
      expect(vault.files.has("copilot/agents/jen/agent.md")).toBe(false);
      expect(vault.files.get("copilot/agents/jennifer/agent.md")).toContain(
        "copilot-agent-name: Jen"
      );
    });

    it("preserves the original creation timestamp across an edit", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });

      const record = await manager.updateAgent("jennifer", DRAFT);

      expect(record.agent.created).toBe("2026-01-01T00:00:00Z");
    });

    it("rejects an edit to an agent that is no longer on disk", async () => {
      const { manager } = buildManager();
      await expect(manager.updateAgent("nobody", DRAFT)).rejects.toThrow("Agent not found: nobody");
    });

    it("refuses to clear the name of an existing agent", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      await expect(manager.updateAgent("jennifer", { ...DRAFT, name: "" })).rejects.toThrow(
        "Give the agent a name."
      );
    });
  });

  describe("deleteAgent()", () => {
    it("moves the whole agent folder to trash, memory file included", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "remembered things");

      await manager.deleteAgent("jennifer");

      expect(trashFile).toHaveBeenCalledTimes(1);
      const trashed = (trashFile as jest.Mock).mock.calls[0][1] as { path: string };
      expect(trashed.path).toBe("copilot/agents/jennifer");
    });

    it("does nothing for an agent that is already gone, since the outcome already holds", async () => {
      const { manager } = buildManager();
      await expect(manager.deleteAgent("nobody")).resolves.toBeUndefined();
      expect(trashFile).not.toHaveBeenCalled();
    });
  });

  describe("writeMemory()", () => {
    it("replaces the memory file with what the agent returned and reports the path", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "- old note\n");

      const path = await manager.writeMemory("jennifer", "# Jennifer's memory\n\n- new note\n");

      expect(path).toBe("copilot/agents/jennifer/MEMORY.md");
      expect(vault.files.get(path)).toContain("new note");
      expect(vault.files.get(path)).not.toContain("old note");
    });

    it("recreates the memory file when the user had deleted it", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.files.delete("copilot/agents/jennifer/MEMORY.md");

      await manager.writeMemory("jennifer", "# Jennifer's memory\n");

      expect(vault.files.get("copilot/agents/jennifer/MEMORY.md")).toContain("Jennifer's memory");
    });
  });

  describe("clearMemory()", () => {
    it("replaces the memory file with the empty skeleton", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "- (2026-09-10) Writes a newsletter.\n");

      await manager.clearMemory("jennifer");

      const memory = vault.files.get("copilot/agents/jennifer/MEMORY.md");
      expect(memory).toContain("# Jennifer's memory");
      expect(memory).toContain("## About the user");
      expect(memory).not.toContain("newsletter");
    });

    it("recreates the memory file when the user had deleted it", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.files.delete("copilot/agents/jennifer/MEMORY.md");

      await manager.clearMemory("jennifer");

      expect(vault.files.get("copilot/agents/jennifer/MEMORY.md")).toContain("# Jennifer's memory");
    });

    it("rejects clearing memory for an agent that is no longer on disk", async () => {
      const { manager } = buildManager();
      await expect(manager.clearMemory("nobody")).rejects.toThrow("Agent not found: nobody");
    });
  });
});
