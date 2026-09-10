import {
  inspectBuiltinSkill,
  removeSeededBuiltin,
  seedBuiltinSkills,
  type BuiltinSeedFs,
} from "./seedBuiltinSkills";
import type { BuiltinSkill } from "@/builtinSkills/builtinSkills";

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn() }));

/** In-memory FS over vault-relative POSIX paths. */
function memFs(initialFiles: Record<string, string> = {}): BuiltinSeedFs & {
  files: Map<string, string>;
  dirs: Set<string>;
} {
  const files = new Map(Object.entries(initialFiles));
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    exists: async (p) => files.has(p) || dirs.has(p),
    read: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    write: async (p, c) => {
      files.set(p, c);
    },
    mkdir: async (p) => {
      dirs.add(p);
    },
    removeEmptyDir: async (p) => {
      if (![...files.keys(), ...dirs].some((child) => child.startsWith(`${p}/`))) dirs.delete(p);
    },
    removeFile: async (p) => {
      if (dirs.has(p)) throw new Error(`EISDIR ${p}`);
      files.delete(p);
    },
  };
}

function skill(version: number): BuiltinSkill {
  return {
    name: "copilot-web-search",
    version,
    enabledAgents: ["claude", "codex", "opencode"],
    skillMd: `---\nname: copilot-web-search\ndescription: d\nmetadata:\n  copilot-enabled-agents: claude, codex, opencode\n  copilot-builtin-version: "${version}"\n---\nbody v${version}`,
    files: [{ path: "web-search.sh", content: `// script v${version}` }],
  };
}

function managedSymposiumSkillMd(): string {
  return skill(8).skillMd.replaceAll("copilot-web-search", "symposium-publish");
}

function openArtifactsSkill(): BuiltinSkill {
  const base = skill(1);
  return {
    ...base,
    name: "openartifacts-publish",
    retiredFiles: ["symposium-publish.sh"],
    skillMd: base.skillMd.replaceAll("copilot-web-search", "openartifacts-publish"),
    files: [{ path: "openartifacts-publish.sh", content: "// script v1" }],
  };
}

const FOLDER = "copilot/skills";
const MD = "copilot/skills/copilot-web-search/SKILL.md";
const SCRIPT = "copilot/skills/copilot-web-search/web-search.sh";
const LEGACY_RENAMED_MD = "copilot/skills/symposium-publish/SKILL.md";
const RENAMED_MD = "copilot/skills/openartifacts-publish/SKILL.md";
const RENAMED_SCRIPT = "copilot/skills/openartifacts-publish/openartifacts-publish.sh";

