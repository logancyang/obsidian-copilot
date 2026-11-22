import {
  formatStartupMigrationSummary,
  runStartupMigrationSummary,
  shouldClearCredentialRecovery,
  shouldClearFolderRelocation,
  type StartupMigrationItem,
  type StartupMigrationTask,
  type StartupMigrationTasks,
} from "@/services/startupMigration";

const initial: StartupMigrationItem = {
  id: "credentials",
  title: "API keys",
  status: "success",
  summary: "Keys migrated.",
};
const failure: StartupMigrationItem = {
  id: "projects",
  title: "Projects",
  status: "error",
  summary: "Projects failed.",
};
const final: StartupMigrationItem = {
  id: "license",
  title: "License",
  status: "action-required",
  summary: "Re-enter the license.",
  details: ["Open Copilot Settings."],
};

const EMPTY_TASK: StartupMigrationTask = {
  result: Promise.resolve(null),
  failure: null,
  onFailure: jest.fn(),
};

function tasks(projects: StartupMigrationTask = EMPTY_TASK): StartupMigrationTasks {
  return [projects, EMPTY_TASK, EMPTY_TASK, EMPTY_TASK];
}

describe("startupMigration", () => {
  describe("formatStartupMigrationSummary()", () => {
    it("formats statuses and recovery details as one readable message", () => {
      expect(formatStartupMigrationSummary([initial, failure, final])).toBe(
        [
          "Copilot finished updating this vault.",
          "API keys — Completed\nKeys migrated.",
          "Projects — Failed\nProjects failed.",
          "License — Action required\nRe-enter the license.\n• Open Copilot Settings.",
        ].join("\n\n")
      );
    });
  });

  describe("shouldClearCredentialRecovery()", () => {
    it("clears only a presented receipt owned by this device", () => {
      expect(shouldClearCredentialRecovery([initial], "device-a", "device-a")).toBe(true);
      expect(shouldClearCredentialRecovery([initial], "device-b", "device-a")).toBe(false);
      expect(shouldClearCredentialRecovery([], "device-a", "device-a")).toBe(false);
    });
  });

  describe("shouldClearFolderRelocation()", () => {
    it("clears only presented folder guidance that did not fail", () => {
      expect(
        shouldClearFolderRelocation([{ ...initial, id: "folders", status: "action-required" }])
      ).toBe(true);
      expect(shouldClearFolderRelocation([{ ...initial, id: "folders", status: "error" }])).toBe(
        false
      );
    });
  });

  describe("runStartupMigrationSummary()", () => {
    it("settles failures before presenting and acknowledging one ordered summary", async () => {
      const onFailure = jest.fn();
      const calls: string[] = [];

      await runStartupMigrationSummary({
        initialItems: [initial],
        tasks: tasks({
          result: Promise.reject(new Error("failed")),
          failure,
          onFailure,
        }),
        afterTasks: () => [final],
        present: (items) => calls.push(`present:${items.map(({ id }) => id).join(",")}`),
        acknowledge: () => calls.push("acknowledge"),
      });

      expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
      expect(calls).toEqual(["present:credentials,projects,license", "acknowledge"]);
    });

    it("does nothing when no migration has an outcome", async () => {
      const present = jest.fn();
      const acknowledge = jest.fn();

      await runStartupMigrationSummary({
        initialItems: [],
        tasks: tasks(),
        afterTasks: () => [],
        present,
        acknowledge,
      });

      expect(present).not.toHaveBeenCalled();
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it("does not acknowledge outcomes when presentation fails", async () => {
      const acknowledge = jest.fn();

      await expect(
        runStartupMigrationSummary({
          initialItems: [initial],
          tasks: tasks(),
          afterTasks: () => [],
          present: () => {
            throw new Error("modal failed");
          },
          acknowledge,
        })
      ).rejects.toThrow("modal failed");

      expect(acknowledge).not.toHaveBeenCalled();
    });
  });
});
