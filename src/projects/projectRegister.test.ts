import { App, Vault } from "obsidian";
import { ProjectRegister } from "@/projects/projectRegister";
import type { CopilotSettings } from "@/settings/model";

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  Vault: jest.fn(),
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/projects/ProjectFileManager", () => {
  const instance = { fetchProjects: jest.fn().mockResolvedValue([]), initialize: jest.fn() };
  return { ProjectFileManager: { getInstance: jest.fn(() => instance) } };
});

jest.mock("@/projects/projectUtils", () => ({
  ensureProjectFrontmatter: jest.fn(),
  getProjectsFolder: jest.fn(() => "copilot/projects"),
  isProjectConfigFile: jest.fn(() => false),
  parseProjectConfigFile: jest.fn(),
  loadAllProjects: jest.fn(),
}));

jest.mock("@/projects/state", () => ({
  deleteCachedProjectRecordByFilePath: jest.fn(),
  getCachedProjectRecordByFilePath: jest.fn(),
  getCachedProjectRecordById: jest.fn(),
  getCachedProjectRecords: jest.fn(() => []),
  isPendingFileWrite: jest.fn(() => false),
  replaceCachedProjectRecordByFilePath: jest.fn(),
  updateCachedProjectRecords: jest.fn(),
  upsertCachedProjectRecord: jest.fn(),
}));

jest.mock("@/aiParams", () => ({
  getCurrentProject: jest.fn(() => null),
}));

jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: jest.fn(() => ({ clearForProject: jest.fn().mockResolvedValue(undefined) })),
  },
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ copilotFolder: "copilot" })),
  subscribeToSettingsChange: jest.fn().mockReturnValue(() => {}),
}));

/** Build a settings object carrying only the root the watcher reads. */
function settingsWithRoot(copilotFolder: string): CopilotSettings {
  return { copilotFolder } as CopilotSettings;
}

describe("projectRegister", () => {
  describe("ProjectRegister", () => {
    describe("handleSettingsChange()", () => {
      let settingsChangeHandler: (prev: CopilotSettings, next: CopilotSettings) => void;
      let fetchProjects: jest.Mock;
      let updateCachedProjectRecords: jest.Mock;

      beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        const { ProjectFileManager } = jest.requireMock<{
          ProjectFileManager: { getInstance: () => { fetchProjects: jest.Mock } };
        }>("@/projects/ProjectFileManager");
        fetchProjects = ProjectFileManager.getInstance().fetchProjects;
        fetchProjects.mockResolvedValue([]);

        ({ updateCachedProjectRecords } = jest.requireMock<{
          updateCachedProjectRecords: jest.Mock;
        }>("@/projects/state"));

        const mockVault = { on: jest.fn(), off: jest.fn() } as unknown as Vault;
        const register = new ProjectRegister({ vault: mockVault } as unknown as App);
        void register.initialize();

        const { subscribeToSettingsChange } = jest.requireMock<{
          subscribeToSettingsChange: jest.Mock;
        }>("@/settings/model");
        settingsChangeHandler = subscribeToSettingsChange.mock
          .calls[0][0] as typeof settingsChangeHandler;
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("reloads projects when the derived folder changes because the root changed", async () => {
        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("team/ai"));

        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();

        expect(fetchProjects).toHaveBeenCalledTimes(1);
        expect(updateCachedProjectRecords).toHaveBeenCalledWith([]);
      });

      it("does not reload when the root — and thus the derived folder — is unchanged", () => {
        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("copilot"));

        jest.advanceTimersByTime(1000);

        expect(fetchProjects).not.toHaveBeenCalled();
      });
    });
  });
});
