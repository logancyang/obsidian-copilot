import { App, Vault } from "obsidian";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import {
  getCachedProjectRecords,
  isPendingFileWrite,
  updateCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { mockTFile } from "@/__tests__/mockObsidian";

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

function makeTestVault(options: { existingPaths?: string[] } = {}): TestVault {
  const frontmatter: Record<string, unknown> = {};
  const vault = {
    create: jest.fn(async (path: string) => mockTFile({ path })),
    getAbstractFileByPath: jest.fn(() => null),
    read: jest.fn(async () => "---\ncopilot-project-id: p1\n---\n"),
    modify: jest.fn(async () => {}),
    adapter: {
      exists: jest.fn(async (path: string) => options.existingPaths?.includes(path) ?? false),
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
  });

  describe("setProjectArchived()", () => {
    const FILE_PATH = "vault-copilot/projects/My Project/project.md";

    function seedArchivable(config: Partial<ProjectConfig> = {}) {
      seedProject(makeConfig({ id: "p1", name: "My Project", ...config }), "My Project");
      const testVault = makeTestVault();
      testVault.vault.getAbstractFileByPath.mockReturnValue(mockTFile({ path: FILE_PATH }));
      return testVault;
    }

    it("stamps copilot-project-archived-at on project.md and caches the project as archived", async () => {
      const { app, frontmatter } = seedArchivable();
      const before = Date.now();

      await ProjectFileManager.getInstance(app).setProjectArchived("p1", true);

      const archivedAt = getCachedProjectRecords()[0].project.archivedAt!;
      expect(archivedAt).toBeGreaterThanOrEqual(before);
      expect(frontmatter["copilot-project-archived-at"]).toBe(archivedAt);
      expect(isPendingFileWrite(FILE_PATH)).toBe(false);
    });

    it("removes the archive property and the cached archivedAt when the project is unarchived", async () => {
      const { app, frontmatter } = seedArchivable({ archivedAt: 5_000 });
      frontmatter["copilot-project-archived-at"] = 5_000;
      frontmatter["copilot-project-name"] = "My Project";

      await ProjectFileManager.getInstance(app).setProjectArchived("p1", false);

      expect(frontmatter).toEqual({ "copilot-project-name": "My Project" });
      expect(getCachedProjectRecords()[0].project.archivedAt).toBeUndefined();
    });

    it("keeps a last-used timestamp cached while the archive write was in flight", async () => {
      const { app } = seedArchivable();
      (app.fileManager.processFrontMatter as jest.Mock).mockImplementationOnce(async () => {
        const [{ project, ...rest }] = getCachedProjectRecords();
        upsertCachedProjectRecord({ ...rest, project: { ...project, UsageTimestamps: 9_000 } });
      });

      await ProjectFileManager.getInstance(app).setProjectArchived("p1", true);

      expect(getCachedProjectRecords()[0].project).toMatchObject({ UsageTimestamps: 9_000 });
      expect(getCachedProjectRecords()[0].project.archivedAt).toBeDefined();
    });

    it("does not re-add a project deleted while the archive write was in flight", async () => {
      const { app } = seedArchivable();
      (app.fileManager.processFrontMatter as jest.Mock).mockImplementationOnce(async () => {
        updateCachedProjectRecords([]);
      });

      await ProjectFileManager.getInstance(app).setProjectArchived("p1", true);

      expect(getCachedProjectRecords()).toEqual([]);
    });

    it("rejects a project that is not in the cache", async () => {
      const { app } = makeTestVault();

      await expect(
        ProjectFileManager.getInstance(app).setProjectArchived("ghost", true)
      ).rejects.toThrow("Project not found: ghost");
    });
  });

  describe("updateProject()", () => {
    it("keeps a project archived when it is edited with a config that has no archivedAt", async () => {
      const filePath = "vault-copilot/projects/My Project/project.md";
      seedProject(makeConfig({ id: "p1", name: "My Project", archivedAt: 5_000 }), "My Project");
      const { app, vault, frontmatter } = makeTestVault();
      frontmatter["copilot-project-archived-at"] = 5_000;
      vault.getAbstractFileByPath.mockReturnValue(mockTFile({ path: filePath }));

      const record = await ProjectFileManager.getInstance(app).updateProject(
        "p1",
        makeConfig({ id: "p1", name: "My Project", description: "Edited" })
      );

      expect(record.project).toMatchObject({ description: "Edited", archivedAt: 5_000 });
      expect(getCachedProjectRecords()[0].project.archivedAt).toBe(5_000);
      expect(frontmatter).toMatchObject({
        "copilot-project-description": "Edited",
        "copilot-project-archived-at": 5_000,
      });
    });
  });
});
