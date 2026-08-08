import { logWarn } from "@/logger";
import { discoverManagedSkills, type SkillsFsAdapter } from "./discoverManagedSkills";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const mockedLogWarn = logWarn as jest.MockedFunction<typeof logWarn>;

/**
 * Build a minimal in-memory FS adapter where the only paths that exist are
 * those given in `files` (keys are full vault-relative paths). Folder
 * structure is inferred from the parent directories of each file.
 */
function makeAdapter(files: Record<string, string>): SkillsFsAdapter {
  const fileSet = new Map(Object.entries(files));
  const folders = new Set<string>();
  for (const fullPath of fileSet.keys()) {
    const parts = fullPath.split("/");
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }

  return {
    async exists(rel) {
      return fileSet.has(rel) || folders.has(rel);
    },
    async list(rel) {
      const prefix = rel.endsWith("/") ? rel : `${rel}/`;
      const filesOut: string[] = [];
      const foldersOut: string[] = [];
      for (const p of fileSet.keys()) {
        if (!p.startsWith(prefix)) continue;
        const remainder = p.slice(prefix.length);
        if (remainder.includes("/")) {
          foldersOut.push(`${rel}/${remainder.split("/")[0]}`);
        } else {
          filesOut.push(p);
        }
      }
      for (const f of folders) {
        if (!f.startsWith(prefix)) continue;
        const remainder = f.slice(prefix.length);
        if (!remainder.includes("/")) {
          foldersOut.push(f);
        }
      }
      return {
        files: [...new Set(filesOut)],
        folders: [...new Set(foldersOut)],
      };
    },
    async read(rel) {
      const content = fileSet.get(rel);
      if (content === undefined) {
        throw new Error(`ENOENT: ${rel}`);
      }
      return content;
    },
  };
}

const SKILLS_ROOT = "copilot/skills";

const validSkillMd = (overrides: Record<string, string> = {}) => {
  const fm = {
    name: "review-prose",
    description: "Critique writing for clarity, voice, and rhythm.",
    ...overrides,
  };
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${yaml}\n---\nbody`;
};

describe("discoverManagedSkills", () => {
  beforeEach(() => {
    mockedLogWarn.mockClear();
  });

  it("returns an empty array when the skills folder does not exist", async () => {
    const adapter = makeAdapter({});
    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: null,
      adapter,
    });
    expect(skills).toEqual([]);
    expect(mockedLogWarn).not.toHaveBeenCalled();
  });

  it("returns a single Skill for one valid SKILL.md", async () => {
    const adapter = makeAdapter({
      [`${SKILLS_ROOT}/review-prose/SKILL.md`]: validSkillMd({ name: "review-prose" }),
    });
    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: null,
      adapter,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("review-prose");
    expect(skills[0].description).toBe("Critique writing for clarity, voice, and rhythm.");
    expect(skills[0].enabledAgents).toEqual([]);
    expect(skills[0].body).toBe("body");
  });

  it("skips a SKILL.md with invalid frontmatter and emits one logWarn", async () => {
    // Uppercase name fails the spec regex.
    const adapter = makeAdapter({
      [`${SKILLS_ROOT}/Bad/SKILL.md`]: validSkillMd({ name: "Bad" }),
    });
    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: null,
      adapter,
    });
    expect(skills).toEqual([]);
    expect(mockedLogWarn).toHaveBeenCalledTimes(1);
    expect(mockedLogWarn.mock.calls[0][0]).toMatch(/Skipping .*Bad\/SKILL\.md/);
  });

  it("returns only the valid skills when invalid SKILL.md files are mixed in", async () => {
    const adapter = makeAdapter({
      [`${SKILLS_ROOT}/alpha/SKILL.md`]: validSkillMd({ name: "alpha" }),
      [`${SKILLS_ROOT}/beta/SKILL.md`]: validSkillMd({ name: "beta" }),
      [`${SKILLS_ROOT}/gamma/SKILL.md`]: validSkillMd({ name: "gamma" }),
      [`${SKILLS_ROOT}/Bad1/SKILL.md`]: validSkillMd({ name: "Bad1" }),
      // Wrong parent-dir match: file claims name "wrong" but folder is "x-y".
      [`${SKILLS_ROOT}/x-y/SKILL.md`]: validSkillMd({ name: "wrong" }),
    });
    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: null,
      adapter,
    });
    expect(skills.map((s) => s.name).sort()).toEqual(["alpha", "beta", "gamma"]);
    expect(mockedLogWarn).toHaveBeenCalledTimes(2);
  });

  it("keeps sorted output order when reads resolve out of order", async () => {
    const adapter = makeAdapter({
      [`${SKILLS_ROOT}/alpha/SKILL.md`]: validSkillMd({ name: "alpha" }),
      [`${SKILLS_ROOT}/beta/SKILL.md`]: validSkillMd({ name: "beta" }),
      [`${SKILLS_ROOT}/gamma/SKILL.md`]: validSkillMd({ name: "gamma" }),
    });
    const read = adapter.read.bind(adapter);
    adapter.read = jest.fn(async (rel) => {
      if (rel.includes("alpha")) {
        await new Promise((resolve) => window.setTimeout(resolve, 5));
      }
      return read(rel);
    });

    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: null,
      adapter,
    });

    expect(skills.map((s) => s.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("parses metadata.copilot-enabled-agents into BackendId[]", async () => {
    const content = [
      "---",
      "name: multi",
      "description: A skill",
      "metadata:",
      '  copilot-enabled-agents: "claude,opencode"',
      "---",
      "body",
    ].join("\n");
    const adapter = makeAdapter({
      [`${SKILLS_ROOT}/multi/SKILL.md`]: content,
    });
    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: null,
      adapter,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0].enabledAgents).toEqual(["claude", "opencode"]);
  });

  it("populates absolute paths from skillsFolderAbsPath when provided", async () => {
    const adapter = makeAdapter({
      [`${SKILLS_ROOT}/foo/SKILL.md`]: validSkillMd({ name: "foo" }),
    });
    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: "/abs/vault/copilot/skills",
      adapter,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0].dirPath).toBe("/abs/vault/copilot/skills/foo");
    expect(skills[0].filePath).toBe("/abs/vault/copilot/skills/foo/SKILL.md");
  });

  it("ignores subdirectories without a SKILL.md", async () => {
    const adapter = makeAdapter({
      [`${SKILLS_ROOT}/has-skill/SKILL.md`]: validSkillMd({ name: "has-skill" }),
      [`${SKILLS_ROOT}/no-skill/README.md`]: "not a skill",
    });
    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: null,
      adapter,
    });
    expect(skills.map((s) => s.name)).toEqual(["has-skill"]);
    expect(mockedLogWarn).not.toHaveBeenCalled();
  });

  it("preserves unknown metadata keys on parsed skills", async () => {
    const content = [
      "---",
      "name: foo",
      "description: A skill",
      "metadata:",
      "  author: alice",
      '  copilot-enabled-agents: "claude"',
      "---",
      "body",
    ].join("\n");
    const adapter = makeAdapter({
      [`${SKILLS_ROOT}/foo/SKILL.md`]: content,
    });
    const skills = await discoverManagedSkills({
      skillsFolderRelPath: SKILLS_ROOT,
      skillsFolderAbsPath: null,
      adapter,
    });
    // Round-trip preservation is exercised in skillFormat.test.ts; here we
    // just verify that an extra metadata key doesn't break discovery.
    expect(skills).toHaveLength(1);
    expect(skills[0].enabledAgents).toEqual(["claude"]);
  });
});
