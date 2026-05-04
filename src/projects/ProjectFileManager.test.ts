import { TFile, Vault } from "obsidian";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileManager } from "@/projects/ProjectFileManager";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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
  // Reason: overridden per-test to simulate cache state
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

jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: jest.fn(() => ({ clearForProject: jest.fn(async () => {}) })),
  },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  getCachedProjectRecords,
  getCachedProjectRecordById,
} from "@/projects/state";

/** Minimal valid ProjectConfig for test use. */
function makeConfig(overrides: { id: string; name: string } & Partial<ProjectConfig>): ProjectConfig {
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

/** Build a minimal Vault mock. */
function makeMockVault(): jest.Mocked<Vault> {
  return {
    create: jest.fn(async (path: string) => ({ path } as TFile)),
    // Reason: null = file does not exist yet, avoids collision error in createProject
    getAbstractFileByPath: jest.fn(() => null),
    adapter: { exists: jest.fn(async () => false) },
  } as unknown as jest.Mocked<Vault>;
}

/** Reset the singleton so each test gets a fresh instance. */
function resetSingleton() {
  (ProjectFileManager as unknown as Record<string, unknown>)["instance"] = undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

    const manager = ProjectFileManager.getInstance(vault);

    // "my project" (lowercase) collides with "My Project"
    await expect(
      manager.createProject(makeConfig({ id: "new-project", name: "my project" }))
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects empty project id", async () => {
    const manager = ProjectFileManager.getInstance(vault);

    await expect(
      manager.createProject(makeConfig({ id: "", name: "Valid Name" }))
    ).rejects.toThrow(/cannot be empty/i);
  });

  it("rejects whitespace-only project id", async () => {
    const manager = ProjectFileManager.getInstance(vault);

    await expect(
      manager.createProject(makeConfig({ id: "   ", name: "Valid Name" }))
    ).rejects.toThrow(/cannot be empty/i);
  });
});
