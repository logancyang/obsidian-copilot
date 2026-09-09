import { DEFAULT_SETTINGS } from "@/constants";
import { ALL_MANAGED_SKILLS, BUILTIN_SKILLS } from "./builtinSkills";
import {
  availableBuiltinAgents,
  reconcileBuiltinSkills,
  type BuiltinPreferences,
} from "./reconcileBuiltinSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import type { BuiltinSeedFs } from "./seedBuiltinSkills";

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
const folder = "copilot/skills";
function fixture(preferences?: BuiltinPreferences) {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const fs: BuiltinSeedFs = {
    exists: async (path) => files.has(path) || dirs.has(path),
    read: async (path) => {
      if (!files.has(path)) throw new Error("unreadable");
      return files.get(path)!;
    },
    write: async (path, content) => {
      files.set(path, content);
    },
    mkdir: async (path) => {
      dirs.add(path);
    },
    removeFile: async (path) => {
      files.delete(path);
    },
    rmRecursive: async (path) => {
      for (const key of files.keys()) if (key.startsWith(`${path}/`)) files.delete(key);
      dirs.delete(path);
    },
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    agentMode: { ...DEFAULT_SETTINGS.agentMode, skills: { ...DEFAULT_SETTINGS.agentMode.skills } },
  };
  settings.agentMode.skills.builtinPreferences = preferences;
  const savePreferences = jest.fn(async (next: BuiltinPreferences) => {
    settings.agentMode.skills.builtinPreferences = next;
  });
  const options = {
    folder,
    fs,
    settings,
    availableAgents: [] as string[],
    registeredAgents: ["claude", "codex", "opencode"],
    savePreferences,
  };
  return {
    files,
    dirs,
    options,
    savePreferences,
    path: (name: string) => `${folder}/${name}/SKILL.md`,
  };
}

