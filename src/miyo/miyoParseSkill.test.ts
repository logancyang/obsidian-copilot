import { BUILTIN_SKILLS, PLUS_ENV } from "@/builtinSkills/builtinSkills";
import { MIYO_PARSE_SKILL } from "@/miyo/miyoParseSkill";

describe("miyoParseSkill", () => {
  describe("MIYO_PARSE_SKILL", () => {
    const miyoParseScript = (ext: ".sh" | ".cmd"): string => {
      const file = MIYO_PARSE_SKILL.files.find((candidate) => candidate.path.endsWith(ext));
      if (!file) throw new Error(`miyo-parse ships no ${ext} script`);
      return file.content;
    };

    it("is a gated skill distinct from the always-seeded set and from Miyo search", () => {
      expect(BUILTIN_SKILLS).not.toContain(MIYO_PARSE_SKILL);
      expect(MIYO_PARSE_SKILL.name).toBe("miyo-parse");
      expect(MIYO_PARSE_SKILL.enabledAgents).toEqual(["claude", "codex", "opencode"]);
    });

    it("ships one wrapper per OS that runs `miyo parse` on a single quoted path", () => {
      expect(MIYO_PARSE_SKILL.files.map((file) => file.path)).toEqual([
        "miyo-parse.sh",
        "miyo-parse.cmd",
      ]);
      expect(miyoParseScript(".sh")).toContain('"$MIYO" parse "$FILE"');
      expect(miyoParseScript(".cmd")).toContain('"%MIYO%" parse "%~1"');
    });

    it("resolves Miyo's install path before falling back to PATH on each OS", () => {
      expect(miyoParseScript(".sh")).toContain("$HOME/.miyo/bin/miyo");
      expect(miyoParseScript(".sh")).toContain("command -v miyo");
      expect(miyoParseScript(".cmd")).toContain("%LOCALAPPDATA%\\Miyo\\bin\\miyo\\miyo.exe");
      expect(miyoParseScript(".cmd")).toContain("where miyo");
    });

    it("tells the agent to report a parse error and then read the file itself without retrying https://github.com/Brevilabs/obsidian-copilot-private/issues/656", () => {
      const { skillMd } = MIYO_PARSE_SKILL;
      expect(skillMd).toContain(
        "Report the error to the user, then read the file with any other tool you\nhave. Do not run `miyo parse` again on that file."
      );
      expect(skillMd).not.toMatch(/never fall back|copilot-read-pdf|\bPlus\b/i);
    });

    it("does not embed Copilot Plus credentials", () => {
      expect(MIYO_PARSE_SKILL.skillMd).not.toContain(PLUS_ENV.licenseKey);
      expect(MIYO_PARSE_SKILL.skillMd).not.toContain(PLUS_ENV.baseUrl);
      expect(miyoParseScript(".sh")).not.toContain(PLUS_ENV.licenseKey);
      expect(miyoParseScript(".cmd")).not.toContain(PLUS_ENV.licenseKey);
    });
  });
});
