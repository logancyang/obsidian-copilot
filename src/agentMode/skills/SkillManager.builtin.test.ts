import { SkillManager, getManagedSkills } from "./SkillManager";
import { discoverManagedSkills } from "./discoverManagedSkills";
import { reconcile } from "./reconcile";
import { runDeleteSkill, runToggleAgent } from "./toggleAgent";
import { runRenameSkill, runUpdateProperties } from "./updateProperties";
import { BUILTIN_SKILLS } from "./builtin/builtinSkills";
import type { BuiltinPreferences } from "./builtin/reconcileBuiltinSkills";
import type { Skill } from "./types";
import type { App } from "obsidian";

let preferences: BuiltinPreferences = {};
jest.mock("@/logger", () => ({ logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { skills: { builtinPreferences: preferences } } }),
  updateSetting: jest.fn(),
}));
jest.mock("@/settings/copilotFolder", () => ({ getEffectiveSkillsFolder: () => "copilot/skills" }));
jest.mock("./discoverManagedSkills", () => ({ discoverManagedSkills: jest.fn() }));
jest.mock("./reconcile", () => ({
  reconcile: jest.fn(async () => ({ created: [], removedOrphans: [], errors: [] })),
}));
jest.mock("./toggleAgent", () => ({ runDeleteSkill: jest.fn(), runToggleAgent: jest.fn() }));
jest.mock("./updateProperties", () => ({
  runRenameSkill: jest.fn(),
  runUpdateProperties: jest.fn(),
}));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
const skill: Skill = {
  name: BUILTIN_SKILLS[0].name,
  description: "test",
  dirPath: "copilot/skills/test",
  filePath: "copilot/skills/test/SKILL.md",
  body: "body",
  enabledAgents: ["claude", "opencode"],
  location: { kind: "canonical" },
  builtin: true,
};
function fixture() {
  const prepare = jest.fn(async () => {});
  const savePreferences = jest.fn(async (next: BuiltinPreferences) => {
    preferences = next;
  });
  const manager = SkillManager.initialize(
    { vault: { adapter: {}, on: jest.fn(), offref: jest.fn() } } as unknown as App,
    { claude: ".claude/skills", opencode: ".opencode/skills" },
    { prepare, availableAgents: () => ["claude", "opencode"], savePreferences }
  );
  return { manager, prepare, savePreferences };
}

describe("SkillManager", () => {
  describe("SkillManager", () => {
    beforeEach(() => {
      preferences = {};
      jest.clearAllMocks();
      (discoverManagedSkills as jest.Mock).mockResolvedValue({ accepted: [skill], rejected: [] });
    });
    afterEach(() => SkillManager.resetForTesting());
    describe("refresh()", () => {
      it(`preserves legacy on-disk opt-outs when migration cannot persist ${ISSUE}`, async () => {
        const f = fixture();
        (discoverManagedSkills as jest.Mock).mockResolvedValue({
          accepted: [{ ...skill, enabledAgents: ["claude"] }],
          rejected: [],
        });
        f.prepare.mockRejectedValue(new Error("migration failed"));
        await f.manager.refresh();
        expect(getManagedSkills()[0].enabledAgents).toEqual(["claude"]);
      });
      it(`applies durable opt-outs even when cleanup fails ${ISSUE}`, async () => {
        const f = fixture();
        preferences[skill.name] = { disabledAgents: ["opencode"] };
        f.prepare.mockRejectedValue(new Error("cleanup failed"));
        const result = await f.manager.refresh();
        expect(result.reconcileError).toBe("cleanup failed");
        expect(getManagedSkills()[0].enabledAgents).toEqual(["claude"]);
      });
      it(`seeds before discovery on every refresh entry point ${ISSUE}`, async () => {
        const f = fixture();
        await f.manager.refresh();
        await f.manager.refresh();
        expect(f.prepare).toHaveBeenCalledTimes(2);
        expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(
          (discoverManagedSkills as jest.Mock).mock.invocationCallOrder[0]
        );
      });
    });
    describe("setBuiltinSkillEnabled()", () => {
      it(`persists before refreshing and preserves per-agent opt-outs on re-enable ${ISSUE}`, async () => {
        const f = fixture();
        preferences[skill.name] = { disabled: true, disabledAgents: ["opencode"] };
        expect(await f.manager.setBuiltinSkillEnabled(skill.name, true)).toEqual({ ok: true });
        expect(preferences[skill.name]).toEqual({ disabled: false, disabledAgents: ["opencode"] });
        expect(f.savePreferences.mock.invocationCallOrder[0]).toBeLessThan(
          f.prepare.mock.invocationCallOrder[0]
        );
        expect(getManagedSkills()[0].enabledAgents).toEqual(["claude"]);
      });
      it(`does not remove files when saving the opt-out fails ${ISSUE}`, async () => {
        const f = fixture();
        f.savePreferences.mockRejectedValue(new Error("save failed"));
        expect(await f.manager.setBuiltinSkillEnabled(skill.name, false)).toMatchObject({
          ok: false,
          message: "save failed",
        });
        expect(f.prepare).not.toHaveBeenCalled();
        expect(reconcile).not.toHaveBeenCalled();
      });
    });
    describe("setBuiltinAgentEnabled()", () => {
      it(`serializes rapid toggles and retains other agent choices ${ISSUE}`, async () => {
        const f = fixture();
        await Promise.all([
          f.manager.setBuiltinAgentEnabled(skill.name, "opencode", false),
          f.manager.setBuiltinAgentEnabled(skill.name, "claude", false),
          f.manager.setBuiltinAgentEnabled(skill.name, "opencode", true),
        ]);
        expect(preferences[skill.name].disabledAgents).toEqual(["claude"]);
        expect(getManagedSkills()[0].enabledAgents).toEqual(["opencode"]);
      });
    });
    describe("toggleAgent()", () => {
      it(`routes built-ins through saved settings rather than file metadata ${ISSUE}`, async () => {
        const f = fixture();
        await f.manager.toggleAgent(skill, "opencode", false);
        expect(preferences[skill.name].disabledAgents).toEqual(["opencode"]);
        expect(runToggleAgent).not.toHaveBeenCalled();
      });
    });
    describe("deleteSkill()", () => {
      it(`rejects deletion of bundled content ${ISSUE}`, async () => {
        expect(await fixture().manager.deleteSkill(skill)).toMatchObject({ ok: false });
        expect(runDeleteSkill).not.toHaveBeenCalled();
      });
    });
    describe("updateProperties()", () => {
      it(`rejects edits to bundled content ${ISSUE}`, async () => {
        expect(
          await fixture().manager.updateProperties(skill, { description: "changed" })
        ).toMatchObject({ ok: false });
        expect(runUpdateProperties).not.toHaveBeenCalled();
      });
    });
    describe("saveProperties()", () => {
      it(`rejects combined edits to bundled content ${ISSUE}`, async () => {
        expect(
          await fixture().manager.saveProperties(skill, { newName: "changed", patch: {} })
        ).toMatchObject({ ok: false });
        expect(runUpdateProperties).not.toHaveBeenCalled();
        expect(runRenameSkill).not.toHaveBeenCalled();
      });
    });
    describe("renameSkill()", () => {
      it(`rejects renaming bundled content ${ISSUE}`, async () => {
        expect(await fixture().manager.renameSkill(skill, "changed")).toMatchObject({ ok: false });
        expect(runRenameSkill).not.toHaveBeenCalled();
      });
    });
  });
});
