import { OBSIDIAN_SKILLS, OBSIDIAN_SKILLS_UPSTREAM_REVISION } from "./obsidianSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";

function skillMd(name: string): string {
  const skill = OBSIDIAN_SKILLS.find((candidate) => candidate.name === name);
  if (!skill) throw new Error(`missing Obsidian skill: ${name}`);
  return skill.skillMd;
}

describe("obsidianSkills", () => {
  describe("OBSIDIAN_SKILLS", () => {
    it("offers the three skills to every agent but defaults Markdown to every agent, Bases to Codex and OpenCode, and Canvas to OpenCode, the agents the eval showed they help; Claude broke Mermaid semicolons without Markdown (https://github.com/Brevilabs/obsidian-copilot-private/issues/726, https://github.com/logancyang/obsidian-copilot/issues/3868)", () => {
      expect(OBSIDIAN_SKILLS.map((skill) => [skill.name, skill.defaultPreference])).toEqual([
        ["obsidian-markdown", undefined],
        ["obsidian-bases", { disabledAgents: ["claude"] }],
        ["json-canvas", { disabledAgents: ["claude", "codex"] }],
      ]);
      for (const skill of OBSIDIAN_SKILLS) {
        expect(skill.skillMd).toContain(`copilot-builtin-version: "${skill.version}"`);
      }
    });

    it("bumps every skill whose guidance or description changed so existing vaults reseed it (https://github.com/Brevilabs/obsidian-copilot-private/issues/726, https://github.com/logancyang/obsidian-copilot/issues/3868, https://github.com/logancyang/obsidian-copilot/issues/3666, https://github.com/logancyang/obsidian-copilot/issues/3980)", () => {
      expect(OBSIDIAN_SKILLS.map((skill) => [skill.name, skill.version])).toEqual([
        ["obsidian-markdown", 5],
        ["obsidian-bases", 3],
        ["json-canvas", 3],
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

    it("names the Markdown syntax that should trigger the skill and puts a list's block ID between blank lines (https://github.com/Brevilabs/obsidian-copilot-private/issues/726, https://github.com/logancyang/obsidian-copilot/issues/3980)", () => {
      const md = skillMd("obsidian-markdown");
      const { description } = parseSkillFile(md, "obsidian-markdown").frontmatter;
      for (const job of [
        "wikilinks",
        "block IDs (^id) with block and list embeds",
        "heading embeds",
        "callouts",
        "properties and frontmatter",
        "Load before adding or changing any of these in a note",
      ]) {
        expect(description).toContain(job);
      }
      expect(md).not.toContain("ordinary Markdown is assumed knowledge");
      expect(md).toContain(
        "Put a block ID on its own line after a list or quote block, with a blank line\nbefore and after it; without the line before it marks only the last item."
      );
    });

    it("escapes pipes inside table math and keeps scripted $$ replacements literal, the two math forms agents still broke on current text (https://github.com/logancyang/obsidian-copilot/issues/3868)", () => {
      const md = skillMd("obsidian-markdown");
      expect(md).toContain(
        "In a table, write a pipe inside math as <code>\\lvert</code>/<code>\\rvert</code>\n  and anywhere else as <code>\\|</code>; a bare <code>|</code> starts a new column."
      );
      expect(md).toContain("| Absolute value | $\\lvert x \\rvert$ |");
      expect(md).toContain(
        "(JavaScript <code>replace</code> turns <code>$$</code> into <code>$</code>)"
      );
    });

    it("writes a semicolon in a Mermaid message as #59; and loads before any Mermaid diagram, since a bare one ends the statement (https://github.com/logancyang/obsidian-copilot/issues/3868)", () => {
      const md = skillMd("obsidian-markdown");
      const { description } = parseSkillFile(md, "obsidian-markdown").frontmatter;
      expect(description).toContain("before drawing a Mermaid diagram in a note or a reply");
      expect(md).toContain("Copilot->>Vault: Write the TL#59;DR");
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

    it("documents that Bases sorts only by properties listed in the view's order, and rounds day counts (https://github.com/Brevilabs/obsidian-copilot-private/issues/726, https://github.com/logancyang/obsidian-copilot/issues/3980)", () => {
      const md = skillMd("obsidian-bases");
      const { description } = parseSkillFile(md, "obsidian-bases").frontmatter;
      expect(description).toContain("formulas");
      expect(description).toContain("the columns a view shows (order) and its row sorting (sort)");
      expect(description).toContain("Load before writing or changing any .base file");
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

    it("triggers the Canvas skill for any .canvas file, including file cards that show one section or block of a note (https://github.com/logancyang/obsidian-copilot/issues/3980)", () => {
      const md = skillMd("json-canvas");
      const { description } = parseSkillFile(md, "json-canvas").frontmatter;
      expect(description).toContain(
        "file cards that show one section or block of a note (subpath)"
      );
      expect(description).toContain("Load before writing or changing any .canvas file");
      expect(md).toContain("Vault file; optional <code>subpath</code>");
    });
  });
});
