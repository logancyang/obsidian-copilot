import { App, parseYaml, Vault } from "obsidian";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import {
  getCachedProjectRecords,
  isPendingFileWrite,
  updateCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("obsidian", () => {
  const actual = jest.requireActual<typeof import("obsidian")>("obsidian");
  return Object.assign({}, actual, {
    stringifyYaml: jest.requireActual<typeof import("yaml")>("yaml").stringify,
  });
});

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ copilotFolder: "vault-copilot" })),
  updateSetting: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ...jest.requireActual<typeof import("@/utils")>("@/utils"),
  ensureFolderExists: jest.fn(async () => {}),
}));

jest.mock("@/projects/projectMigration", () => ({
  ensureProjectsMigratedIfNeeded: jest.fn(async () => {}),
}));

function makeConfig(
  overrides: { id: string; name: string } & Partial<ProjectConfig>
): ProjectConfig {
  return {
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
    ...overrides,
  };
}

function seedProject(config: ProjectConfig, folderName: string): void {
  upsertCachedProjectRecord({
    project: config,
    filePath: `vault-copilot/projects/${folderName}/project.md`,
    folderName,
  });
}

interface TestVault {
  app: App;
  vault: jest.Mocked<Vault>;
  frontmatter: Record<string, unknown>;
}

function makeTestVault(
  options: { existingPaths?: string[]; hiddenFolder?: boolean; files?: Map<string, string> } = {}
): TestVault {
  const frontmatter: Record<string, unknown> = {};
  const vault = {
    create: jest.fn(async (path: string) => mockTFile({ path })),
    getAbstractFileByPath: jest.fn((path: string) =>
      options.hiddenFolder ? null : path.endsWith(".md") ? mockTFile({ path }) : {}
    ),
    adapter: {
      exists: jest.fn(
        async (path: string) =>
          options.existingPaths?.includes(path) || (options.files?.has(path) ?? false)
      ),
      read: jest.fn(async (path: string) => options.files?.get(path) ?? ""),
      stat: jest.fn(async () => ({ ctime: 1, mtime: 1, size: 1 })),
      write: jest.fn(async (path: string, data: string) => {
        options.files?.set(path, data);
      }),
      list: jest.fn(async () => ({ files: [], folders: [] })),
      rmdir: jest.fn(async () => {}),
      remove: jest.fn(async () => {}),
    },
  } as unknown as jest.Mocked<Vault>;
  const app = {
    vault,
    fileManager: {
      processFrontMatter: jest.fn(
        async (_file: unknown, update: (value: Record<string, unknown>) => void) =>
          update(frontmatter)
      ),
      trashFile: jest.fn(async () => {}),
    },
  } as unknown as App;
  return { app, vault, frontmatter };
}

function resetSingleton() {
  (ProjectFileManager as unknown as Record<string, unknown>)["instance"] = undefined;
}

