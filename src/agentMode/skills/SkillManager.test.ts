import { FileSystemAdapter, type App, type EventRef } from "obsidian";
import { discoverManagedSkills } from "./discoverManagedSkills";
import { computeSkillSetSignature, SkillManager, type RefreshResult } from "./SkillManager";
import { runRenameSkill } from "./updateProperties";
import type { Skill } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

let skillsFolder = "copilot/skills";

jest.mock("@/settings/model", () => ({
  getSettings: () => ({
    agentMode: {
      skills: {
        folder: skillsFolder,
        importSkipList: [],
      },
    },
  }),
  updateSetting: jest.fn(),
}));

jest.mock("./discoverManagedSkills", () => ({
  discoverManagedSkills: jest.fn(),
}));

jest.mock("./reconcile", () => ({
  reconcile: jest.fn(async () => ({ created: [], removedOrphans: [], errors: [] })),
}));

jest.mock("./nodeFsAdapters", () => ({
  createNodeBulkMoveFs: jest.fn(() => ({})),
  createNodeImportDetectorFs: jest.fn(() => ({})),
  createNodeReconcileFs: jest.fn(() => ({})),
}));

jest.mock("./toggleAgent", () => ({
  runDeleteSkill: jest.fn(),
  runToggleAgent: jest.fn(),
}));

jest.mock("./updateProperties", () => ({
  runRenameSkill: jest.fn(),
  runUpdateProperties: jest.fn(),
}));

const mockedDiscoverManagedSkills = discoverManagedSkills as jest.MockedFunction<
  typeof discoverManagedSkills
>;
const mockedRunRenameSkill = runRenameSkill as jest.MockedFunction<typeof runRenameSkill>;

describe("SkillManager orchestration", () => {
  beforeEach(() => {
    skillsFolder = "copilot/skills";
    mockedDiscoverManagedSkills.mockReset();
    mockedRunRenameSkill.mockReset();
    SkillManager.resetForTesting();
    jest.useRealTimers();
  });

  afterEach(() => {
    SkillManager.resetForTesting();
    jest.useRealTimers();
  });

  it("queues one follow-up refresh when the configured folder changes during an in-flight pass", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    let releaseFirst = (): void => {};

    mockedDiscoverManagedSkills.mockImplementationOnce(async () => {
      skillsFolder = "team/skills";
      void manager.refresh();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return [];
    });
    mockedDiscoverManagedSkills.mockResolvedValueOnce([]);

    const resultPromise = manager.refresh();
    await Promise.resolve();
    releaseFirst();
    const result = await resultPromise;

    expect(mockedDiscoverManagedSkills).toHaveBeenCalledTimes(2);
    expect(mockedDiscoverManagedSkills.mock.calls[0][0].skillsFolderRelPath).toBe("copilot/skills");
    expect(mockedDiscoverManagedSkills.mock.calls[1][0].skillsFolderRelPath).toBe("team/skills");
    expect(result.folder).toBe("team/skills");
  });

  it("schedules reconciliation when a rename moves a watched old path elsewhere", () => {
    jest.useFakeTimers();
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const refreshResult: RefreshResult = {
      ok: true,
      folder: "copilot/skills",
      skillCount: 0,
      reconcileErrorCount: 0,
    };
    const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);
    const renameHandler = app.vault.on.mock.calls.find(([event]) => event === "rename")?.[1];

    expect(renameHandler).toBeDefined();
    renameHandler?.({ path: "elsewhere/foo/SKILL.md" }, "copilot/skills/foo/SKILL.md");
    jest.advanceTimersByTime(250);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes after a rename failure that already mutated the canonical directory", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    mockedRunRenameSkill.mockResolvedValueOnce({
      ok: false,
      reason: "Could not rewrite SKILL.md",
      mutated: true,
    });
    const refreshResult: RefreshResult = {
      ok: true,
      folder: "copilot/skills",
      skillCount: 0,
      reconcileErrorCount: 0,
    };
    const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

    const result = await manager.renameSkill(makeSkill(), "bar");

    expect(result).toEqual({
      ok: false,
      code: "fs-error",
      message: "Could not rewrite SKILL.md",
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("notifies when a backend-visible skill signature changes", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { opencode: ".opencode/skills" });
    const listener = jest.fn();
    manager.subscribeToSkillSetChange(listener);
    mockedDiscoverManagedSkills.mockResolvedValueOnce([makeSkill({ enabledAgents: ["opencode"] })]);
    mockedDiscoverManagedSkills.mockResolvedValueOnce([
      makeSkill({ body: "updated", enabledAgents: ["opencode"] }),
    ]);

    await manager.refresh();
    await manager.refresh();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map((call) => call[0])).toEqual(["opencode", "opencode"]);
  });

  it("computes different signatures for body and enabled-agent changes", () => {
    const base = makeSkill({ enabledAgents: ["claude"] });
    const bodyChanged = makeSkill({ body: "new body", enabledAgents: ["claude"] });
    const enabledChanged = makeSkill({ enabledAgents: ["opencode"] });

    expect(computeSkillSetSignature([base], "opencode")).not.toBe(
      computeSkillSetSignature([bodyChanged], "opencode")
    );
    expect(computeSkillSetSignature([base], "opencode")).not.toBe(
      computeSkillSetSignature([enabledChanged], "opencode")
    );
  });
});

function makeApp(): App & {
  vault: App["vault"] & {
    on: jest.Mock<EventRef, [string, (...args: unknown[]) => void]>;
    offref: jest.Mock<void, [EventRef]>;
  };
} {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(
    "/vault"
  );
  adapter.exists = jest.fn().mockResolvedValue(true);
  adapter.list = jest.fn().mockResolvedValue({ files: [], folders: [] });
  adapter.read = jest.fn().mockResolvedValue("");
  return {
    vault: {
      adapter,
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => ({ event, handler })),
      offref: jest.fn(),
    },
  } as unknown as App & {
    vault: App["vault"] & {
      on: jest.Mock<EventRef, [string, (...args: unknown[]) => void]>;
      offref: jest.Mock<void, [EventRef]>;
    };
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "foo",
    description: "A skill.",
    filePath: "/vault/copilot/skills/foo/SKILL.md",
    dirPath: "/vault/copilot/skills/foo",
    body: "body",
    enabledAgents: ["claude"],
    ...overrides,
  };
}
