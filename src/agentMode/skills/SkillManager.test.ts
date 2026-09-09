import { BUILTIN_SKILLS } from "./builtin/builtinSkills";
import type { BuiltinPreferences } from "./builtin/reconcileBuiltinSkills";
import { act, renderHook } from "@testing-library/react";
import { FileSystemAdapter, type App, type EventRef } from "obsidian";
import { useSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { discoverManagedSkills } from "./discoverManagedSkills";
import { reconcile } from "./reconcile";
import {
  computeSkillSetSignature,
  getManagedSkills,
  getRejectedSkills,
  SkillManager,
  type RefreshResult,
  useRejectedSkills,
} from "./SkillManager";
import { runDeleteSkill, runToggleAgent } from "./toggleAgent";
import { runRenameSkill, runUpdateProperties } from "./updateProperties";
import type { RejectedSkill, Skill, SkillDiscoveryResult } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

let skillsFolder = "copilot/skills";
let preferences: BuiltinPreferences = {};
const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";

jest.mock("@/settings/model", () => ({
  getSettings: () => ({
    agentMode: {
      skills: {
        folder: skillsFolder,
        builtinPreferences: preferences,
      },
    },
  }),
  updateSetting: jest.fn(),
}));

jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveSkillsFolder: () => skillsFolder,
}));

jest.mock("./discoverManagedSkills", () => ({
  discoverManagedSkills: jest.fn(),
}));

jest.mock("./reconcile", () => ({
  reconcile: jest.fn(async () => ({ created: [], removedOrphans: [], errors: [] })),
}));

jest.mock("./nodeFsAdapters", () => ({
  createNodeMigrateSkillFs: jest.fn(() => ({})),
  createNodeProjectDiscoveryFs: jest.fn(() => ({})),
  createNodeReconcileFs: jest.fn(() => ({})),
}));

jest.mock("./discoverProjectSkills", () => ({
  discoverProjectSkills: jest.fn(async () => ({ accepted: [], rejected: [] })),
}));

jest.mock("./mergeDiscovery", () => {
  const actual = jest.requireActual("./mergeDiscovery");
  return {
    ...actual,
    mergeDiscovery: jest.fn((canonical: unknown[]) => canonical),
  };
});

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

