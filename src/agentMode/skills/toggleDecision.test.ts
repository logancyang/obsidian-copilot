import { decideToggleAction } from "./toggleDecision";
import type { Skill } from "./types";

function canonicalSkill(enabledAgents: string[]): Skill {
  return {
    name: "foo",
    description: "A skill.",
    filePath: "/vault/copilot/skills/foo/SKILL.md",
    dirPath: "/vault/copilot/skills/foo",
    body: "body",
    enabledAgents,
    location: { kind: "canonical" },
  };
}

function projectSkill(agentDirs: string[]): Skill {
  return {
    name: "foo",
    description: "A skill.",
    filePath: `/vault/.${agentDirs[0]}/skills/foo/SKILL.md`,
    dirPath: `/vault/.${agentDirs[0]}/skills/foo`,
    body: "body",
    enabledAgents: agentDirs,
    location: { kind: "project", agentDirs },
    contentHash: "deadbeef",
  };
}

describe("decideToggleAction", () => {
  describe("canonical skills", () => {
    it("routes any toggle ON to canonical-toggle", () => {
      const skill = canonicalSkill(["claude"]);
      expect(decideToggleAction(skill, "codex", true)).toEqual({
        kind: "canonical-toggle",
        enabled: true,
      });
    });

    it("routes any toggle OFF to canonical-toggle", () => {
      const skill = canonicalSkill(["claude", "codex"]);
      expect(decideToggleAction(skill, "claude", false)).toEqual({
        kind: "canonical-toggle",
        enabled: false,
      });
    });
  });

  describe("project-single skills", () => {
    it("no-ops when toggling ON the only enabled agent", () => {
      const skill = projectSkill(["claude"]);
      expect(decideToggleAction(skill, "claude", true)).toEqual({ kind: "no-op" });
    });

    it("returns project-single confirm when toggling ON a different agent", () => {
      const skill = projectSkill(["claude"]);
      expect(decideToggleAction(skill, "codex", true)).toEqual({
        kind: "migrate-confirm",
        variant: "project-single",
        targetAgent: "codex",
        action: "expandToNewAgent",
      });
    });

    it("returns disable-last-agent confirm when toggling OFF the only agent", () => {
      const skill = projectSkill(["claude"]);
      expect(decideToggleAction(skill, "claude", false)).toEqual({
        kind: "migrate-confirm",
        variant: "disable-last-agent",
        targetAgent: "claude",
        action: "disableLastAgent",
      });
    });

    it("no-ops toggle OFF an agent that wasn't enabled (defensive)", () => {
      const skill = projectSkill(["claude"]);
      expect(decideToggleAction(skill, "codex", false)).toEqual({ kind: "no-op" });
    });
  });

  describe("project-mirrored skills", () => {
    it("no-ops when toggling ON an already-enabled agent", () => {
      const skill = projectSkill(["claude", "codex"]);
      expect(decideToggleAction(skill, "claude", true)).toEqual({ kind: "no-op" });
    });

    it("returns project-mirrored confirm when toggling ON a new agent", () => {
      const skill = projectSkill(["claude", "codex"]);
      expect(decideToggleAction(skill, "opencode", true)).toEqual({
        kind: "migrate-confirm",
        variant: "project-mirrored",
        targetAgent: "opencode",
        action: "expandToNewAgent",
      });
    });

    it("returns mirrored-remove-one when toggling OFF one of several enabled agents", () => {
      const skill = projectSkill(["claude", "codex"]);
      expect(decideToggleAction(skill, "claude", false)).toEqual({
        kind: "mirrored-remove-one",
        agent: "claude",
      });
    });

    it("returns disable-last-agent confirm when toggling OFF the last remaining of an originally-mirrored skill", () => {
      // After several removals, the skill is now project-single (one agent
      // dir). The decision rule applies identically: disable-last-agent.
      const skill = projectSkill(["codex"]);
      expect(decideToggleAction(skill, "codex", false)).toEqual({
        kind: "migrate-confirm",
        variant: "disable-last-agent",
        targetAgent: "codex",
        action: "disableLastAgent",
      });
    });
  });
});
