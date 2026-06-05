import { removeSeededBuiltin, seedBuiltinSkills, type BuiltinSeedFs } from "./seedBuiltinSkills";
import type { BuiltinSkill } from "./builtinSkills";

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
    rmRecursive: async (p) => {
      dirs.delete(p);
      for (const key of [...files.keys()]) {
        if (key === p || key.startsWith(`${p}/`)) files.delete(key);
      }
      for (const key of [...dirs]) {
        if (key === p || key.startsWith(`${p}/`)) dirs.delete(key);
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

const FOLDER = "copilot/skills";
const MD = "copilot/skills/copilot-web-search/SKILL.md";
const SCRIPT = "copilot/skills/copilot-web-search/web-search.sh";

describe("seedBuiltinSkills", () => {
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
});

describe("removeSeededBuiltin", () => {
  it("removes a seeded builtin folder and its files", async () => {
    const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "// script v1" });
    const removed = await removeSeededBuiltin(FOLDER, "copilot-web-search", fs);

    expect(removed).toBe(true);
    expect(fs.files.has(MD)).toBe(false);
    expect(fs.files.has(SCRIPT)).toBe(false);
  });

  it("is a no-op when the skill folder is absent", async () => {
    const fs = memFs();
    expect(await removeSeededBuiltin(FOLDER, "copilot-web-search", fs)).toBe(false);
  });

  it("refuses to remove a user-authored skill that lacks the builtin version marker", async () => {
    const userContent =
      "---\nname: copilot-web-search\ndescription: my custom search\n---\ncustom body";
    const fs = memFs({ [MD]: userContent });
    const removed = await removeSeededBuiltin(FOLDER, "copilot-web-search", fs);

    expect(removed).toBe(false);
    expect(fs.files.get(MD)).toBe(userContent);
  });
});