describe("SkillManager", () => {
  beforeEach(() => {
    skillsFolder = "copilot/skills";
    preferences = {};
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

  describe("SkillManager", () => {
    describe("refresh()", () => {
      it(`uses one availability snapshot for every built-in row ${ISSUE}`, async () => {
        const f = builtinFixture();
        mockedDiscoverManagedSkills.mockResolvedValue(
          discoveryResult([builtinSkill, { ...builtinSkill, name: BUILTIN_SKILLS[1].name }])
        );
        await f.manager.refresh();
        expect(f.availableAgents).toHaveBeenCalledTimes(1);
        expect(getManagedSkills().map((row) => row.enabledAgents)).toEqual([
          ["claude", "opencode"],
          ["claude", "opencode"],
        ]);
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
          return discoveryResult();
        });
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult());

        const resultPromise = manager.refresh();
        await Promise.resolve();
        releaseFirst();
        const result = await resultPromise;

        expect(mockedDiscoverManagedSkills).toHaveBeenCalledTimes(2);
        expect(mockedDiscoverManagedSkills.mock.calls[0][0].skillsFolderRelPath).toBe(
          "copilot/skills"
        );
        expect(mockedDiscoverManagedSkills.mock.calls[1][0].skillsFolderRelPath).toBe(
          "team/skills"
        );
        expect(result.folder).toBe("team/skills");
      });

      it("publishes and clears rejected discovery state for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const { result: loadErrorCount } = renderHook(() => useSkillLoadErrorCount());
        const rejected: RejectedSkill = {
          name: "broken-skill",
          filePath: "/vault/copilot/skills/broken-skill/SKILL.md",
          dirPath: "/vault/copilot/skills/broken-skill",
          reason: "The description must be quoted.",
        };
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult([], [rejected]));
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult());
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult());
        const { result } = renderHook(() => useRejectedSkills());
        const initialRejectedSkills = result.current;

        await act(async () => {
          await manager.refresh();
        });
        expect(getRejectedSkills()).toEqual([rejected]);
        expect(result.current).toEqual([rejected]);
        expect(loadErrorCount.current).toBe(1);

        await act(async () => {
          await manager.refresh();
        });
        expect(getRejectedSkills()).toEqual([]);
        expect(result.current).toBe(initialRejectedSkills);
        expect(loadErrorCount.current).toBe(0);

        await act(async () => {
          await manager.refresh();
        });
        expect(result.current).toBe(initialRejectedSkills);
      });

      it("notifies when a backend-visible skill signature changes", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { opencode: ".opencode/skills" });
        const listener = jest.fn();
        manager.subscribeToSkillSetChange(listener);
        mockedDiscoverManagedSkills.mockResolvedValueOnce(
          discoveryResult([makeSkill({ enabledAgents: ["opencode"] })])
        );
        mockedDiscoverManagedSkills.mockResolvedValueOnce(
          discoveryResult([makeSkill({ body: "updated", enabledAgents: ["opencode"] })])
        );

        await manager.refresh();
        await manager.refresh();

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls.map((call) => call[0])).toEqual(["opencode", "opencode"]);
      });

      it(`preserves legacy on-disk opt-outs when migration cannot persist ${ISSUE}`, async () => {
        const f = builtinFixture();
        (discoverManagedSkills as jest.Mock).mockResolvedValue({
          accepted: [{ ...builtinSkill, enabledAgents: ["claude"] }],
          rejected: [],
        });
        f.prepare.mockRejectedValue(new Error("migration failed"));
        await f.manager.refresh();
        expect(getManagedSkills()[0].enabledAgents).toEqual(["claude"]);
      });
      it(`applies durable opt-outs even when cleanup fails ${ISSUE}`, async () => {
        const f = builtinFixture();
        preferences[builtinSkill.name] = { disabledAgents: ["opencode"] };
        f.prepare.mockRejectedValue(new Error("cleanup failed"));
        const result = await f.manager.refresh();
        expect(result.reconcileError).toBe("cleanup failed");
        expect(getManagedSkills()[0].enabledAgents).toEqual(["claude"]);
      });
      it(`seeds before discovery on every refresh entry point ${ISSUE}`, async () => {
        const f = builtinFixture();
        await f.manager.refresh();
        await f.manager.refresh();
        expect(f.prepare).toHaveBeenCalledTimes(2);
        expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(
          (discoverManagedSkills as jest.Mock).mock.invocationCallOrder[0]
        );
      });
    });
    describe("initialize()", () => {
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
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult([skill]));
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
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult([skill]));
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
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult([skill]));
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
    });
    describe("renameSkill()", () => {
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

      it(`rejects renaming bundled content ${ISSUE}`, async () => {
        expect(await builtinFixture().manager.renameSkill(builtinSkill, "changed")).toMatchObject({
          ok: false,
        });
        expect(runRenameSkill).not.toHaveBeenCalled();
      });
    });
    describe("toggleAgent()", () => {
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

      it(`routes built-ins through saved settings rather than file metadata ${ISSUE}`, async () => {
        const f = builtinFixture();
        await f.manager.toggleAgent(builtinSkill, "opencode", false);
        expect(preferences[builtinSkill.name].disabledAgents).toEqual(["opencode"]);
        expect(runToggleAgent).not.toHaveBeenCalled();
      });
    });
    describe("updateProperties()", () => {
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

      it(`rejects edits to bundled content ${ISSUE}`, async () => {
        expect(
          await builtinFixture().manager.updateProperties(builtinSkill, { description: "changed" })
        ).toMatchObject({ ok: false });
        expect(runUpdateProperties).not.toHaveBeenCalled();
      });
    });
    describe("deleteSkill()", () => {
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

      it(`rejects deletion of bundled content ${ISSUE}`, async () => {
        expect(await builtinFixture().manager.deleteSkill(builtinSkill)).toMatchObject({
          ok: false,
        });
        expect(runDeleteSkill).not.toHaveBeenCalled();
      });
    });
    describe("saveProperties()", () => {
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

      it(`rejects combined edits to bundled content ${ISSUE}`, async () => {
        expect(
          await builtinFixture().manager.saveProperties(builtinSkill, {
            newName: "changed",
            patch: {},
          })
        ).toMatchObject({ ok: false });
        expect(runUpdateProperties).not.toHaveBeenCalled();
        expect(runRenameSkill).not.toHaveBeenCalled();
      });
    });
    describe("dispose()", () => {
      it("clears the rejected-skill count on disposal so plugin reloads do not keep a stale warning for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
        const { result: loadErrorCount } = renderHook(() => useSkillLoadErrorCount());
        mockedDiscoverManagedSkills.mockResolvedValueOnce(
          discoveryResult(
            [],
            [
              {
                name: "broken-skill",
                filePath: "/vault/copilot/skills/broken-skill/SKILL.md",
                dirPath: "/vault/copilot/skills/broken-skill",
                reason: "The description must be quoted.",
              },
            ]
          )
        );

        await act(() => manager.refresh());
        expect(loadErrorCount.current).toBe(1);

        act(() => manager.dispose());
        expect(loadErrorCount.current).toBe(0);
      });
    });
    describe("setBuiltinSkillEnabled()", () => {
      it(`persists before refreshing and preserves per-agent opt-outs on re-enable ${ISSUE}`, async () => {
        const f = builtinFixture();
        preferences[builtinSkill.name] = { disabled: true, disabledAgents: ["opencode"] };
        expect(await f.manager.setBuiltinSkillEnabled(builtinSkill.name, true)).toEqual({
          ok: true,
        });
        expect(preferences[builtinSkill.name]).toEqual({
          disabled: false,
          disabledAgents: ["opencode"],
        });
        expect(f.savePreferences.mock.invocationCallOrder[0]).toBeLessThan(
          f.prepare.mock.invocationCallOrder[0]
        );
        expect(getManagedSkills()[0].enabledAgents).toEqual(["claude"]);
      });
      it(`does not remove files when saving the opt-out fails ${ISSUE}`, async () => {
        const f = builtinFixture();
        f.savePreferences.mockRejectedValue(new Error("save failed"));
        expect(await f.manager.setBuiltinSkillEnabled(builtinSkill.name, false)).toMatchObject({
          ok: false,
          message: "save failed",
        });
        expect(f.prepare).not.toHaveBeenCalled();
        expect(reconcile).not.toHaveBeenCalled();
      });
    });
    describe("setBuiltinAgentEnabled()", () => {
      it(`rejects unknown built-ins without saving preferences or changing files ${ISSUE}`, async () => {
        const f = builtinFixture();
        expect(
          await f.manager.setBuiltinAgentEnabled("user-owned-skill", "claude", false)
        ).toMatchObject({ ok: false, message: "Unknown built-in skill." });
        expect(f.savePreferences).not.toHaveBeenCalled();
        expect(f.prepare).not.toHaveBeenCalled();
      });
      it(`serializes rapid toggles and retains other agent choices ${ISSUE}`, async () => {
        const f = builtinFixture();
        await Promise.all([
          f.manager.setBuiltinAgentEnabled(builtinSkill.name, "opencode", false),
          f.manager.setBuiltinAgentEnabled(builtinSkill.name, "claude", false),
          f.manager.setBuiltinAgentEnabled(builtinSkill.name, "opencode", true),
        ]);
        expect(preferences[builtinSkill.name].disabledAgents).toEqual(["claude"]);
        expect(getManagedSkills()[0].enabledAgents).toEqual(["opencode"]);
      });
    });
  });
  describe("computeSkillSetSignature()", () => {
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
  mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult(skills));
  await manager.refresh();
}

function discoveryResult(
  accepted: Skill[] = [],
  rejected: RejectedSkill[] = []
): SkillDiscoveryResult<Skill> {
  return { accepted, rejected };
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
    location: { kind: "canonical" },
    ...overrides,
  };
}

const builtinSkill: Skill = makeSkill({
  name: BUILTIN_SKILLS[0].name,
  enabledAgents: ["claude", "opencode"],
  builtin: true,
});
function builtinFixture() {
  mockedDiscoverManagedSkills.mockResolvedValue(discoveryResult([builtinSkill]));
  const prepare = jest.fn(async () => {});
  const availableAgents = jest.fn(() => ["claude", "opencode"]);
  const savePreferences = jest.fn(
    async (update: (current: BuiltinPreferences) => BuiltinPreferences) => {
      preferences = update(preferences);
      return preferences;
    }
  );
  const manager = SkillManager.initialize(
    makeApp(),
    { claude: ".claude/skills", opencode: ".opencode/skills" },
    { prepare, availableAgents, savePreferences }
  );
  return { manager, prepare, availableAgents, savePreferences };
}
