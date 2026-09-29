import { App, Vault } from "obsidian";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects", projectList: [] })),
  updateSetting: jest.fn(),
}));

jest.mock("@/projects/state", () => ({
  addPendingFileWrite: jest.fn(),
  removePendingFileWrite: jest.fn(),
  isPendingFileWrite: jest.fn(() => false),
  upsertCachedProjectRecord: jest.fn(),
  deleteCachedProjectRecordById: jest.fn(),
  updateCachedProjectRecords: jest.fn(),
  getCachedProjectRecords: jest.fn(() => []),
  getCachedProjectRecordById: jest.fn(() => undefined),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock("@/projects/projectUtils", () => ({
  sanitizeVaultPathSegment: jest.fn((s: string) => s.replace(/[/\\]/g, "_")),
  fetchAllProjects: jest.fn(async () => []),
  loadAllProjects: jest.fn(async () => []),
  writeProjectFrontmatter: jest.fn(async () => {}),
  getProjectsFolder: jest.fn(() => "copilot-projects"),
  getProjectFolderPath: jest.fn((name: string) => `copilot-projects/${name}`),
  getProjectConfigFilePath: jest.fn((name: string) => `copilot-projects/${name}/project.md`),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(async () => {}),
}));

jest.mock("@/utils/recentUsageManager", () => ({
  RecentUsageManager: jest.fn().mockImplementation(() => ({
    touch: jest.fn(),
    shouldPersist: jest.fn(() => null),
    markPersisted: jest.fn(),
    getLastTouchedAt: jest.fn(() => null),
    getRecentItems: jest.fn(() => []),
  })),
}));

jest.mock("@/projects/projectMigration", () => ({
  ensureProjectsMigratedIfNeeded: jest.fn(async () => {}),
}));

import { getCachedProjectRecords, getCachedProjectRecordById } from "@/projects/state";

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

function makeMockVault(): jest.Mocked<Vault> {
  return {
    create: jest.fn(async (path: string) => mockTFile({ path })),
    getAbstractFileByPath: jest.fn(() => null),
    adapter: { exists: jest.fn(async () => false) },
  } as unknown as jest.Mocked<Vault>;
}

function makeMockApp(vault: Vault): App {
  return {
    vault,
    fileManager: { trashFile: jest.fn(async () => {}) },
  } as unknown as App;
}

function resetSingleton() {
  (ProjectFileManager as unknown as Record<string, unknown>)["instance"] = undefined;
}

describe("ProjectFileManager.createProject", () => {
  let vault: jest.Mocked<Vault>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
    vault = makeMockVault();
    (getCachedProjectRecords as jest.Mock).mockReturnValue([]);
    (getCachedProjectRecordById as jest.Mock).mockReturnValue(undefined);
  });

  it("rejects duplicate project names (case-insensitive)", async () => {
    (getCachedProjectRecords as jest.Mock).mockReturnValue([
      {
        project: makeConfig({ id: "existing", name: "My Project" }),
        filePath: "copilot-projects/existing/project.md",
        folderName: "existing",
      },
    ]);

    const manager = ProjectFileManager.getInstance(makeMockApp(vault));

    await expect(
      manager.createProject(makeConfig({ id: "new-project", name: "my project" }))
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects empty project id", async () => {
    const manager = ProjectFileManager.getInstance(makeMockApp(vault));

    await expect(manager.createProject(makeConfig({ id: "", name: "Valid Name" }))).rejects.toThrow(
      /cannot be empty/i
    );
  });

  it("rejects whitespace-only project id", async () => {
    const manager = ProjectFileManager.getInstance(makeMockApp(vault));

    await expect(
      manager.createProject(makeConfig({ id: "   ", name: "Valid Name" }))
    ).rejects.toThrow(/cannot be empty/i);
  });
});
