import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import { SCREENPIPE_ACTIVITY_SKILL } from "./screenpipeSkill";

describe("screenpipeSkill", () => {
  describe("SCREENPIPE_ACTIVITY_SKILL", () => {
    it("is a valid opt-in skill visible to every Agent Mode backend", () => {
      const parsed = parseSkillFile(
        SCREENPIPE_ACTIVITY_SKILL.skillMd,
        SCREENPIPE_ACTIVITY_SKILL.name
      );

      expect(SCREENPIPE_ACTIVITY_SKILL.enabledAgents).toEqual([]);
      expect(parsed.frontmatter.enabledAgents).toEqual([]);
      expect(parsed.frontmatter.description).toMatch(/screenpipe screen and audio history/i);
      expect(parsed.frontmatter.description).toMatch(/Do not use for ordinary vault questions/i);
      expect(SCREENPIPE_ACTIVITY_SKILL.skillMd).toContain(
        `copilot-builtin-version: "${SCREENPIPE_ACTIVITY_SKILL.version}"`
      );
    });

    it("keeps retrieval bounded and treats missing capture as inconclusive per https://github.com/screenpipe/screenpipe/issues/4351", () => {
      const md = SCREENPIPE_ACTIVITY_SKILL.skillMd;

      expect(md).toContain("explicit ISO 8601 start and end times");
      expect(md).toContain("limit no greater than 20");
      expect(md).toContain("Keep `include_frames` false");
      expect(md).toContain("An empty result is inconclusive");
      expect(md).toContain("counts measure capture volume rather than duration");
    });

    it("does not authorize installation, persistence, exports, or sharing", () => {
      const md = SCREENPIPE_ACTIVITY_SKILL.skillMd;

      expect(md).toContain("does not install screenpipe");
      expect(md).toContain("Do not edit an agent configuration");
      expect(md).toContain("Do not call `export-video`");
      expect(md).toMatch(/create\s+or update an Obsidian note/);
      expect(md).toMatch(/share captured data unless the\s+user explicitly requests/);
      expect(md).toContain("that model may run outside the user's computer");
    });
  });
});