describe("reconcileBuiltinSkills", () => {
  describe("availableBuiltinAgents()", () => {
    it(`preserves a known ready agent during checking without enabling an unverified first install ${ISSUE}`, () => {
      expect(
        availableBuiltinAgents(
          {
            claude: { kind: "checking", source: "custom" },
            codex: { kind: "checking", source: "custom" },
            opencode: { kind: "ready", source: "managed" },
          },
          ["claude"]
        )
      ).toEqual(["claude", "opencode"]);
      expect(
        availableBuiltinAgents(
          { claude: { kind: "absent" }, codex: { kind: "error", message: "incompatible" } },
          ["claude", "codex"]
        )
      ).toEqual([]);
    });
  });
  describe("reconcileBuiltinSkills()", () => {
    it(`preserves current-name user content containing a body marker with no agents and with an available agent ${ISSUE}`, async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture();
      const content = `---\nname: ${skill.name}\ndescription: A user-owned skill.\n---\nExample:\n  copilot-builtin-version: "1"`;
      f.files.set(f.path(skill.name), content);
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path(skill.name))).toBe(content);
      f.options.availableAgents = ["claude"];
      await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow(
        "A user-owned skill occupies"
      );
      expect(f.files.get(f.path(skill.name))).toBe(content);
    });
    it(`reports incomplete writes instead of claiming installation succeeded ${ISSUE}`, async () => {
      const f = fixture();
      f.options.availableAgents = ["claude"];
      f.options.fs.write = async () => {
        throw new Error("disk full");
      };
      await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow(
        "Could not install built-in skill"
      );
    });
    it(`keeps a saved legacy-name opt-out after a built-in rename ${ISSUE}`, async () => {
      const skill = ALL_MANAGED_SKILLS.find((item) => item.legacyName)!;
      const f = fixture({ [skill.legacyName!]: { disabled: true, disabledAgents: ["opencode"] } });
      f.options.availableAgents = ["claude"];
      await reconcileBuiltinSkills(f.options);
      expect(f.options.settings.agentMode.skills.builtinPreferences?.[skill.name]).toEqual({
        disabled: true,
        disabledAgents: ["opencode"],
      });
      expect(f.files.has(f.path(skill.name))).toBe(false);
    });
    it(`creates no folders without an available agent and records no opt-outs for unavailable agents ${ISSUE}`, async () => {
      const f = fixture();
      await reconcileBuiltinSkills(f.options);
      expect(f.files.size).toBe(0);
      expect(f.dirs.size).toBe(0);
      expect(
        f.options.settings.agentMode.skills.builtinPreferences?.[BUILTIN_SKILLS[0].name]
      ).toEqual({ disabledAgents: [] });
    });
    it(`enables a newly available agent while preserving whole-skill and per-agent opt-outs through regeneration ${ISSUE}`, async () => {
      const first = BUILTIN_SKILLS[0];
      const second = BUILTIN_SKILLS[1];
      const f = fixture({
        [first.name]: { disabledAgents: ["opencode"] },
        [second.name]: { disabled: true },
      });
      f.options.availableAgents = ["claude"];
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path(second.name))).toBe(false);
      f.options.availableAgents.push("opencode", "codex");
      await reconcileBuiltinSkills(f.options);
      expect(
        parseSkillFile(f.files.get(f.path(first.name))!, first.name).frontmatter.enabledAgents
      ).toEqual(["claude", "codex"]);
      const third = BUILTIN_SKILLS[2];
      expect(
        parseSkillFile(f.files.get(f.path(third.name))!, third.name).frontmatter.enabledAgents
      ).toEqual(["claude", "opencode", "codex"]);
      f.files.delete(f.path(first.name));
      await reconcileBuiltinSkills(f.options);
      expect(
        parseSkillFile(f.files.get(f.path(first.name))!, first.name).frontmatter.enabledAgents
      ).not.toContain("opencode");
    });
    it(`imports omitted agents only once, including a renamed predecessor ${ISSUE}`, async () => {
      const skill = ALL_MANAGED_SKILLS.find((item) => item.legacyName)!;
      const f = fixture();
      f.files.set(
        f.path(skill.legacyName!),
        skill.skillMd
          .replace(`name: ${skill.name}`, `name: ${skill.legacyName}`)
          .replace(/copilot-enabled-agents:.*/, "copilot-enabled-agents: claude")
      );
      f.options.availableAgents = ["claude", "opencode"];
      await reconcileBuiltinSkills(f.options);
      expect(
        f.options.settings.agentMode.skills.builtinPreferences?.[skill.name].disabledAgents
      ).toEqual(["codex", "opencode"]);
      expect(f.files.has(f.path(skill.legacyName!))).toBe(false);
      f.files.delete(f.path(skill.name));
      await reconcileBuiltinSkills(f.options);
      expect(f.savePreferences).toHaveBeenCalledTimes(1);
      expect(
        parseSkillFile(f.files.get(f.path(skill.name))!, skill.name).frontmatter.enabledAgents
      ).toEqual(["claude"]);
    });
    it(`deletes disabled managed copies but preserves user-owned name collisions ${ISSUE}`, async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture();
      f.options.availableAgents = ["claude"];
      await reconcileBuiltinSkills(f.options);
      f.options.settings.agentMode.skills.builtinPreferences![skill.name].disabled = true;
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path(skill.name))).toBe(false);
      f.files.set(f.path(skill.name), "user-owned content");
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path(skill.name))).toBe("user-owned content");
    });
    it(`does not mutate files if migration preferences cannot be saved ${ISSUE}`, async () => {
      const f = fixture();
      f.options.availableAgents = ["claude"];
      f.savePreferences.mockRejectedValueOnce(new Error("save failed"));
      await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow("save failed");
      expect(f.files.size).toBe(0);
    });
    it(`surfaces disabled-file cleanup failures while retaining the opt-out ${ISSUE}`, async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture({ [skill.name]: { disabled: true } });
      f.files.set(f.path(skill.name), skill.skillMd);
      f.options.fs.rmRecursive = async () => {
        throw new Error("permission denied");
      };
      await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow("Could not remove disabled");
      expect(f.options.settings.agentMode.skills.builtinPreferences?.[skill.name].disabled).toBe(
        true
      );
    });
  });
});
