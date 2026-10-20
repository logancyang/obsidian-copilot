import { OBSIDIAN_SKILLS, OBSIDIAN_SKILLS_UPSTREAM_REVISION } from "./obsidianSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";

function skillMd(name: string): string {
  const skill = OBSIDIAN_SKILLS.find((candidate) => candidate.name === name);
  if (!skill) throw new Error(`missing Obsidian skill: ${name}`);
  return skill.skillMd;
}

describe("obsidianSkills", () => {
  describe("OBSIDIAN_SKILLS", () => {
    it("offers the four skills to every agent but defaults them to OpenCode, and Bases also to Codex, the agents the eval showed they help (https://github.com/Brevilabs/obsidian-copilot-private/issues/726)", () => {
      expect(OBSIDIAN_SKILLS.map((skill) => [skill.name, skill.defaultPreference])).toEqual([
        ["obsidian-markdown", { disabledAgents: ["claude", "codex"] }],
        ["obsidian-bases", { disabledAgents: ["claude"] }],
        ["json-canvas", { disabledAgents: ["claude", "codex"] }],
        ["obsidian-cli", { disabledAgents: ["claude", "codex"] }],
      ]);
      for (const skill of OBSIDIAN_SKILLS) {
        expect(skill.skillMd).toContain(`copilot-builtin-version: "${skill.version}"`);
      }
    });

    it("bumps the Markdown and CLI skill versions so existing vaults reseed their corrected guidance (https://github.com/Brevilabs/obsidian-copilot-private/issues/726)", () => {
      expect(OBSIDIAN_SKILLS.map((skill) => [skill.name, skill.version])).toEqual([
        ["obsidian-markdown", 2],
        ["obsidian-bases", 2],
        ["json-canvas", 2],
        ["obsidian-cli", 3],
      ]);
    });

    it("parses each SKILL.md with the same validator used by discovery", () => {
      for (const skill of OBSIDIAN_SKILLS) {
        const parsed = parseSkillFile(skill.skillMd, skill.name);
        expect(parsed.frontmatter.name).toBe(skill.name);
        expect(parsed.frontmatter.enabledAgents).toEqual(["claude", "codex", "opencode"]);
      }
    });

    it("pins and attributes the upstream MIT-licensed source", () => {
      expect(OBSIDIAN_SKILLS_UPSTREAM_REVISION).toBe("a1dc48e68138490d522c04cbf5822214c6eb1202");
      for (const skill of OBSIDIAN_SKILLS) {
        expect(skill.skillMd).toContain(
          `copilot-upstream-revision: "${OBSIDIAN_SKILLS_UPSTREAM_REVISION}"`
        );
        expect(skill.skillMd).toContain("license: MIT");
        const license = skill.files.find((file) => file.path === "LICENSE");
        expect(license?.content).toContain("Copyright (c) 2026 Steph Ango");
        expect(license?.content).toContain("MIT License");
      }
    });

    it("ships every relative reference linked from a SKILL.md", () => {
      for (const skill of OBSIDIAN_SKILLS) {
        const linkedPaths = [...skill.skillMd.matchAll(/\]\((references\/[^)]+)\)/g)].map(
          (match) => match[1]
        );
        const shippedPaths = skill.files.map((file) => file.path);
        for (const linkedPath of linkedPaths) {
          expect(shippedPaths).toContain(linkedPath);
        }
      }
    });

    it("keeps the Markdown skill focused on Obsidian extensions", () => {
      const md = skillMd("obsidian-markdown");
      expect(md).toContain("Wikilinks and block references");
      expect(md).toContain("![[document.pdf#page=3]]");
      expect(md).toContain("> [!warning]");
      expect(md).toContain("%%inline comments%%");
      expect(md).not.toContain("## Math");
      expect(md).not.toContain("## Diagrams");
      expect(md).not.toContain("## Footnotes");
      expect(OBSIDIAN_SKILLS.find((skill) => skill.name === "obsidian-markdown")?.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "references/CALLOUTS.md" }),
          expect.objectContaining({ path: "references/EMBEDS.md" }),
          expect.objectContaining({ path: "references/PROPERTIES.md" }),
        ])
      );
    });

    it("names the Markdown syntax that should trigger the skill and puts a list's block ID between blank lines (https://github.com/Brevilabs/obsidian-copilot-private/issues/726)", () => {
      const md = skillMd("obsidian-markdown");
      expect(md).toMatch(
        /description:[^\n]*block IDs[^\n]*Load before adding or changing any of these in a note\./
      );
      expect(md).not.toContain("ordinary Markdown is assumed knowledge");
      expect(md).toContain(
        "Put a block ID on its own line after a list or quote block, with a blank line\nbefore and after it; without the line before it marks only the last item."
      );
    });

    it("explains how template insertion fills the title and date placeholders (https://github.com/Brevilabs/obsidian-copilot-private/issues/726)", () => {
      const md = skillMd("obsidian-cli");
      expect(md).toContain("<code>create path=&lt;new note&gt; template=&lt;name&gt;</code>");
      expect(md).toContain(
        "<code>{{title}}</code> becomes the new note's full file name without\n  extension"
      );
      expect(md).toContain(
        "<code>{{date}}</code> and <code>{{time}}</code> become the\n  current date and time"
      );
    });

    it("keeps example wikilinks inside code fences so installed skills add no unresolved links to the vault (https://github.com/Brevilabs/obsidian-copilot-private/issues/726)", () => {
      const documents = OBSIDIAN_SKILLS.flatMap((skill) => [
        skill.skillMd,
        ...skill.files.filter((file) => file.path.endsWith(".md")).map((file) => file.content),
      ]);
      for (const document of documents) {
        let fence: string | null = null;
        for (const line of document.split("\n")) {
          const marker = line.match(/^\s*(~~~|```)/)?.[1];
          if (marker) {
            fence = fence === marker ? null : (fence ?? marker);
          } else if (fence === null) {
            expect(line).not.toMatch(/\[\[/);
          }
        }
      }
    });

    it("documents that Bases sorts only by properties listed in the view's order, and rounds day counts (https://github.com/Brevilabs/obsidian-copilot-private/issues/726)", () => {
      const md = skillMd("obsidian-bases");
      expect(md).toContain("    sort:\n      - property: due\n        direction: ASC");
      expect(md).toContain(
        "Obsidian sorts only by properties that are also listed in\n<code>order</code>, so include every sort property there."
      );
      expect(md).toContain(
        "- Every <code>sort</code> property also appears in that view's <code>order</code>."
      );
      expect(md).toContain("(date(due) - today()).days.round()");
      expect(md).not.toMatch(/today\(\)\)\.days,/);
    });

    it("preserves Bases schema, formula, quoting, and duration guidance", () => {
      const md = skillMd("obsidian-bases");
      expect(md).toContain("formulas:");
      expect(md).toContain("views:");
      expect(md).toContain("file.backlinks");
      expect(md).toContain("Date subtraction returns a Duration");
      expect(md).toContain("Wrap formulas containing double quotes in YAML single quotes");
      expect(OBSIDIAN_SKILLS.find((skill) => skill.name === "obsidian-bases")?.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "references/FUNCTIONS_REFERENCE.md" }),
          expect.objectContaining({ path: "references/EXAMPLES.md" }),
        ])
      );
    });

    it("preserves JSON Canvas schema, layout, color, and integrity guidance", () => {
      const md = skillMd("json-canvas");
      expect(md).toContain("16-character hexadecimal ID");
      expect(md).toContain('"fromNode"');
      expect(md).toContain('"toNode"');
      expect(md).toContain("IDs are unique across nodes and edges");
      expect(md).toContain('"1"');
      expect(OBSIDIAN_SKILLS.find((skill) => skill.name === "json-canvas")?.files).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "references/EXAMPLES.md" })])
      );
    });

    it("uses the CLI only for Obsidian runtime, index, and developer capabilities", () => {
      const md = skillMd("obsidian-cli");
      expect(md).toMatch(/description:[^\n]*currently open notes and tabs/);
      expect(md).toContain("COPILOT_OBSIDIAN_CLI");
      expect(md).toContain('obsidian_cli="${COPILOT_OBSIDIAN_CLI:-obsidian}"');
      expect(md).toContain('"$obsidian_cli" version');
      expect(md).toContain("& $obsidianCli version");
      expect(md).toContain("always invoke it as a quoted executable");
      expect(md).toContain("Use the selected executable in place");
      expect(md).toContain("probe must exit\nsuccessfully");
      expect(md).toContain("obsidian help <command>");
      expect(md).toContain("Settings → General → Command line\ninterface");
      expect(md).toContain('obsidian vault="My Vault"');
      expect(md).toContain("property:set");
      expect(md).toContain("base:query");
      expect(md).toContain("template:read ... resolve title=");
      expect(md).toContain('obsidian vault="My Vault" tabs ids');
      expect(md).toContain('obsidian vault="My Vault" workspace ids');
      expect(md).toContain("Keep entries\nverbatim");
      expect(md).toContain("a Markdown note has an explicit vault path ending");
      expect(md).toContain("another file-backed tab has an explicit vault path");
      expect(md).toContain("a non-file view, such as search, graph, settings, or a plugin view");
      expect(md).toContain("Do not infer a path from a display title, view type, or tab ID");
      expect(md).toContain("do not\ndiscard entries that cannot be classified");
      expect(md).toContain("app.workspace.iterateAllLeaves");
      expect(md).toContain("app.workspace.getMostRecentLeaf()");
      expect(md).toContain("leaf.getDisplayText()");
      expect(md).toContain("leaf.view.getViewType()");
      expect(md).toContain('endsWith(".md")');
      expect(md).toContain("Only call an entry\nan open tab when its ID appears");
      expect(md).toContain("sidebar and floating leaves");
      expect(md).toContain("Preserve tab entries that have no\nmatching workspace entry");
      expect(md).toContain("getMostRecentLeaf()?.view.file?.path");
      expect(md).toContain("substitute <code>recents</code>");
      expect(md).toContain(
        "Use normal filesystem tools only for explicit paths returned by Obsidian"
      );
      expect(md).toContain("commands filter=");
      expect(md).toContain("plugin:reload");
      expect(md).toContain("For a plugin other than Copilot");
      expect(md).toContain("Never reload the\n   Copilot plugin");
      expect(md).toContain("dev:errors");
      expect(md).toContain("dev:screenshot");
      expect(md).toContain("dev:dom");
      expect(md).toContain("dev:css");
      expect(md).toContain("dev:mobile");
      expect(md).toContain("Preserve the host session");
      expect(md).toContain("any CLI command that reloads or restarts the app");
      expect(md).toContain("any plugin reload, disable, or uninstall operation targeting Copilot");
      expect(md).toContain("any restricted-mode change");
      expect(md).toContain("command ID, JavaScript expression, or CDP call");
      expect(md).toContain("hard prohibition, not a confirmation-gated operation");
      expect(md).toContain("manually after the agent session has ended");
      expect(md).toContain("Risky operations require explicit intent");
      expect(md).toContain("permanent deletion");
      expect(md).toContain("mutating JavaScript evaluation or CDP calls");
      expect(md).toContain("Explicit intent does not override the host-session prohibition");
      expect(md).not.toContain("- restarting Obsidian");
      expect(md).not.toContain("- changing restricted mode");
      expect(md).not.toContain("obsidian reload");
      expect(md).not.toContain("obsidian restart");
      expect(md).not.toContain("plugin:reload id=copilot");
      expect(md).not.toContain("plugin:disable id=copilot");
      expect(md).not.toContain("plugin:uninstall id=copilot");
      expect(md).not.toContain("plugins:restrict on");
      expect(md).toContain("Use normal shell\nfilesystem tools");
      expect(md).not.toContain("obsidian read file=");
      expect(md).not.toContain("obsidian create name=");
      expect(md).not.toContain("obsidian search query=");
      expect(md).not.toContain(" silent ");
    });
  });
});
