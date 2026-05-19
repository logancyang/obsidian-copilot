import { buildSkillCreationDirective } from "./spawnDirective";

const AGENT_DIRS = [".claude/skills", ".agents/skills", ".opencode/skills"];

describe("buildSkillCreationDirective", () => {
  it("templates the claude agent + default folder", () => {
    const directive = buildSkillCreationDirective("claude", "copilot/skills", AGENT_DIRS);
    expect(directive).toContain("<vault>/copilot/skills/<name>/SKILL.md");
    expect(directive).toContain('metadata.copilot-enabled-agents: "claude"');
    expect(directive).toContain("Do not write");
    expect(directive).toContain(".claude/skills/");
    expect(directive).toContain(".agents/skills/");
    expect(directive).toContain(".opencode/skills/");
    expect(directive).toMatch(/Skills-tab\s+reconciliation/);
  });

  it("templates the codex agent", () => {
    const directive = buildSkillCreationDirective("codex", "copilot/skills", AGENT_DIRS);
    expect(directive).toContain('metadata.copilot-enabled-agents: "codex"');
    expect(directive).toContain("<vault>/copilot/skills/<name>/SKILL.md");
  });

  it("templates the opencode agent", () => {
    const directive = buildSkillCreationDirective("opencode", "copilot/skills", AGENT_DIRS);
    expect(directive).toContain('metadata.copilot-enabled-agents: "opencode"');
    expect(directive).toContain("<vault>/copilot/skills/<name>/SKILL.md");
  });

  it("templates a non-default skills folder", () => {
    const directive = buildSkillCreationDirective("claude", "team-skills", AGENT_DIRS);
    expect(directive).toContain("<vault>/team-skills/<name>/SKILL.md");
    // Default folder must not leak when the caller supplies a custom one.
    expect(directive).not.toContain("copilot/skills");
  });

  it("templates nested folders", () => {
    const directive = buildSkillCreationDirective("opencode", "shared/team-skills", AGENT_DIRS);
    expect(directive).toContain("<vault>/shared/team-skills/<name>/SKILL.md");
  });

  it("has no leading or trailing whitespace", () => {
    const directive = buildSkillCreationDirective("claude", "copilot/skills", AGENT_DIRS);
    expect(directive).toBe(directive.trim());
  });

  it("warns against writing into the symlink locations", () => {
    // Verbatim from the spec — the directive must explicitly tell the agent
    // that the agent-specific paths are managed by Copilot.
    const directive = buildSkillCreationDirective("claude", "copilot/skills", AGENT_DIRS);
    expect(directive).toMatch(
      /Do not write[\s\S]*\.claude\/skills\/[\s\S]*\.agents\/skills\/[\s\S]*\.opencode\/skills\//
    );
  });

  it("reflects the injected agent-dir list (no hard-coded paths)", () => {
    const directive = buildSkillCreationDirective("claude", "copilot/skills", [
      ".custom-a/skills",
      ".custom-b/skills",
    ]);
    expect(directive).toContain(".custom-a/skills/");
    expect(directive).toContain(".custom-b/skills/");
    expect(directive).not.toContain(".claude/skills/");
  });

  // Regression: the previous directive said "at minimum `name`, `description`,
  // and `metadata.copilot-enabled-agents: \"<agent>\"`", which Claude
  // interpreted as a minimum *value set* and proceeded to copy
  // `"claude,opencode"` from a sibling skill verbatim. The new wording must
  // describe the value as exact and single, and forbid copying.
  describe("locks copilot-enabled-agents to the authoring agent", () => {
    it("asserts the value is exactly the authoring agent", () => {
      const directive = buildSkillCreationDirective("claude", "copilot/skills", AGENT_DIRS);
      expect(directive).toMatch(/MUST be exactly[\s\S]*"claude"/);
      expect(directive).toMatch(/only the agent creating the skill/i);
      expect(directive).toMatch(/do not add other agents/i);
    });

    it("forbids preserving the prior value when copying an existing skill", () => {
      const directive = buildSkillCreationDirective("opencode", "copilot/skills", AGENT_DIRS);
      expect(directive).toMatch(/copying or adapting an existing[\s\S]*overwrite/i);
      expect(directive).toMatch(/do not preserve the[\s\S]*prior value/i);
    });

    it('does not use the ambiguous phrase "at minimum" near the enabled-agents field', () => {
      const directive = buildSkillCreationDirective("claude", "copilot/skills", AGENT_DIRS);
      // "at minimum" was the load-bearing loophole — guard against it
      // creeping back in anywhere in the directive.
      expect(directive.toLowerCase()).not.toContain("at minimum");
    });
  });
});
