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

  /** Seed one day of daily notes, as a flush or the agent itself would leave it. */
  seedDailyNote(slug: string, date: string, text: string): void {
    this.folders.add(`${AGENTS_ROOT}/${slug}/memory`);
    this.files.set(`${AGENTS_ROOT}/${slug}/memory/${date}.md`, text);
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

  describe("readMemoryDocument()", () => {
    it("splits the consolidation marker from the body and hashes what it read", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent(
        "jennifer",
        { name: "Jennifer" },
        "---\nconsolidated-through: 2026-09-16\n---\n\n# Jennifer's memory\n"
      );

      const read = await manager.readMemoryDocument("jennifer");

      expect(read?.body).toBe("# Jennifer's memory\n");
      expect(read?.consolidatedThrough).toBe("2026-09-16");
      expect(read?.modifiedAtMs).toBe(MEMORY_MTIME_MS);
      expect(read?.hash).toEqual(expect.any(String));
    });

    // designdocs/CUSTOM_AGENTS.md §5: files written before consolidation
    // existed carry no frontmatter and must still load.
    it("loads a memory file that has no frontmatter as never consolidated", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "# Jennifer's memory\n");

      const read = await manager.readMemoryDocument("jennifer");

      expect(read?.body).toBe("# Jennifer's memory\n");
      expect(read?.consolidatedThrough).toBeNull();
    });

    it("reports nothing for an agent whose memory file the user deleted", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.files.delete("copilot/agents/jennifer/MEMORY.md");

      expect(await manager.readMemoryDocument("jennifer")).toBeNull();
      expect(await manager.readMemoryDocument("nobody")).toBeNull();
    });
  });

  describe("readDailyNote()", () => {
    it("reads one day of notes with where it lives, so a trust line can offer it", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.seedDailyNote("jennifer", "2026-09-17", "# 2026-09-17\n");

      expect(await manager.readDailyNote("jennifer", "2026-09-17")).toEqual({
        date: "2026-09-17",
        path: "copilot/agents/jennifer/memory/2026-09-17.md",
        text: "# 2026-09-17\n",
        modifiedAtMs: MEMORY_MTIME_MS,
      });
    });

    it("reports nothing for a day the agent has not written to", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });

      expect(await manager.readDailyNote("jennifer", "2026-09-17")).toBeNull();
    });
  });

  describe("listDailyNoteDates()", () => {
    it("lists the days the agent has notes for, oldest first", () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.seedDailyNote("jennifer", "2026-09-17", "a");
      vault.seedDailyNote("jennifer", "2026-09-15", "b");

      expect(manager.listDailyNoteDates("jennifer")).toEqual(["2026-09-15", "2026-09-17"]);
    });

    // designdocs/CUSTOM_AGENTS.md §5: `memory/` is an ordinary vault folder the
    // user may keep their own notes in.
    it("skips a file in the folder whose name is not a day", () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.seedDailyNote("jennifer", "2026-09-17", "a");
      vault.files.set("copilot/agents/jennifer/memory/scratch.md", "mine");

      expect(manager.listDailyNoteDates("jennifer")).toEqual(["2026-09-17"]);
    });

    it("reports none for an agent that has never written a note", () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });

      expect(manager.listDailyNoteDates("jennifer")).toEqual([]);
    });
  });

  describe("readDailyNotesAfter()", () => {
    it("reads only the days a consolidation has left to fold in", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.seedDailyNote("jennifer", "2026-09-15", "old");
      vault.seedDailyNote("jennifer", "2026-09-16", "newer");
      vault.seedDailyNote("jennifer", "2026-09-17", "newest");

      expect(await manager.readDailyNotesAfter("jennifer", "2026-09-15")).toEqual([
        { date: "2026-09-16", text: "newer" },
        { date: "2026-09-17", text: "newest" },
      ]);
    });

    it("reads every day when the agent has never consolidated", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.seedDailyNote("jennifer", "2026-09-15", "old");

      expect(await manager.readDailyNotesAfter("jennifer", null)).toEqual([
        { date: "2026-09-15", text: "old" },
      ]);
    });

    it("skips an empty day, so a stray file does not count as work to fold in", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.seedDailyNote("jennifer", "2026-09-17", "  \n");

      expect(await manager.readDailyNotesAfter("jennifer", null)).toEqual([]);
    });
  });

  describe("appendDailyNote()", () => {
    const section = "## 09:40 Newsletter\n\n- Renamed to Grid Notes.\n";

    it("starts a new day's note, titled with its date (CUSTOM_AGENTS.md §5)", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });

      const path = await manager.appendDailyNote("jennifer", "2026-09-17", section);

      expect(path).toBe("copilot/agents/jennifer/memory/2026-09-17.md");
      expect(vault.files.get(path)).toBe(`# 2026-09-17\n\n${section}`);
    });

    it("adds a second heading to a day that already has one", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.seedDailyNote("jennifer", "2026-09-17", "# 2026-09-17\n\n## 08:00 Earlier\n\n- old\n");

      await manager.appendDailyNote("jennifer", "2026-09-17", section);

      const note = vault.files.get("copilot/agents/jennifer/memory/2026-09-17.md");
      expect(note).toContain("## 08:00 Earlier");
      expect(note).toContain("## 09:40 Newsletter");
    });
  });

  describe("writeConsolidatedMemory()", () => {
    const body = "# Jennifer's memory\n\n## About the user\n- (2026-09-17) Writes.\n";

    it("writes the consolidated body with the marker the next pass reads", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "old\n");
      const before = await manager.readMemoryDocument("jennifer");

      const result = await manager.writeConsolidatedMemory(
        "jennifer",
        body,
        "2026-09-17",
        before!.hash
      );

      expect(result).toBe("written");
      const written = vault.files.get("copilot/agents/jennifer/MEMORY.md");
      expect(written).toContain("consolidated-through: 2026-09-17");
      expect(written).toContain("Writes.");
    });

    // designdocs/CUSTOM_AGENTS.md §5: the user's edits are always the new
    // baseline, so a file edited while the pass ran is left exactly as it is.
    it("discards the pass when the user edited MEMORY.md while it ran", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "old\n");
      const before = await manager.readMemoryDocument("jennifer");
      vault.files.set("copilot/agents/jennifer/MEMORY.md", "the user's own edit\n");

      const result = await manager.writeConsolidatedMemory(
        "jennifer",
        body,
        "2026-09-17",
        before!.hash
      );

      expect(result).toBe("conflict");
      expect(vault.files.get("copilot/agents/jennifer/MEMORY.md")).toBe("the user's own edit\n");
    });

    it("treats a memory file deleted mid-pass as a conflict rather than resurrecting it", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" }, "old\n");
      const before = await manager.readMemoryDocument("jennifer");
      vault.files.delete("copilot/agents/jennifer/MEMORY.md");

      expect(
        await manager.writeConsolidatedMemory("jennifer", body, "2026-09-17", before!.hash)
      ).toBe("conflict");
      expect(vault.files.has("copilot/agents/jennifer/MEMORY.md")).toBe(false);
    });

    it("creates the file when the pass was handed no file to begin with", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.files.delete("copilot/agents/jennifer/MEMORY.md");

      expect(await manager.writeConsolidatedMemory("jennifer", body, "2026-09-17", null)).toBe(
        "written"
      );
      expect(vault.files.get("copilot/agents/jennifer/MEMORY.md")).toContain("Writes.");
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

    // designdocs/CUSTOM_AGENTS.md §5: clearing only the core would leave the
    // next consolidation to write it straight back from the daily notes.
    it("also moves the daily-notes folder to trash", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });
      vault.seedDailyNote("jennifer", "2026-09-17", "- Renamed the newsletter.\n");

      await manager.clearMemory("jennifer");

      expect(trashFile).toHaveBeenCalledTimes(1);
      const trashed = (trashFile as jest.Mock).mock.calls[0][1] as { path: string };
      expect(trashed.path).toBe("copilot/agents/jennifer/memory");
    });

    it("leaves the trash alone for an agent that has never written a note", async () => {
      const { manager, vault } = buildManager();
      vault.seedAgent("jennifer", { name: "Jennifer" });

      await manager.clearMemory("jennifer");

      expect(trashFile).not.toHaveBeenCalled();
    });

    it("rejects clearing memory for an agent that is no longer on disk", async () => {
      const { manager } = buildManager();
      await expect(manager.clearMemory("nobody")).rejects.toThrow("Agent not found: nobody");
    });
  });
});