describe("ProjectFileManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
    updateCachedProjectRecords([]);
  });

  describe("updateProject()", () => {
    it("keeps frontmatter Copilot does not own when a hidden project is edited for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const filePath = "vault-copilot/projects/My Project/project.md";
      const files = new Map([
        [
          filePath,
          [
            "---",
            "copilot-project-id: p1",
            "copilot-project-name: My Project",
            "copilot-project-temperature: 0.7",
            "tags:",
            "  - research",
            '  - "b: c"',
            "note: 'say \"hi\"'",
            "---",
            "Old prompt",
          ].join("\n"),
        ],
      ]);
      const { app } = makeTestVault({ hiddenFolder: true, files });
      seedProject(
        makeConfig({ id: "p1", name: "My Project", modelConfigs: { temperature: 0.7 } }),
        "My Project"
      );

      await ProjectFileManager.getInstance(app).updateProject(
        "p1",
        makeConfig({ id: "p1", name: "My Project", systemPrompt: "New prompt" })
      );

      const [, yamlBlock, body] = files.get(filePath)!.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)!;
      expect(parseYaml(yamlBlock)).toMatchObject({
        "copilot-project-id": "p1",
        "copilot-project-name": "My Project",
        tags: ["research", "b: c"],
        note: 'say "hi"',
      });
      expect(parseYaml(yamlBlock)).not.toHaveProperty("copilot-project-temperature");
      expect(body).toBe("New prompt");
    });
  });

  describe("createProject()", () => {
    it("creates project.md in a folder named after the project and caches the new record", async () => {
      const { app, vault, frontmatter } = makeTestVault();
      const manager = ProjectFileManager.getInstance(app);

      const record = await manager.createProject(
        makeConfig({ id: "p1", name: "My Project", systemPrompt: "Cite every source." })
      );

      const filePath = "vault-copilot/projects/My Project/project.md";
      expect(vault.create).toHaveBeenCalledWith(filePath, "Cite every source.");
      expect(frontmatter).toMatchObject({
        "copilot-project-id": "p1",
        "copilot-project-name": "My Project",
      });
      expect(record).toMatchObject({ filePath, folderName: "My Project" });
      expect(getCachedProjectRecords()).toEqual([record]);
      expect(isPendingFileWrite(filePath)).toBe(false);
    });

    it("names the project folder after its id when the name is empty", async () => {
      const { app } = makeTestVault();
      const manager = ProjectFileManager.getInstance(app);

      const record = await manager.createProject(makeConfig({ id: "p1", name: "" }));

      expect(record.folderName).toBe("p1");
    });

    it("rejects a project whose name matches an existing project case-insensitively", async () => {
      seedProject(makeConfig({ id: "existing", name: "My Project" }), "existing");
      const manager = ProjectFileManager.getInstance(makeTestVault().app);

      await expect(
        manager.createProject(makeConfig({ id: "new-project", name: "my project" }))
      ).rejects.toThrow(/already exists/i);
      expect(getCachedProjectRecords()).toHaveLength(1);
    });

    it("rejects a project whose id is already in use", async () => {
      seedProject(makeConfig({ id: "p1", name: "First" }), "First");
      const manager = ProjectFileManager.getInstance(makeTestVault().app);

      await expect(manager.createProject(makeConfig({ id: "p1", name: "Second" }))).rejects.toThrow(
        "Project id already exists: p1"
      );
    });

    it.each([[""], ["   "]])("rejects the blank project id %j", async (id) => {
      const manager = ProjectFileManager.getInstance(makeTestVault().app);

      await expect(manager.createProject(makeConfig({ id, name: "Valid Name" }))).rejects.toThrow(
        /cannot be empty/i
      );
    });

    it("rejects a name whose sanitized folder collides with another project's folder", async () => {
      seedProject(makeConfig({ id: "first", name: "a/b" }), "a_b");
      const { app, vault } = makeTestVault();
      const manager = ProjectFileManager.getInstance(app);

      await expect(
        manager.createProject(makeConfig({ id: "second", name: "a|b" }))
      ).rejects.toThrow(/Folder name collision/);
      expect(vault.create).not.toHaveBeenCalled();
    });

    it("refuses to overwrite a project.md that already exists on disk", async () => {
      const filePath = "vault-copilot/projects/My Project/project.md";
      const { app, vault } = makeTestVault({ existingPaths: [filePath] });
      const manager = ProjectFileManager.getInstance(app);

      await expect(
        manager.createProject(makeConfig({ id: "p1", name: "My Project" }))
      ).rejects.toThrow(/already exists/i);
      expect(vault.create).not.toHaveBeenCalled();
      expect(getCachedProjectRecords()).toEqual([]);
      expect(isPendingFileWrite(filePath)).toBe(false);
    });

    it("writes project frontmatter directly when the project folder is hidden from the vault index for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const { app, vault } = makeTestVault({ hiddenFolder: true });
      const manager = ProjectFileManager.getInstance(app);

      const record = await manager.createProject(
        makeConfig({ id: "agent-memory", name: "Agent Memory Research", systemPrompt: "Research" })
      );

      expect(record.filePath).toBe("vault-copilot/projects/Agent Memory Research/project.md");
      expect(vault.create).not.toHaveBeenCalled();
      expect(vault.adapter.write).toHaveBeenCalledWith(
        record.filePath,
        expect.stringContaining("copilot-project-id: agent-memory")
      );
      expect(vault.adapter.write).toHaveBeenCalledWith(
        record.filePath,
        expect.stringContaining("Research")
      );
    });

    it("removes the empty project folder when writing a hidden project file fails for https://github.com/logancyang/obsidian-copilot/issues/3075", async () => {
      const folderPath = "vault-copilot/projects/Failed Project";
      const { app, vault } = makeTestVault({ hiddenFolder: true, existingPaths: [folderPath] });
      (vault.adapter.write as jest.Mock).mockRejectedValue(new Error("disk full"));
      const manager = ProjectFileManager.getInstance(app);

      await expect(
        manager.createProject(makeConfig({ id: "failed", name: "Failed Project" }))
      ).rejects.toThrow("disk full");

      expect(vault.adapter.rmdir).toHaveBeenCalledWith(folderPath, true);
    });
  });
});
