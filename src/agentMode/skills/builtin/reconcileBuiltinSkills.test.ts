import { DEFAULT_SETTINGS } from "@/constants";
import {
  ALL_MANAGED_SKILLS,
  BUILTIN_SKILLS,
  RETIRED_BUILTIN_SKILLS,
} from "@/builtinSkills/builtinSkills";
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
    removeDir: async (path) => {
      for (const file of files.keys()) {
        if (file.startsWith(`${path}/`)) files.delete(file);
      }
      for (const dir of dirs) {
        if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      }
    },
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    agentMode: { ...DEFAULT_SETTINGS.agentMode, skills: { ...DEFAULT_SETTINGS.agentMode.skills } },
  };
  settings.agentMode.skills.builtinPreferences = preferences;
  const options = {
    folder,
    fs,
    settings,
    availableAgents: [] as string[],
    registeredAgents: ["claude", "codex", "opencode"],
  };
  return {
    files,
    dirs,
    options,
    path: (name: string) => `${folder}/${name}/SKILL.md`,
  };
}

describe("reconcileBuiltinSkills", () => {
  describe("availableBuiltinAgents()", () => {
    it("reuses the ready agent list when membership is unchanged https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      const previous = ["claude"];
      expect(
        availableBuiltinAgents({ claude: { kind: "ready", source: "managed" } }, previous)
      ).toBe(previous);
    });

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
    it(`keeps canonical metadata stable across devices and retains existing files without a local agent ${ISSUE}`, async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture();
      f.options.availableAgents = ["claude"];
      await reconcileBuiltinSkills(f.options);
      const content = f.files.get(f.path(skill.name));
      expect(parseSkillFile(content!, skill.name).frontmatter.enabledAgents).toEqual([
        "claude",
        "codex",
        "opencode",
      ]);
      f.options.availableAgents = ["codex"];
      f.options.settings.agentMode.skills.builtinPreferences = undefined;
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path(skill.name))).toBe(content);
      expect(f.options.settings.agentMode.skills.builtinPreferences).toBeUndefined();
      f.options.availableAgents = [];
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path(skill.name))).toBe(content);
      const userPath = `${folder}/${skill.name}/references/personal.md`;
      f.files.set(userPath, "personal reference");
      f.options.settings.agentMode.skills.builtinPreferences = { [skill.name]: { disabled: true } };
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path(skill.name))).toBe(false);
      expect(f.files.has(userPath)).toBe(false);
    });
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
    it(`starts a replacement with defaults and retires its predecessor independently of old preferences ${ISSUE}`, async () => {
      const retired = RETIRED_BUILTIN_SKILLS[0];
      const replacement = ALL_MANAGED_SKILLS.find(
        (skill) => skill.name === "openartifacts-publish"
      )!;
      const f = fixture({ [retired.name]: { disabled: true, disabledAgents: ["codex"] } });
      f.files.set(
        f.path(retired.name),
        replacement.skillMd.replace(`name: ${replacement.name}`, `name: ${retired.name}`)
      );
      f.options.availableAgents = ["claude"];
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path(retired.name))).toBe(false);
      expect(
        parseSkillFile(f.files.get(f.path(replacement.name))!, replacement.name).frontmatter
          .enabledAgents
      ).toEqual(["claude", "codex", "opencode"]);
      expect(
        f.options.settings.agentMode.skills.builtinPreferences?.[replacement.name]
      ).toBeUndefined();
    });
    it(`retires installed skills without an available agent or a saved preference and removes user additions ${ISSUE}`, async () => {
      const retired = RETIRED_BUILTIN_SKILLS[0];
      const f = fixture();
      f.files.set(f.path(retired.name), BUILTIN_SKILLS[0].skillMd);
      const userPath = `${folder}/${retired.name}/references/personal.md`;
      f.files.set(userPath, "personal");
      await reconcileBuiltinSkills(f.options);
      expect(f.files.size).toBe(0);
      expect(f.options.settings.agentMode.skills.builtinPreferences).toBeUndefined();
    });
    it(`reports retired cleanup failures, continues installing defaults, and retries without preference records ${ISSUE}`, async () => {
      const retired = RETIRED_BUILTIN_SKILLS[0];
      const f = fixture();
      f.files.set(f.path(retired.name), BUILTIN_SKILLS[0].skillMd);
      f.options.availableAgents = ["claude"];
      const remove = f.options.fs.removeDir;
      f.options.fs.removeDir = async () => {
        throw new Error("permission denied");
      };
      await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow("Could not remove retired");
      expect(f.files.has(f.path(retired.name))).toBe(true);
      expect(f.files.has(f.path(BUILTIN_SKILLS[0].name))).toBe(true);
      expect(f.options.settings.agentMode.skills.builtinPreferences).toBeUndefined();
      f.options.fs.removeDir = remove;
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path(retired.name))).toBe(false);
    });
    it(`creates no folders without an available agent and records no opt-outs for unavailable agents ${ISSUE}`, async () => {
      const f = fixture();
      await reconcileBuiltinSkills(f.options);
      expect(f.files.size).toBe(0);
      expect(f.dirs.size).toBe(0);
      expect(
        f.options.settings.agentMode.skills.builtinPreferences?.[BUILTIN_SKILLS[0].name]
      ).toBeUndefined();
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
      ).toEqual(["claude", "codex", "opencode"]);
      f.files.delete(f.path(first.name));
      await reconcileBuiltinSkills(f.options);
      expect(
        parseSkillFile(f.files.get(f.path(first.name))!, first.name).frontmatter.enabledAgents
      ).not.toContain("opencode");
    });
    it(`uses defaults for a newly bundled skill without adding or changing preferences ${ISSUE}`, async () => {
      const first = BUILTIN_SKILLS[0];
      const f = fixture({ [first.name]: { disabledAgents: ["opencode"] } });
      const preferences = f.options.settings.agentMode.skills.builtinPreferences;
      const added = {
        ...first,
        name: "new-bundled-skill",
        skillMd: first.skillMd.replaceAll(first.name, "new-bundled-skill"),
      };
      const catalog = ALL_MANAGED_SKILLS as (typeof added)[];
      catalog.push(added);
      try {
        // The base catalog supplies default feature eligibility too.
        (BUILTIN_SKILLS as (typeof added)[]).push(added);
        f.options.availableAgents = ["claude"];
        await reconcileBuiltinSkills(f.options);
        expect(f.files.has(f.path(added.name))).toBe(true);
        expect(f.options.settings.agentMode.skills.builtinPreferences).toBe(preferences);
        expect(preferences).toEqual({ [first.name]: { disabledAgents: ["opencode"] } });
      } finally {
        catalog.pop();
        (BUILTIN_SKILLS as (typeof added)[]).pop();
      }
    });
    it(`deletes disabled managed copies but preserves user-owned name collisions ${ISSUE}`, async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture();
      f.options.availableAgents = ["claude"];
      await reconcileBuiltinSkills(f.options);
      f.options.settings.agentMode.skills.builtinPreferences = { [skill.name]: { disabled: true } };
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path(skill.name))).toBe(false);
      f.files.set(f.path(skill.name), "user-owned content");
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path(skill.name))).toBe("user-owned content");
    });
    it.each(["disabled", "retired"])(
      `reports interrupted %s removal after the ownership marker is lost ${ISSUE}`,
      async (kind) => {
        const skill =
          kind === "retired"
            ? { ...BUILTIN_SKILLS[0], name: RETIRED_BUILTIN_SKILLS[0].name }
            : BUILTIN_SKILLS[0];
        const f = fixture({ [skill.name]: { disabled: true } });
        f.files.set(f.path(skill.name), skill.skillMd);
        const supportPath = `${folder}/${skill.name}/remaining.sh`;
        f.files.set(supportPath, "remaining support file");
        f.options.fs.removeDir = async () => {
          f.files.delete(f.path(skill.name));
          throw new Error("recursive removal interrupted");
        };

        await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow(`Could not remove ${kind}`);
        expect(f.files.get(supportPath)).toBe("remaining support file");
        expect(f.options.settings.agentMode.skills.builtinPreferences?.[skill.name].disabled).toBe(
          true
        );
      }
    );

    it(`surfaces disabled-file cleanup failures while retaining the opt-out ${ISSUE}`, async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture({ [skill.name]: { disabled: true } });
      f.files.set(f.path(skill.name), skill.skillMd);
      f.options.fs.removeDir = async () => {
        throw new Error("permission denied");
      };
      await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow("Could not remove disabled");
      expect(f.options.settings.agentMode.skills.builtinPreferences?.[skill.name].disabled).toBe(
        true
      );
    });
  });
});
