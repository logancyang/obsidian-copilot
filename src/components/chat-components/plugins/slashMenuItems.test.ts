import type { Skill } from "@/agentMode";
import type { CustomCommand } from "@/commands/type";
import { composeSlashMenuItems } from "./slashMenuItems";

function makeSkill(overrides: Partial<Skill> & { name: string }): Skill {
  const name = overrides.name;
  return {
    description: `desc for ${name}`,
    filePath: `/skills/${name}/SKILL.md`,
    dirPath: `/skills/${name}`,
    body: `body for ${name}`,
    enabledAgents: [],
    ...overrides,
  };
}

function makeCommand(overrides: Partial<CustomCommand> & { title: string }): CustomCommand {
  return {
    content: `# ${overrides.title}\n\nbody`,
    showInContextMenu: false,
    showInSlashMenu: true,
    order: 0,
    modelKey: "",
    lastUsedMs: 0,
    ...overrides,
  };
}

describe("composeSlashMenuItems", () => {
  it("filters skills by active backend when one is provided", () => {
    const skills = [
      makeSkill({ name: "summarize", enabledAgents: ["claude"] }),
      makeSkill({ name: "only-codex", enabledAgents: ["codex"] }),
      makeSkill({ name: "both", enabledAgents: ["claude", "codex"] }),
    ];
    const items = composeSlashMenuItems(skills, [], "claude");
    const names = items.map((i) => i.name);
    expect(names).toEqual(["summarize", "both"]);
    expect(items.every((i) => i.kind === "skill")).toBe(true);
  });

  it("hides skills with user-invocable: false even when backend matches", () => {
    const skills = [
      makeSkill({ name: "auto-only", enabledAgents: ["claude"], userInvocable: false }),
      makeSkill({ name: "summarize", enabledAgents: ["claude"], userInvocable: true }),
      makeSkill({ name: "default-invocable", enabledAgents: ["claude"] }),
    ];
    const items = composeSlashMenuItems(skills, [], "claude");
    expect(items.map((i) => i.name)).toEqual(["summarize", "default-invocable"]);
  });

  it("bypasses the backend filter when active backend is null (plain-LLM fallback)", () => {
    const skills = [
      makeSkill({ name: "summarize", enabledAgents: ["claude"] }),
      makeSkill({ name: "untoggled", enabledAgents: [] }),
      makeSkill({ name: "hidden", enabledAgents: [], userInvocable: false }),
    ];
    const commands = [makeCommand({ title: "old-cmd" })];
    const items = composeSlashMenuItems(skills, commands, null);
    const names = items.map((i) => i.name);
    // Both skills (since enabledAgents filter is bypassed) but not the
    // user-invocable: false one, plus the command.
    expect(names).toEqual(["summarize", "untoggled", "old-cmd"]);
  });

  it("name collision: managed skill wins and the command is shadowed", () => {
    const skills = [
      makeSkill({ name: "dup", enabledAgents: ["claude"] }),
      makeSkill({ name: "summarize", enabledAgents: ["claude"] }),
    ];
    const commands = [makeCommand({ title: "dup" }), makeCommand({ title: "unique-cmd" })];
    const items = composeSlashMenuItems(skills, commands, "claude");
    expect(items.map((i) => i.name)).toEqual(["dup", "summarize", "unique-cmd"]);
    // The "dup" entry that survived must be the skill, not the command.
    expect(items.find((i) => i.name === "dup")?.kind).toBe("skill");
  });

  it("collision detection is case-insensitive", () => {
    const skills = [makeSkill({ name: "summarize", enabledAgents: ["claude"] })];
    const commands = [makeCommand({ title: "Summarize" })];
    const items = composeSlashMenuItems(skills, commands, "claude");
    expect(items.map((i) => i.name)).toEqual(["summarize"]);
  });

  it("respects showInSlashMenu on commands", () => {
    const commands = [
      makeCommand({ title: "visible" }),
      makeCommand({ title: "hidden", showInSlashMenu: false }),
    ];
    const items = composeSlashMenuItems([], commands, "claude");
    expect(items.map((i) => i.name)).toEqual(["visible"]);
  });

  it("preserves caller-supplied order within each group", () => {
    const skills = [
      makeSkill({ name: "b-skill", enabledAgents: ["claude"] }),
      makeSkill({ name: "a-skill", enabledAgents: ["claude"] }),
    ];
    const commands = [makeCommand({ title: "z-cmd" }), makeCommand({ title: "m-cmd" })];
    const items = composeSlashMenuItems(skills, commands, "claude");
    expect(items.map((i) => i.name)).toEqual(["b-skill", "a-skill", "z-cmd", "m-cmd"]);
  });
});
