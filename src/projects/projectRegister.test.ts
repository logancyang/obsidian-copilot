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

const mockClearForProject = jest.fn().mockResolvedValue(undefined);

jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: jest.fn(() => ({ clearForProject: mockClearForProject })),
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
    let settingsChangeHandler: (prev: CopilotSettings, next: CopilotSettings) => void;
    let fetchProjects: jest.Mock;
    let updateCachedProjectRecords: jest.Mock;
    let getCachedProjectRecords: jest.Mock;
    let register: ProjectRegister;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();

      // Reason: mockReset drops any queued *Once implementations from a prior
      // test; mockClear alone would leak them into the next one.
      mockClearForProject.mockReset().mockResolvedValue(undefined);

      const { ProjectFileManager } = jest.requireMock<{
        ProjectFileManager: { getInstance: () => { fetchProjects: jest.Mock } };
      }>("@/projects/ProjectFileManager");
      fetchProjects = ProjectFileManager.getInstance().fetchProjects;
      fetchProjects.mockReset().mockResolvedValue([]);

      ({ updateCachedProjectRecords, getCachedProjectRecords } = jest.requireMock<{
        updateCachedProjectRecords: jest.Mock;
        getCachedProjectRecords: jest.Mock;
      }>("@/projects/state"));
      getCachedProjectRecords.mockReturnValue([]);

      const mockVault = { on: jest.fn(), off: jest.fn() } as unknown as Vault;
      register = new ProjectRegister({ vault: mockVault } as unknown as App);
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

    /**
     * Start a reload and park it inside the per-project context-cache clears,
     * mirroring a slow vault: the handler has passed its post-fetch check but
     * has not yet committed. Returns the release for that clear.
     */
    function startReloadStalledInCacheClear(from: string, to: string): () => void {
      getCachedProjectRecords.mockReturnValue([{ project: { id: "stale" } }]);
      let release!: () => void;
      mockClearForProject.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      settingsChangeHandler(settingsWithRoot(from), settingsWithRoot(to));
      // Reason: `release` is only assigned once the debounce fires and the
      // handler actually reaches the clear, which is after this returns.
      return () => release();
    }

    describe("handleSettingsChange()", () => {
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

      it("discards a reload that resumes from its cache clears after a newer one committed", async () => {
        const staleRecords = [{ project: { id: "intermediate" } }];
        const freshRecords = [{ project: { id: "final" } }];
        fetchProjects.mockResolvedValueOnce(staleRecords).mockResolvedValueOnce(freshRecords);

        const releaseStaleClear = startReloadStalledInCacheClear("a", "b");
        await jest.advanceTimersByTimeAsync(1000);

        settingsChangeHandler(settingsWithRoot("b"), settingsWithRoot("c"));
        await jest.advanceTimersByTimeAsync(1000);
        expect(updateCachedProjectRecords).toHaveBeenCalledTimes(1);
        expect(updateCachedProjectRecords).toHaveBeenCalledWith(freshRecords);

        releaseStaleClear();
        await jest.advanceTimersByTimeAsync(0);

        expect(updateCachedProjectRecords).toHaveBeenCalledTimes(1);
      });

      it("keeps the newer records when an earlier failed reload resumes from its cache clears", async () => {
        const freshRecords = [{ project: { id: "final" } }];
        fetchProjects
          .mockRejectedValueOnce(new Error("fetch failed"))
          .mockResolvedValueOnce(freshRecords);

        const releaseFailedClear = startReloadStalledInCacheClear("a", "b");
        await jest.advanceTimersByTimeAsync(1000);

        settingsChangeHandler(settingsWithRoot("b"), settingsWithRoot("c"));
        await jest.advanceTimersByTimeAsync(1000);
        expect(updateCachedProjectRecords).toHaveBeenCalledWith(freshRecords);

        releaseFailedClear();
        await jest.advanceTimersByTimeAsync(0);

        expect(updateCachedProjectRecords).not.toHaveBeenCalledWith([]);
      });
    });

    describe("cleanup()", () => {
      it("stops an in-flight reload from committing after teardown", async () => {
        // Cancelling the debounce only stops a reload that has not started. A
        // torn-down instance must not write into the records store a freshly
        // created one now owns.
        let releaseFetch!: (records: unknown[]) => void;
        fetchProjects.mockReturnValueOnce(
          new Promise<unknown[]>((resolve) => {
            releaseFetch = resolve;
          })
        );

        settingsChangeHandler(settingsWithRoot("a"), settingsWithRoot("b"));
        await jest.advanceTimersByTimeAsync(1000);

        register.cleanup();
        releaseFetch([{ project: { id: "late" } }]);
        await jest.advanceTimersByTimeAsync(0);

        expect(updateCachedProjectRecords).not.toHaveBeenCalled();
      });
    });
  });
});
