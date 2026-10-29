import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import { EXCALIDRAW_SKILL } from "./excalidrawSkill";

const ISSUE_787 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/787";

describe("excalidrawSkill", () => {
  describe("EXCALIDRAW_SKILL", () => {
    it(`parses as copilot-excalidraw with the discovery validator and is offered to every agent (${ISSUE_787})`, () => {
      const parsed = parseSkillFile(EXCALIDRAW_SKILL.skillMd, EXCALIDRAW_SKILL.name);

      expect(parsed.frontmatter.name).toBe("copilot-excalidraw");
      expect(parsed.frontmatter.enabledAgents).toEqual(["claude", "codex", "opencode"]);
      expect(EXCALIDRAW_SKILL.skillMd).toContain(
        `copilot-builtin-version: "${EXCALIDRAW_SKILL.version}"`
      );
      expect(EXCALIDRAW_SKILL.defaultPreference).toBeUndefined();
    });

    it(`ships the outline script the skill runs through Excalidraw's script command (${ISSUE_787})`, () => {
      const outline = EXCALIDRAW_SKILL.files.find((file) => file.path === "scripts/outline.md");

      expect(EXCALIDRAW_SKILL.skillMd).toContain("`scripts/outline.md` next to this SKILL.md");
      expect(outline?.content).toContain("await ea.getSceneFromFile(file)");
      expect(outline?.content).toContain('.replace(/\\s*\\n\\s*/g, " ")');
      expect(outline?.content.trimEnd().endsWith("return { lines };")).toBe(true);
    });

    it(`points the script command at the outline next to the skill instead of a fixed skills folder (${ISSUE_787})`, () => {
      expect(EXCALIDRAW_SKILL.skillMd).not.toContain("copilot/skills/");
      expect(EXCALIDRAW_SKILL.skillMd).toContain(
        "obsidian-excalidraw-plugin:script script=<outline path> trusted=true"
      );
      expect(EXCALIDRAW_SKILL.skillMd).toContain(
        "Obsidian can't open files in hidden folders, so if you reached this skill through a link such as `.claude/skills/copilot-excalidraw`, use the folder that link points to."
      );
    });

    it(`tells a sandboxed agent to rerun a CLI call that cannot reach Obsidian with escalated permissions (${ISSUE_787})`, () => {
      expect(EXCALIDRAW_SKILL.skillMd).toContain(
        'Copilot runs inside Obsidian, so Obsidian is running during your session. If an obsidian command prints "The CLI is unable to find Obsidian" inside a sandbox, the sandbox is blocking the CLI\'s connection to the app: rerun that command with escalated permissions.'
      );
    });
  });
});
