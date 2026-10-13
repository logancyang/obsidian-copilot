import type { Skill } from "@/agentMode";
import type { CustomCommand } from "@/commands/type";
import { composeSlashMenuItems, filterSlashMenuOptions } from "./slashMenuItems";

function makeSkill(overrides: Partial<Skill> & { name: string }): Skill {
  const name = overrides.name;
  return {
    description: `desc for ${name}`,
    filePath: `/skills/${name}/SKILL.md`,
    dirPath: `/skills/${name}`,
    body: `body for ${name}`,
    enabledAgents: [],
    location: { kind: "canonical" },
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

describe("slashMenuItems", () => {
  describe("composeSlashMenuItems()", () => {
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 lists the built-in compact item first in agent mode", () => {
      const skills = [makeSkill({ name: "summarize", enabledAgents: ["claude"] })];
      const commands = [makeCommand({ title: "polish" })];
      const items = composeSlashMenuItems(skills, commands, "claude", true);
      expect(items.map((i) => [i.kind, i.name])).toEqual([
        ["builtin", "compact"],
        ["skill", "summarize"],
        ["command", "polish"],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 lists compact in agent mode before the backend is known", () => {
      const items = composeSlashMenuItems([], [], null, true);
      expect(items.map((i) => i.name)).toEqual(["compact"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 omits the built-in compact item outside agent mode", () => {
      const skills = [makeSkill({ name: "compact", enabledAgents: ["claude"] })];
      const commands = [makeCommand({ title: "polish" })];
      const items = composeSlashMenuItems(skills, commands, null, false);
      expect(items.map((i) => [i.kind, i.name])).toEqual([
        ["skill", "compact"],
        ["command", "polish"],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 shadows a skill or command named compact with the built-in in agent mode", () => {
      const skills = [makeSkill({ name: "Compact", enabledAgents: ["claude"] })];
      const commands = [makeCommand({ title: "compact" }), makeCommand({ title: "polish" })];
      const items = composeSlashMenuItems(skills, commands, "claude", true);
      expect(items.map((i) => [i.kind, i.name])).toEqual([
        ["builtin", "compact"],
        ["command", "polish"],
      ]);
    });
  });

  describe("filterSlashMenuOptions()", () => {
    const option = (title: string, content = "") => ({ title, content });

    it("returns every option for an empty query", () => {
      const options = [option("b"), option("a")];
      expect(filterSlashMenuOptions(options, "")).toBe(options);
    });

    it("matches option titles by fuzzy query", () => {
      const options = [option("summarize"), option("polish")];
      expect(filterSlashMenuOptions(options, "smz").map((o) => o.title)).toEqual(["summarize"]);
    });

    it("falls back to matching option content when no title matches", () => {
      const options = [option("polish", "make the prose tighter"), option("other", "unrelated")];
      expect(filterSlashMenuOptions(options, "prose").map((o) => o.title)).toEqual(["polish"]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 ranks the built-in compact first for the exact query compact", () => {
      const skills = [
        makeSkill({ name: "compactor", enabledAgents: ["claude"] }),
        makeSkill({ name: "compact-notes", enabledAgents: ["claude"] }),
      ];
      const commands = [makeCommand({ title: "a-compact" }), makeCommand({ title: "Compact" })];
      const options = composeSlashMenuItems(skills, commands, "claude", true).map((item) => ({
        title: item.name,
        content: item.body,
        item,
      }));

      const ranked = filterSlashMenuOptions(options, "compact");

      expect(ranked[0].item.kind).toBe("builtin");
      expect(ranked.map((o) => o.title)).toEqual([
        "compact",
        "compactor",
        "a-compact",
        "compact-notes",
      ]);
    });
  });
});
