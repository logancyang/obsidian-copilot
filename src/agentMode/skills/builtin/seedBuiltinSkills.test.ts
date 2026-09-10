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
    removeDir: async (p) => {
      for (const file of files.keys()) {
        if (file.startsWith(`${p}/`)) files.delete(file);
      }
      for (const dir of dirs) {
        if (dir === p || dir.startsWith(`${p}/`)) dirs.delete(dir);
      }
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
    it.each(["web-search.sh", "SKILL.md"])(
      "retries an upgrade interrupted at %s without stamping success and removes user additions https://github.com/logancyang/obsidian-copilot/issues/3022",
      async (failedFile) => {
        const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "old script" });
        const personal = `${FOLDER}/copilot-web-search/references/personal.md`;
        fs.files.set(personal, "personal reference");
        const write = fs.write;
        fs.write = async (path, content) => {
          if (path === `${FOLDER}/copilot-web-search/${failedFile}`) throw new Error("disk full");
          await write(path, content);
        };
        expect(
          await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(2)] })
        ).toEqual({ seeded: [] });
        expect(await inspectBuiltinSkill(FOLDER, "copilot-web-search", fs, 2)).toBe("absent");
        expect(fs.files.has(personal)).toBe(false);
        fs.write = write;
        expect(
          await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(2)] })
        ).toEqual({ seeded: ["copilot-web-search"] });
        expect(fs.files.get(MD)).toBe(skill(2).skillMd);
        expect(fs.files.get(SCRIPT)).toBe("// script v2");
        expect(fs.files.has(personal)).toBe(false);
      }
    );

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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/394 replaces all managed folder contents while preserving enabled agents https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
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
        skills: [skill(2)],
      });
      expect(fs.files.has(obsolete)).toBe(false);
      expect(fs.files.has(custom)).toBe(false);
      expect(fs.files.get(SCRIPT)).toBe("// script v2");
      expect(fs.files.get(MD)).toContain('copilot-builtin-version: "2"');
      expect(fs.files.get(MD)).toContain("copilot-enabled-agents: codex");
    });

    it("retries an upgrade after folder cleanup fails without stamping success https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "old script" });
      const removeDir = fs.removeDir;
      fs.removeDir = async () => {
        throw new Error("EACCES");
      };
      expect(
        await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(2)] })
      ).toEqual({ seeded: [] });
      expect(fs.files.get(MD)).toBe(skill(1).skillMd);
      expect(fs.files.get(SCRIPT)).toBe("old script");
      fs.removeDir = removeDir;
      expect(
        await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(2)] })
      ).toEqual({ seeded: ["copilot-web-search"] });
      expect(fs.files.get(MD)).toBe(skill(2).skillMd);
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
    it.each([
      "---\nname: example\n---\nmetadata:\n  copilot-builtin-version: 1",
      "---\nmetadata:\n  copilot-builtin-version: -1\n---\nuser",
      "---\nmetadata:\n  copilot-builtin-version: [1]\n---\nuser",
      "---\nmetadata: [\n---\nuser",
    ])(
      "preserves every file when ownership metadata is invalid: %s https://github.com/logancyang/obsidian-copilot/issues/3022",
      async (content) => {
        const fs = memFs({ [MD]: content, [SCRIPT]: "personal script" });
        const before = [...fs.files];
        expect(await removeSeededBuiltin(FOLDER, "copilot-web-search", fs)).toBe("collision");
        expect([...fs.files]).toEqual(before);
      }
    );

    it("removes the whole managed directory including user additions and leaves sibling skills intact https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const definition = {
        ...skill(1),
        files: [{ path: "references/owned.md", content: "owned" }],
      };
      const fs = memFs();
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [definition] });
      const root = `${FOLDER}/${definition.name}`;
      fs.files.set(`${root}/references/my-notes.md`, "personal reference");
      fs.dirs.add(`${root}/themes`);
      fs.files.set(`${root}/themes/custom.css`, "personal theme");
      const sibling = `${root}-extra`;
      fs.dirs.add(sibling);
      fs.files.set(`${sibling}/SKILL.md`, "sibling skill");

      expect(await removeSeededBuiltin(FOLDER, definition.name, fs)).toBe("removed");
      expect([...fs.files.entries()]).toEqual([[`${sibling}/SKILL.md`, "sibling skill"]]);
      expect([...fs.dirs].filter((dir) => dir === root || dir.startsWith(`${root}/`))).toEqual([]);
      expect(fs.dirs.has(sibling)).toBe(true);
      expect(fs.dirs.has(FOLDER)).toBe(true);
    });

    it("removes a marked skill without requiring a catalog entry https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const path = `${FOLDER}/unknown/SKILL.md`;
      const fs = memFs({ [path]: skill(1).skillMd });
      expect(await removeSeededBuiltin(FOLDER, "unknown", fs)).toBe("removed");
      expect(fs.files.size).toBe(0);
    });

    it("is a no-op when SKILL.md is absent https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const fs = memFs({ [SCRIPT]: "unmarked support file" });
      fs.removeDir = jest.fn(fs.removeDir);
      expect(await removeSeededBuiltin(FOLDER, "copilot-web-search", fs)).toBe("absent");
      expect(fs.files.get(SCRIPT)).toBe("unmarked support file");
      expect(fs.removeDir).not.toHaveBeenCalled();
    });

    it("refuses to remove a user-authored skill that lacks the builtin version marker", async () => {
      const userContent =
        "---\nname: copilot-web-search\ndescription: my custom search\n---\ncustom body";
      const fs = memFs({ [MD]: userContent });
      const removed = await removeSeededBuiltin(FOLDER, "copilot-web-search", fs);

      expect(removed).toBe("collision");
      expect(fs.files.get(MD)).toBe(userContent);
    });

    it("leaves unreadable skills untouched because ownership cannot be verified https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd });
      fs.read = jest.fn().mockRejectedValue(new Error("EACCES"));
      fs.removeDir = jest.fn(fs.removeDir);
      expect(await removeSeededBuiltin(FOLDER, "copilot-web-search", fs)).toBe("failed");
      expect(fs.files.has(MD)).toBe(true);
      expect(fs.removeDir).not.toHaveBeenCalled();
    });

    it("reports failed directory removal https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "script" });
      fs.removeDir = jest.fn().mockRejectedValue(new Error("EPERM"));
      expect(await removeSeededBuiltin(FOLDER, "copilot-web-search", fs)).toBe("failed");
      expect(fs.files.has(MD)).toBe(true);
      expect(fs.files.has(SCRIPT)).toBe(true);
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
