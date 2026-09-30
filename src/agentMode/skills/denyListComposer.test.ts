import { composeDenyList } from "./denyListComposer";
import type { BackendId, Skill } from "./types";

function skill(name: string, enabledAgents: BackendId[]): Skill {
  return {
    name,
    description: `${name} skill`,
    filePath: `/x/${name}/SKILL.md`,
    dirPath: `/x/${name}`,
    body: "",
    enabledAgents,
    location: { kind: "canonical" },
  };
}

const CROSS: Record<BackendId, BackendId[]> = {
  opencode: ["claude", "codex"],
  claude: [],
  codex: [],
};

const deny = (skills: Skill[], b: BackendId) => composeDenyList(skills, b, CROSS[b]);

describe("denyListComposer", () => {
  describe("composeDenyList()", () => {
    it("denies in OpenCode a skill enabled only for Claude", () => {
      expect(deny([skill("claude-only", ["claude"])], "opencode")).toEqual(["claude-only"]);
    });

    it("denies in OpenCode a skill enabled only for Codex", () => {
      expect(deny([skill("codex-only", ["codex"])], "opencode")).toEqual(["codex-only"]);
    });

    it("does not deny in OpenCode a skill enabled for OpenCode, alone or alongside Claude", () => {
      const all = [skill("opencode-only", ["opencode"]), skill("shared", ["claude", "opencode"])];
      expect(deny(all, "opencode")).toEqual([]);
    });

    it("does not deny a custom skill that is enabled for no agent", () => {
      expect(deny([skill("unassigned", [])], "opencode")).toEqual([]);
    });

    it("denies nothing for backends that have no cross-discovered agents", () => {
      const all = [skill("a", ["claude"]), skill("b", ["codex"]), skill("c", ["opencode"])];
      expect(deny(all, "claude")).toEqual([]);
      expect(deny(all, "codex")).toEqual([]);
    });

    it("denies a disabled built-in despite its empty agent list https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      const disabled = { ...skill("disabled", []), builtin: true };
      expect(deny([disabled], "opencode")).toEqual(["disabled"]);
      expect(deny([disabled], "claude")).toEqual([]);
    });

    it("keeps a built-in usable for its enabled backend https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      const enabled = { ...skill("enabled", ["opencode"]), builtin: true };
      expect(deny([enabled], "opencode")).toEqual([]);
    });

    it("returns denied names sorted alphabetically from a mixed skill list", () => {
      const all = [
        skill("z-task", ["claude"]),
        skill("kept", ["opencode"]),
        skill("m-task", ["codex"]),
        skill("a-task", ["claude"]),
      ];
      expect(deny(all, "opencode")).toEqual(["a-task", "m-task", "z-task"]);
    });

    it("returns an empty list when there are no skills", () => {
      expect(deny([], "opencode")).toEqual([]);
    });
  });
});
