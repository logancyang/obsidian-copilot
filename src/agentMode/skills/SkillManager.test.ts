import { FileSystemAdapter, type App, type EventRef } from "obsidian";
import { discoverManagedSkills } from "./discoverManagedSkills";
import { reconcile } from "./reconcile";
import {
  computeSkillSetSignature,
  getManagedSkills,
  SkillManager,
  type RefreshResult,
} from "./SkillManager";
import { runDeleteSkill, runToggleAgent } from "./toggleAgent";
import { runRenameSkill, runUpdateProperties } from "./updateProperties";
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
const mockedRunUpdateProperties = runUpdateProperties as jest.MockedFunction<
  typeof runUpdateProperties
>;
const mockedRunToggleAgent = runToggleAgent as jest.MockedFunction<typeof runToggleAgent>;
const mockedRunDeleteSkill = runDeleteSkill as jest.MockedFunction<typeof runDeleteSkill>;
const mockedReconcile = reconcile as jest.MockedFunction<typeof reconcile>;

describe("SkillManager orchestration", () => {
  beforeEach(() => {
    skillsFolder = "copilot/skills";
    mockedDiscoverManagedSkills.mockReset();
    mockedReconcile.mockClear();
    mockedRunRenameSkill.mockReset();
    mockedRunUpdateProperties.mockReset();
    mockedRunToggleAgent.mockReset();
    mockedRunDeleteSkill.mockReset();
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

  it("toggleAgent publishes an incremental update without full discovery or reconcile", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill({ enabledAgents: [] });
    await seedSkills(manager, [skill]);
    mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
    mockedDiscoverManagedSkills.mockClear();
    mockedReconcile.mockClear();

    const result = await manager.toggleAgent(skill, "claude", true);

    expect(result).toEqual({ ok: true });
    expect(mockedDiscoverManagedSkills).not.toHaveBeenCalled();
    expect(mockedReconcile).not.toHaveBeenCalled();
    expect(getManagedSkills()[0].enabledAgents).toEqual(["claude"]);
  });

  it("updateProperties publishes an incremental update without full discovery or reconcile", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill();
    await seedSkills(manager, [skill]);
    mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });
    mockedDiscoverManagedSkills.mockClear();
    mockedReconcile.mockClear();

    const result = await manager.updateProperties(skill, {
      description: "Updated description.",
      model: "claude-sonnet",
    });

    expect(result).toEqual({ ok: true });
    expect(mockedDiscoverManagedSkills).not.toHaveBeenCalled();
    expect(mockedReconcile).not.toHaveBeenCalled();
    expect(getManagedSkills()[0]).toMatchObject({
      description: "Updated description.",
      model: "claude-sonnet",
    });
  });

  it("deleteSkill removes one row without full discovery or reconcile", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill();
    const other = makeSkill({ name: "bar", dirPath: "/vault/copilot/skills/bar" });
    await seedSkills(manager, [skill, other]);
    mockedRunDeleteSkill.mockResolvedValueOnce({ ok: true });
    mockedDiscoverManagedSkills.mockClear();
    mockedReconcile.mockClear();

    const result = await manager.deleteSkill(skill);

    expect(result).toEqual({ ok: true });
    expect(mockedDiscoverManagedSkills).not.toHaveBeenCalled();
    expect(mockedReconcile).not.toHaveBeenCalled();
    expect(getManagedSkills().map((s) => s.name)).toEqual(["bar"]);
  });

  it("renameSkill renames one row without full discovery or reconcile", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill();
    await seedSkills(manager, [skill]);
    mockedRunRenameSkill.mockResolvedValueOnce({
      ok: true,
      newDirPath: "/vault/copilot/skills/bar",
      newFilePath: "/vault/copilot/skills/bar/SKILL.md",
    });
    mockedDiscoverManagedSkills.mockClear();
    mockedReconcile.mockClear();

    const result = await manager.renameSkill(skill, "bar");

    expect(result).toEqual({ ok: true });
    expect(mockedDiscoverManagedSkills).not.toHaveBeenCalled();
    expect(mockedReconcile).not.toHaveBeenCalled();
    expect(getManagedSkills()[0]).toMatchObject({
      name: "bar",
      dirPath: "/vault/copilot/skills/bar",
      filePath: "/vault/copilot/skills/bar/SKILL.md",
    });
  });

  it("saveProperties emits one skill-set notification for rename plus patch", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { opencode: ".opencode/skills" });
    const listener = jest.fn();
    const skill = makeSkill({ enabledAgents: ["opencode"] });
    manager.subscribeToSkillSetChange(listener);
    await seedSkills(manager, [skill]);
    listener.mockClear();
    mockedRunRenameSkill.mockResolvedValueOnce({
      ok: true,
      newDirPath: "/vault/copilot/skills/bar",
      newFilePath: "/vault/copilot/skills/bar/SKILL.md",
    });
    mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });

    const result = await manager.saveProperties(skill, {
      newName: "bar",
      patch: { description: "Updated description." },
    });

    expect(result).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getManagedSkills()[0]).toMatchObject({
      name: "bar",
      description: "Updated description.",
    });
  });

  it("saveProperties handles a description-only patch", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill();
    await seedSkills(manager, [skill]);
    mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });

    const result = await manager.saveProperties(skill, {
      patch: { description: "Updated description." },
    });

    expect(result).toEqual({ ok: true });
    expect(mockedRunRenameSkill).not.toHaveBeenCalled();
    expect(getManagedSkills()[0]).toMatchObject({
      name: "foo",
      description: "Updated description.",
    });
  });

  it("saveProperties handles a rename-only update", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill();
    await seedSkills(manager, [skill]);
    mockedRunRenameSkill.mockResolvedValueOnce({
      ok: true,
      newDirPath: "/vault/copilot/skills/bar",
      newFilePath: "/vault/copilot/skills/bar/SKILL.md",
    });
    mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });

    const result = await manager.saveProperties(skill, {
      newName: "bar",
      patch: {},
    });

    expect(result).toEqual({ ok: true });
    expect(getManagedSkills()[0]).toMatchObject({
      name: "bar",
      description: "A skill.",
    });
  });

  it("saveProperties returns collision without patching when rename collides", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill();
    await seedSkills(manager, [skill]);
    mockedRunRenameSkill.mockResolvedValueOnce({ ok: false, reason: "collision" });

    const result = await manager.saveProperties(skill, {
      newName: "bar",
      patch: { description: "Updated description." },
    });

    expect(result).toEqual({
      ok: false,
      code: "collision",
      message: "A skill with that name already exists.",
    });
    expect(mockedRunUpdateProperties).not.toHaveBeenCalled();
  });

  it("saveProperties closes successfully when rename reports EPERM but patch succeeds", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill();
    await seedSkills(manager, [skill]);
    mockedRunRenameSkill.mockResolvedValueOnce({ ok: false, reason: "eperm", mutated: true });
    mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });

    const result = await manager.saveProperties(skill, {
      newName: "bar",
      patch: { description: "Updated description." },
    });

    expect(result).toEqual({ ok: true });
    expect(getManagedSkills()[0]).toMatchObject({
      name: "bar",
      description: "Updated description.",
    });
  });

  it("saveProperties publishes the rename when the follow-up patch fails", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill();
    await seedSkills(manager, [skill]);
    mockedRunRenameSkill.mockResolvedValueOnce({
      ok: true,
      newDirPath: "/vault/copilot/skills/bar",
      newFilePath: "/vault/copilot/skills/bar/SKILL.md",
    });
    mockedRunUpdateProperties.mockResolvedValueOnce({ ok: false, reason: "write failed" });

    const result = await manager.saveProperties(skill, {
      newName: "bar",
      patch: { description: "Updated description." },
    });

    expect(result).toEqual({ ok: false, code: "fs-error", message: "write failed" });
    expect(getManagedSkills()[0]).toMatchObject({
      name: "bar",
      description: "A skill.",
    });
  });

  it("suppresses a vault event that matches a pending expectation", async () => {
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill({ enabledAgents: [] });
    await seedSkills(manager, [skill]);
    mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
    const refreshResult: RefreshResult = {
      ok: true,
      folder: "copilot/skills",
      skillCount: 0,
      reconcileErrorCount: 0,
    };
    const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

    await manager.toggleAgent(skill, "claude", true);
    refreshSpy.mockClear();

    fireVaultEvent(app, "create", { path: ".claude/skills/foo" });
    await flushMicrotasks();
    jest.useFakeTimers();
    jest.advanceTimersByTime(250);
    expect(refreshSpy).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("passes through a vault event that does not match any expectation", async () => {
    jest.useFakeTimers();
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill({ enabledAgents: [] });
    mockedDiscoverManagedSkills.mockResolvedValueOnce([skill]);
    await manager.refresh();
    mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
    await manager.toggleAgent(skill, "claude", true);

    const refreshResult: RefreshResult = {
      ok: true,
      folder: "copilot/skills",
      skillCount: 1,
      reconcileErrorCount: 0,
    };
    const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

    fireVaultEvent(app, "create", { path: "copilot/skills/unrelated/SKILL.md" });
    jest.advanceTimersByTime(250);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("safety timer schedules a reconcile when expectations were never satisfied", async () => {
    jest.useFakeTimers();
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill({ enabledAgents: [] });
    mockedDiscoverManagedSkills.mockResolvedValueOnce([skill]);
    await manager.refresh();
    mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
    await manager.toggleAgent(skill, "claude", true);

    const refreshResult: RefreshResult = {
      ok: true,
      folder: "copilot/skills",
      skillCount: 1,
      reconcileErrorCount: 0,
    };
    const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

    // No vault event arrives to satisfy the expectations. The safety timer
    // fires, clears the stale predicates, and queues a healing reconcile.
    jest.advanceTimersByTime(10_000);
    jest.advanceTimersByTime(250);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves a pre-existing scheduled reconcile across an internal mutation", async () => {
    jest.useFakeTimers();
    const app = makeApp();
    const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
    const skill = makeSkill({ enabledAgents: [] });
    mockedDiscoverManagedSkills.mockResolvedValueOnce([skill]);
    await manager.refresh();

    const refreshResult: RefreshResult = {
      ok: true,
      folder: "copilot/skills",
      skillCount: 1,
      reconcileErrorCount: 0,
    };
    const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

    // External vault rename schedules a reconcile (250ms debounce).
    fireVaultEvent(
      app,
      "rename",
      { path: "elsewhere/foo/SKILL.md" },
      "copilot/skills/foo/SKILL.md"
    );

    // Before the debounce expires, the user toggles an agent.
    mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
    await manager.toggleAgent(skill, "claude", true);

    // The pre-existing reconcile timer must still fire — the external work
    // hasn't been serviced yet.
    jest.advanceTimersByTime(250);
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

async function seedSkills(manager: SkillManager, skills: Skill[]): Promise<void> {
  mockedDiscoverManagedSkills.mockResolvedValueOnce(skills);
  await manager.refresh();
}

function fireVaultEvent(
  app: ReturnType<typeof makeApp>,
  event: string,
  file: { path: string },
  oldPath?: string
): void {
  const call = app.vault.on.mock.calls.find(([e]) => e === event);
  if (call === undefined) throw new Error(`No handler registered for "${event}"`);
  if (oldPath !== undefined) {
    call[1](file, oldPath);
  } else {
    call[1](file);
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  const name = overrides.name ?? "foo";
  const dirPath = overrides.dirPath ?? `/vault/copilot/skills/${name}`;
  return {
    name: "foo",
    description: "A skill.",
    filePath: `${dirPath}/SKILL.md`,
    dirPath,
    body: "body",
    enabledAgents: ["claude"],
    ...overrides,
  };
}
