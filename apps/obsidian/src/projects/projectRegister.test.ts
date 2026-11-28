import { App, Vault } from "obsidian";
import { ProjectRegister } from "@/projects/projectRegister";
import type { ProjectFileRecord } from "@/projects/type";
import { getCachedProjectRecords, updateCachedProjectRecords } from "@/projects/state";
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

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ copilotFolder: "copilot" })),
  subscribeToSettingsChange: jest.fn().mockReturnValue(() => {}),
}));

function recordWithId(id: string): ProjectFileRecord {
  return {
    project: { id, name: id },
    filePath: `copilot/projects/${id}/project.md`,
    folderName: id,
  } as ProjectFileRecord;
}

function settingsWithRoot(copilotFolder: string): CopilotSettings {
  return { copilotFolder } as CopilotSettings;
}

describe("projectRegister", () => {
  describe("ProjectRegister", () => {
    let settingsChangeHandler: (prev: CopilotSettings, next: CopilotSettings) => void;
    let fetchProjects: jest.Mock;
    let register: ProjectRegister;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();

      const { ProjectFileManager } = jest.requireMock<{
        ProjectFileManager: { getInstance: () => { fetchProjects: jest.Mock } };
      }>("@/projects/ProjectFileManager");
      fetchProjects = ProjectFileManager.getInstance().fetchProjects;
      fetchProjects.mockReset().mockResolvedValue([]);

      updateCachedProjectRecords([]);

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

    function startReloadStalledInFetch(
      from: string,
      to: string
    ): { resolve: (records: unknown[]) => void; reject: (error: Error) => void } {
      let settle!: { resolve: (records: unknown[]) => void; reject: (error: Error) => void };
      fetchProjects.mockReturnValueOnce(
        new Promise<unknown[]>((resolve, reject) => {
          settle = { resolve, reject };
        })
      );
      settingsChangeHandler(settingsWithRoot(from), settingsWithRoot(to));
      return {
        resolve: (records) => settle.resolve(records),
        reject: (error) => settle.reject(error),
      };
    }

    describe("handleSettingsChange()", () => {
      it("replaces the cached projects with the new folder's projects when the root changed", async () => {
        const fresh = [recordWithId("fresh")];
        updateCachedProjectRecords([recordWithId("stale")]);
        fetchProjects.mockResolvedValueOnce(fresh);

        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("team/ai"));
        await jest.advanceTimersByTimeAsync(1000);

        expect(fetchProjects).toHaveBeenCalledTimes(1);
        expect(getCachedProjectRecords()).toEqual(fresh);
      });

      it("does not reload when the root — and thus the derived folder — is unchanged", () => {
        const cached = [recordWithId("cached")];
        updateCachedProjectRecords(cached);

        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("copilot"));
        jest.advanceTimersByTime(1000);

        expect(fetchProjects).not.toHaveBeenCalled();
        expect(getCachedProjectRecords()).toEqual(cached);
      });

      it("clears the cached projects when reloading from the new folder fails", async () => {
        updateCachedProjectRecords([recordWithId("stale")]);
        fetchProjects.mockRejectedValueOnce(new Error("fetch failed"));

        settingsChangeHandler(settingsWithRoot("copilot"), settingsWithRoot("team/ai"));
        await jest.advanceTimersByTimeAsync(1000);

        expect(getCachedProjectRecords()).toEqual([]);
      });

      it("discards a slow reload that resolves after a newer one committed", async () => {
        const freshRecords = [recordWithId("final")];
        const stale = startReloadStalledInFetch("a", "b");
        await jest.advanceTimersByTimeAsync(1000);

        fetchProjects.mockResolvedValueOnce(freshRecords);
        settingsChangeHandler(settingsWithRoot("b"), settingsWithRoot("c"));
        await jest.advanceTimersByTimeAsync(1000);
        expect(getCachedProjectRecords()).toEqual(freshRecords);

        stale.resolve([recordWithId("intermediate")]);
        await jest.advanceTimersByTimeAsync(0);

        expect(getCachedProjectRecords()).toEqual(freshRecords);
      });

      it("keeps the newer records when an earlier reload fails after a newer one committed", async () => {
        const freshRecords = [recordWithId("final")];
        const stale = startReloadStalledInFetch("a", "b");
        await jest.advanceTimersByTimeAsync(1000);

        fetchProjects.mockResolvedValueOnce(freshRecords);
        settingsChangeHandler(settingsWithRoot("b"), settingsWithRoot("c"));
        await jest.advanceTimersByTimeAsync(1000);
        expect(getCachedProjectRecords()).toEqual(freshRecords);

        stale.reject(new Error("fetch failed"));
        await jest.advanceTimersByTimeAsync(0);

        expect(getCachedProjectRecords()).toEqual(freshRecords);
      });
    });

    describe("cleanup()", () => {
      it("stops an in-flight reload from committing after teardown", async () => {
        const cached = [recordWithId("cached")];
        updateCachedProjectRecords(cached);
        let releaseFetch!: (records: unknown[]) => void;
        fetchProjects.mockReturnValueOnce(
          new Promise<unknown[]>((resolve) => {
            releaseFetch = resolve;
          })
        );

        settingsChangeHandler(settingsWithRoot("a"), settingsWithRoot("b"));
        await jest.advanceTimersByTimeAsync(1000);

        register.cleanup();
        releaseFetch([recordWithId("late")]);
        await jest.advanceTimersByTimeAsync(0);

        expect(getCachedProjectRecords()).toEqual(cached);
      });
    });
  });
});