describe("seedBuiltinSkills", () => {
  describe("seedBuiltinSkills()", () => {
    it("writes SKILL.md and scripts when the skill is missing", async () => {
      const fs = memFs();
      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(1)],
      });

      expect(seeded).toEqual(["copilot-web-search"]);
      expect(fs.files.get(MD)).toContain("body v1");
      expect(fs.files.get(SCRIPT)).toBe("// script v1");
      expect(fs.dirs.has("copilot/skills/copilot-web-search")).toBe(true);
    });

    it("is idempotent: skips a skill already present at the current version", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "// user-touched" });
      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(1)],
      });

      expect(seeded).toEqual([]);
      // Untouched — the script the user may have inspected stays as-is.
      expect(fs.files.get(SCRIPT)).toBe("// user-touched");
    });

    it("re-seeds when the bundled version is newer", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "// script v1" });
      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(2)],
      });

      expect(seeded).toEqual(["copilot-web-search"]);
      expect(fs.files.get(MD)).toContain("body v2");
      expect(fs.files.get(SCRIPT)).toBe("// script v2");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 removes retired support files while preserving user files and enabled agents", async () => {
      const v1: BuiltinSkill = {
        ...skill(1),
        files: [...skill(1).files, { path: "obsolete-rules.md", content: "old guidance" }],
      };
      const fs = memFs();
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [v1] });
      const obsolete = "copilot/skills/copilot-web-search/obsolete-rules.md";
      expect(fs.files.has(obsolete)).toBe(true);
      const custom = "copilot/skills/copilot-web-search/themes/custom.md";
      fs.files.set(custom, "user theme");
      fs.files.set(MD, fs.files.get(MD)!.replace("claude, codex, opencode", "codex"));

      await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [{ ...skill(2), retiredFiles: ["obsolete-rules.md", "already-removed.md"] }],
      });
      expect(fs.files.has(obsolete)).toBe(false);
      expect(fs.files.get(custom)).toBe("user theme");
      expect(fs.files.get(SCRIPT)).toBe("// script v2");
      expect(fs.files.get(MD)).toContain('copilot-builtin-version: "2"');
      expect(fs.files.get(MD)).toContain("copilot-enabled-agents: codex");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 preserves the old skill and user directory when a retired path is a directory", async () => {
      const fs = memFs();
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] });
      const retiredPath = "copilot/skills/copilot-web-search/retired.md";
      fs.dirs.add(retiredPath);
      fs.files.set(`${retiredPath}/user.md`, "user reference");

      const result = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [{ ...skill(2), retiredFiles: ["retired.md"] }],
      });

      expect(result.seeded).toEqual([]);
      expect(fs.files.get(`${retiredPath}/user.md`)).toBe("user reference");
      expect(fs.files.get(MD)).toContain('copilot-builtin-version: "1"');
    });

    it("re-seeds when the SKILL.md was deleted", async () => {
      // Script lingered but SKILL.md is gone — treat as missing and re-seed.
      const fs = memFs({ [SCRIPT]: "// stale" });
      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(1)],
      });

      expect(seeded).toEqual(["copilot-web-search"]);
      expect(fs.files.get(MD)).toContain("body v1");
    });

    it("never touches unrelated user skills in the same folder", async () => {
      const userMd = "copilot/skills/my-skill/SKILL.md";
      const fs = memFs({ [userMd]: "user content" });
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] });

      expect(fs.files.get(userMd)).toBe("user content");
    });

    it("does not overwrite a user-authored skill whose name collides with a builtin", async () => {
      // A user created copilot-web-search before it became a builtin — no version marker.
      const userContent =
        "---\nname: copilot-web-search\ndescription: my custom search\n---\ncustom body";
      const fs = memFs({ [MD]: userContent });
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] });

      expect(fs.files.get(MD)).toBe(userContent);
    });

    it("re-seeds when SKILL.md is current but a support file is missing (partial write recovery)", async () => {
      // Simulate a crash after SKILL.md was written but before the script.
      const fs = memFs({ [MD]: skill(1).skillMd }); // no SCRIPT
      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(1)],
      });

      expect(seeded).toEqual(["copilot-web-search"]);
      expect(fs.files.get(SCRIPT)).toBe("// script v1");
    });

    it("preserves user-modified copilot-enabled-agents when upgrading a builtin", async () => {
      // User disabled codex and opencode via the toggle UI — SKILL.md was rewritten
      // on disk to list only 'claude'. On the next version bump the seeder must not
      // silently restore the full bundled agent list.
      const disabledMd = skill(1).skillMd.replace(
        "copilot-enabled-agents: claude, codex, opencode",
        "copilot-enabled-agents: claude"
      );
      const fs = memFs({ [MD]: disabledMd, [SCRIPT]: "// script v1" });
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(2)] });

      const written = fs.files.get(MD) ?? "";
      expect(written).toContain("copilot-enabled-agents: claude\n");
      expect(written).not.toContain("copilot-enabled-agents: claude, codex, opencode");
      expect(written).toContain("body v2"); // bundled body was updated
    });

    it("creates parent directories for nested support files", async () => {
      const nestedSkill: BuiltinSkill = {
        ...skill(1),
        files: [{ path: "references/EXAMPLES.md", content: "# Examples" }],
      };
      const fs = memFs();

      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [nestedSkill] });

      expect(fs.dirs.has("copilot/skills/copilot-web-search/references")).toBe(true);
      expect(fs.files.get("copilot/skills/copilot-web-search/references/EXAMPLES.md")).toBe(
        "# Examples"
      );
    });

    it("uses fresh defaults for a new name without reading or modifying its predecessor https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const oldMd = managedSymposiumSkillMd().replace("claude, codex, opencode", "codex");
      const fs = memFs({ [LEGACY_RENAMED_MD]: oldMd });
      fs.read = jest.fn(async () => {
        throw new Error("unreadable predecessor");
      });
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [openArtifactsSkill()] });
      expect(fs.files.get(RENAMED_MD)).toContain("copilot-enabled-agents: claude, codex, opencode");
      expect(fs.files.get(RENAMED_SCRIPT)).toBe("// script v1");
      expect(fs.files.get(LEGACY_RENAMED_MD)).toBe(oldMd);
      expect(fs.read).not.toHaveBeenCalled();
    });

    it("leaves unreadable targets untouched because ownership cannot be verified https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const content = "user-authored content";
      const fs = memFs({ [MD]: content });
      fs.read = async () => {
        throw new Error("temporarily unreadable");
      };
      fs.write = jest.fn(fs.write);
      await expect(
        seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] })
      ).resolves.toEqual({ seeded: [] });
      expect(fs.files.get(MD)).toBe(content);
      expect(fs.write).not.toHaveBeenCalled();
    });
  });

  describe("removeSeededBuiltin()", () => {
    it("retires all previously shipped support files while retaining user additions https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const root = `${FOLDER}/symposium-publish`;
      const userFile = `${root}/references/custom.md`;
      const fs = memFs({
        [LEGACY_RENAMED_MD]: managedSymposiumSkillMd(),
        [`${root}/shared-publishing-rules.md`]: "rules",
        [`${root}/symposium-publish.sh`]: "shell",
        [`${root}/symposium-publish.cmd`]: "cmd",
        [`${root}/symposium-publish.ps1`]: "powershell",
        [userFile]: "my reference",
      });
      expect(await removeSeededBuiltin(FOLDER, "symposium-publish", fs)).toBe(true);
      expect([...fs.files.entries()]).toEqual([[userFile, "my reference"]]);
    });

    it("retains the ownership marker after partial retirement and retries remaining files https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const root = `${FOLDER}/symposium-publish`;
      const script = `${root}/symposium-publish.sh`;
      const fs = memFs({ [LEGACY_RENAMED_MD]: managedSymposiumSkillMd(), [script]: "shell" });
      const remove = fs.removeFile;
      fs.removeFile = jest
        .fn()
        .mockRejectedValueOnce(new Error("locked"))
        .mockImplementation(remove);
      expect(await removeSeededBuiltin(FOLDER, "symposium-publish", fs)).toBe(false);
      expect(fs.files.has(LEGACY_RENAMED_MD)).toBe(true);
      expect(await removeSeededBuiltin(FOLDER, "symposium-publish", fs)).toBe(true);
      expect(fs.files.size).toBe(0);
    });

    it("preserves marked skills outside the active and retired catalogs https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const path = `${FOLDER}/unknown/SKILL.md`;
      const fs = memFs({ [path]: skill(1).skillMd });
      expect(await removeSeededBuiltin(FOLDER, "unknown", fs)).toBe(false);
      expect(fs.files.has(path)).toBe(true);
    });

    it("removes empty generated support directories and the skill root https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const definition = {
        ...skill(1),
        files: [{ path: "references/owned.md", content: "owned" }],
      };
      const fs = memFs();
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [definition] });
      const root = `${FOLDER}/${definition.name}`;
      expect(fs.dirs.has(`${root}/references`)).toBe(true);
      expect(await removeSeededBuiltin(FOLDER, definition.name, fs, definition)).toBe(true);
      expect(fs.dirs.has(`${root}/references`)).toBe(false);
      expect(fs.dirs.has(root)).toBe(false);
      expect(fs.dirs.has(FOLDER)).toBe(true);
    });
    it("removes only catalog paths and retains user references and themes https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const root = `${FOLDER}/copilot-web-search`;
      const userReference = `${root}/references/my-notes.md`;
      const userTheme = `${root}/themes/custom.css`;
      const retired = `${root}/retired.sh`;
      const fs = memFs({
        [MD]: skill(1).skillMd,
        [SCRIPT]: "owned",
        [retired]: "retired",
        [userReference]: "my notes",
        [userTheme]: "my theme",
      });
      expect(
        await removeSeededBuiltin(FOLDER, "copilot-web-search", fs, {
          ...skill(1),
          retiredFiles: ["retired.sh"],
        })
      ).toBe(true);
      expect([...fs.files.keys()].sort()).toEqual([userReference, userTheme].sort());
    });
    it("removes a seeded builtin definition and supporting files", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "// script v1" });
      const removed = await removeSeededBuiltin(FOLDER, "copilot-web-search", fs, skill(1));

      expect(removed).toBe(true);
      expect(fs.files.has(MD)).toBe(false);
      expect(fs.files.has(SCRIPT)).toBe(false);
    });

    it("is a no-op when the skill folder is absent", async () => {
      const fs = memFs();
      expect(await removeSeededBuiltin(FOLDER, "copilot-web-search", fs, skill(1))).toBe(false);
    });

    it("refuses to remove a user-authored skill that lacks the builtin version marker", async () => {
      const userContent =
        "---\nname: copilot-web-search\ndescription: my custom search\n---\ncustom body";
      const fs = memFs({ [MD]: userContent });
      const removed = await removeSeededBuiltin(FOLDER, "copilot-web-search", fs, skill(1));

      expect(removed).toBe(false);
      expect(fs.files.get(MD)).toBe(userContent);
    });
  });

  describe("inspectBuiltinSkill()", () => {
    it("reports 'absent' when no SKILL.md exists", async () => {
      const fs = memFs();
      expect(await inspectBuiltinSkill(FOLDER, "copilot-web-search", fs)).toBe("absent");
    });

    it("reports 'seeded' when the builtin version marker is present", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd });
      expect(await inspectBuiltinSkill(FOLDER, "copilot-web-search", fs)).toBe("seeded");
    });

    it("reports 'collision' for a same-named folder without the marker", async () => {
      const fs = memFs({
        [MD]: "---\nname: copilot-web-search\ndescription: mine\n---\ncustom body",
      });
      expect(await inspectBuiltinSkill(FOLDER, "copilot-web-search", fs)).toBe("collision");
    });

    it("reports 'failed' when the SKILL.md can't be read", async () => {
      const fs = memFs();
      // Path claims to exist but read throws — a torn/permission-denied file.
      fs.exists = async () => true;
      fs.read = async () => {
        throw new Error("EACCES");
      };
      expect(await inspectBuiltinSkill(FOLDER, "copilot-web-search", fs)).toBe("failed");
    });

    it("reports 'stale' when the on-disk marker is older than the expected version", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd });
      expect(await inspectBuiltinSkill(FOLDER, "copilot-web-search", fs, 2)).toBe("stale");
    });

    it("reports 'seeded' when the on-disk marker meets or exceeds the expected version", async () => {
      const fs = memFs({ [MD]: skill(2).skillMd });
      expect(await inspectBuiltinSkill(FOLDER, "copilot-web-search", fs, 2)).toBe("seeded");
      // A newer on-disk copy (e.g. a future plugin wrote it) is still ours.
      const fsNewer = memFs({ [MD]: skill(3).skillMd });
      expect(await inspectBuiltinSkill(FOLDER, "copilot-web-search", fsNewer, 2)).toBe("seeded");
    });
  });
});
