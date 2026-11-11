import type { Skill } from "@/agentMode";
import type { CustomCommand } from "@/commands/type";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { makeReadOnlySkill } from "@/agentMode/skills/testing/readOnlySkillFixtures";
import {
  $slashStartsPrompt,
  composeSlashMenuItems,
  filterSlashMenuOptions,
  slashMenuOption,
} from "./slashMenuItems";

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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 shadows a skill or command named exactly compact with the built-in in agent mode, leaving other casings listed because /Compact still expands them", () => {
      const skills = [makeSkill({ name: "compact", enabledAgents: ["claude"] })];
      const commands = [
        makeCommand({ title: "compact" }),
        makeCommand({ title: "Compact" }),
        makeCommand({ title: "polish" }),
      ];
      const items = composeSlashMenuItems(skills, commands, "claude", true);
      expect(items.map((i) => [i.kind, i.name])).toEqual([
        ["builtin", "compact"],
        ["command", "Compact"],
        ["command", "polish"],
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 lists vault skills, then skills linked into vault agent folders, then skills from agent folders on this computer, then commands, each tagged with where it comes from", () => {
      const items = composeSlashMenuItems(
        [
          makeSkill({ name: "summarize", enabledAgents: ["claude"] }),
          makeSkill({ name: "obsidian-markdown", enabledAgents: ["claude"], builtin: true }),
        ],
        [makeCommand({ title: "polish" })],
        "claude",
        false,
        [
          makeReadOnlySkill({ name: "release-notes" }),
          makeReadOnlySkill({ name: "linked", scope: "vault", folders: ["/vault/.claude/skills"] }),
        ]
      );
      expect(items.map((i) => [i.name, i.kind === "builtin" ? null : i.source])).toEqual([
        ["summarize", "Vault"],
        ["obsidian-markdown", "Built-in"],
        ["linked", "Vault"],
        ["release-notes", "Computer"],
        ["polish", "Command"],
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 hides a skill from an agent folder when the active agent does not load that folder", () => {
      const readOnly = [
        makeReadOnlySkill({ name: "claude-only", agents: ["claude"] }),
        makeReadOnlySkill({ name: "shared", agents: ["claude", "opencode"] }),
      ];
      expect(composeSlashMenuItems([], [], "opencode", false, readOnly).map((i) => i.name)).toEqual(
        ["shared"]
      );
      expect(composeSlashMenuItems([], [], null, false, readOnly).map((i) => i.name)).toEqual([
        "claude-only",
        "shared",
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 hides skills from agent folders marked user-invocable: false", () => {
      const items = composeSlashMenuItems([], [], "claude", false, [
        makeReadOnlySkill({ name: "background", userInvocable: false }),
      ]);
      expect(items).toEqual([]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 keeps one skill per name, case-insensitively, preferring vault skills over skills on this computer, and shadows commands with that name", () => {
      const items = composeSlashMenuItems(
        [makeSkill({ name: "review", enabledAgents: ["claude"] })],
        [makeCommand({ title: "Deploy" })],
        "claude",
        false,
        [
          makeReadOnlySkill({ name: "Review" }),
          makeReadOnlySkill({ name: "deploy", folders: ["/home/me/.agents/skills"] }),
          makeReadOnlySkill({ name: "deploy", scope: "vault" }),
        ]
      );
      expect(items.map((i) => [i.name, i.kind === "builtin" ? null : i.source])).toEqual([
        ["review", "Vault"],
        ["deploy", "Vault"],
      ]);
    });
  });

  describe("slashMenuOption()", () => {
    it("https://github.com/logancyang/obsidian-copilot/issues/3659 shows each skill's and command's source as a tag next to its name", () => {
      const [skill, command] = composeSlashMenuItems(
        [],
        [makeCommand({ title: "polish" })],
        "claude",
        false,
        [makeReadOnlySkill({ name: "release-notes" })]
      );
      const skillOption = slashMenuOption(skill);
      expect(skillOption).toMatchObject({
        key: skill.key,
        title: "release-notes",
        subtitle: "desc for release-notes",
        content: "body for release-notes",
        item: skill,
      });
      expect((skillOption.trailingContent as React.ReactElement).props.children).toBe("Computer");
      expect((slashMenuOption(command).trailingContent as React.ReactElement).props.children).toBe(
        "Command"
      );
    });

    it("leaves the built-in compact item untagged", () => {
      const [compact] = composeSlashMenuItems([], [], "claude", true);
      expect(slashMenuOption(compact).trailingContent).toBeUndefined();
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
      const commands = [makeCommand({ title: "a-compact" }), makeCommand({ title: "compact" })];
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

  describe("$slashStartsPrompt()", () => {
    function slashStartsPromptFor(paragraphs: string[]): boolean {
      const editor = createEditor({
        namespace: "slash-starts-prompt-test",
        onError: (e) => {
          throw e;
        },
      });
      let result: boolean | undefined;
      editor.update(
        () => {
          const nodes = paragraphs.map((text) => $createTextNode(text));
          for (const node of nodes) $getRoot().append($createParagraphNode().append(node));
          const last = nodes[nodes.length - 1];
          last.select(last.getTextContentSize(), last.getTextContentSize());
          result = $slashStartsPrompt();
        },
        { discrete: true }
      );
      return result!;
    }

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 is true when the slash begins an otherwise empty prompt", () => {
      expect(slashStartsPromptFor(["/co"])).toBe(true);
      expect(slashStartsPromptFor(["", "  /co"])).toBe(true);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 is false when text precedes the slash in the same or an earlier paragraph", () => {
      expect(slashStartsPromptFor(["review this /co"])).toBe(false);
      expect(slashStartsPromptFor(["review this", "/co"])).toBe(false);
    });
  });
});
