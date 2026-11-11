import { logWarn } from "@/logger";
import {
  collectReadOnlySkillRoots,
  discoverReadOnlySkills,
  type AgentSkillFolders,
  type ReadOnlyDiscoveryFs,
} from "./discoverReadOnlySkills";
import type { ReadOnlySkillRoot } from "./types";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

interface FakeTree {
  dirs?: string[];
  files?: Record<string, string>;
  links?: Record<string, string>;
  failures?: Record<string, string>;
}

function fsError(code: string): Error {
  return Object.assign(new Error(`${code}: operation failed`), { code });
}

function fakeFs(tree: FakeTree): ReadOnlyDiscoveryFs {
  const dirs = new Set(tree.dirs ?? []);
  const files = tree.files ?? {};
  const links = tree.links ?? {};
  const resolve = (p: string): string => {
    for (const [link, target] of Object.entries(links)) {
      if (p === link || p.startsWith(`${link}/`)) return resolve(target + p.slice(link.length));
    }
    return p;
  };
  const children = (dir: string): string[] =>
    [...dirs, ...Object.keys(files), ...Object.keys(links)]
      .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"))
      .map((p) => p.slice(dir.length + 1));
  return {
    async list(p) {
      const failure = tree.failures?.[p];
      if (failure) throw fsError(failure);
      const real = resolve(p);
      if (!dirs.has(real)) throw fsError("ENOENT");
      return children(real);
    },
    isSymlink: async (p) => p in links,
    isDirectory: async (p) => dirs.has(resolve(p)),
    async realpath(p) {
      const real = resolve(p);
      if (!dirs.has(real) && !(real in files)) throw fsError("ENOENT");
      return real;
    },
    async readFile(p) {
      const content = files[resolve(p)];
      if (content === undefined) throw fsError("ENOENT");
      return content;
    },
  };
}

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\nDo ${name}.`;
}

const CLAUDE_HOME: ReadOnlySkillRoot = {
  dirPath: "/home/me/.claude/skills",
  agents: ["claude", "opencode"],
  scope: "computer",
};

const AGENTS_HOME: ReadOnlySkillRoot = {
  dirPath: "/home/me/.agents/skills",
  agents: ["codex", "opencode"],
  scope: "computer",
};

const VAULT_CLAUDE: ReadOnlySkillRoot = {
  dirPath: "/vault/.claude/skills",
  agents: ["claude", "opencode"],
  scope: "vault",
};

function agent(overrides: Partial<AgentSkillFolders> & { id: string }): AgentSkillFolders {
  return {
    skillsProjectDir: `.${overrides.id}/skills`,
    crossDiscoveredAgents: [],
    userSkillsDirs: [],
    ...overrides,
  };
}

describe("discoverReadOnlySkills", () => {
  beforeEach(() => jest.mocked(logWarn).mockClear());

  describe("collectReadOnlySkillRoots()", () => {
    it("lists each agent's folders on this computer once, with every agent that loads that folder", () => {
      const roots = collectReadOnlySkillRoots(
        [
          agent({ id: "claude", userSkillsDirs: ["/home/me/.claude/skills"] }),
          agent({
            id: "opencode",
            userSkillsDirs: ["/home/me/.config/opencode/skills", "/home/me/.claude/skills"],
          }),
        ],
        null
      );
      expect(roots).toEqual([
        { dirPath: "/home/me/.claude/skills", agents: ["claude", "opencode"], scope: "computer" },
        { dirPath: "/home/me/.config/opencode/skills", agents: ["opencode"], scope: "computer" },
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 adds each agent's vault folder, read by that agent and every agent that also scans it", () => {
      const roots = collectReadOnlySkillRoots(
        [
          agent({ id: "claude", skillsProjectDir: ".claude/skills" }),
          agent({ id: "codex", skillsProjectDir: ".agents/skills" }),
          agent({
            id: "opencode",
            skillsProjectDir: ".opencode/skills",
            crossDiscoveredAgents: ["claude", "codex"],
          }),
        ],
        "/vault"
      );
      expect(roots).toEqual([
        { dirPath: "/vault/.claude/skills", agents: ["claude", "opencode"], scope: "vault" },
        { dirPath: "/vault/.agents/skills", agents: ["codex", "opencode"], scope: "vault" },
        { dirPath: "/vault/.opencode/skills", agents: ["opencode"], scope: "vault" },
      ]);
    });

    it("treats Windows and forward-slash spellings of one folder as the same folder", () => {
      const roots = collectReadOnlySkillRoots(
        [
          agent({ id: "claude", userSkillsDirs: ["C:\\Users\\me\\.claude\\skills"] }),
          agent({ id: "opencode", userSkillsDirs: ["C:/Users/me/.claude/skills/"] }),
        ],
        null
      );
      expect(roots).toEqual([
        {
          dirPath: "C:/Users/me/.claude/skills",
          agents: ["claude", "opencode"],
          scope: "computer",
        },
      ]);
    });
  });

  describe("discoverReadOnlySkills()", () => {
    it("lists every skill folder and linked skill in a folder on this computer, sorted by name", async () => {
      const fs = fakeFs({
        dirs: ["/home/me/.claude/skills", "/home/me/.claude/skills/write", "/elsewhere/review"],
        files: {
          "/home/me/.claude/skills/write/SKILL.md": skillMd("write", "Write a note"),
          "/elsewhere/review/SKILL.md": skillMd("review", "Review a diff"),
        },
        links: { "/home/me/.claude/skills/review": "/elsewhere/review" },
      });
      const skills = await discoverReadOnlySkills({ roots: [CLAUDE_HOME], excludedDirs: [], fs });
      expect(skills).toEqual([
        {
          name: "review",
          description: "Review a diff",
          body: "Do review.",
          userInvocable: undefined,
          filePath: "/elsewhere/review/SKILL.md",
          dirPath: "/elsewhere/review",
          folders: ["/home/me/.claude/skills"],
          agents: ["claude", "opencode"],
          scope: "computer",
        },
        expect.objectContaining({ name: "write", dirPath: "/home/me/.claude/skills/write" }),
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 lists only linked skills in a vault agent folder, leaving real folders to Your skills", async () => {
      const fs = fakeFs({
        dirs: ["/vault/.claude/skills", "/vault/.claude/skills/local", "/vault/Skills/linked"],
        files: {
          "/vault/.claude/skills/local/SKILL.md": skillMd("local", "Lives here"),
          "/vault/Skills/linked/SKILL.md": skillMd("linked", "Lives elsewhere"),
        },
        links: { "/vault/.claude/skills/linked": "/vault/Skills/linked" },
      });
      const skills = await discoverReadOnlySkills({ roots: [VAULT_CLAUDE], excludedDirs: [], fs });
      expect(skills.map((s) => [s.name, s.scope, s.dirPath])).toEqual([
        ["linked", "vault", "/vault/Skills/linked"],
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 skips links into Copilot's own skills folder, which Your skills already lists", async () => {
      const fs = fakeFs({
        dirs: ["/vault/.claude/skills", "/vault/copilot/skills/shared"],
        files: { "/vault/copilot/skills/shared/SKILL.md": skillMd("shared", "Managed") },
        links: { "/vault/.claude/skills/shared": "/vault/copilot/skills/shared" },
      });
      const skills = await discoverReadOnlySkills({
        roots: [VAULT_CLAUDE],
        excludedDirs: ["/vault/copilot/skills"],
        fs,
      });
      expect(skills).toEqual([]);
    });

    it("merges one skill reached from several folders into a single entry used by all their agents", async () => {
      const fs = fakeFs({
        dirs: [
          "/home/me/.claude/skills",
          "/home/me/.agents/skills",
          "/home/me/.agents/skills/plan",
        ],
        files: { "/home/me/.agents/skills/plan/SKILL.md": skillMd("plan", "Plan work") },
        links: { "/home/me/.claude/skills/plan": "/home/me/.agents/skills/plan" },
      });
      const skills = await discoverReadOnlySkills({
        roots: [CLAUDE_HOME, AGENTS_HOME],
        excludedDirs: [],
        fs,
      });
      expect(skills).toHaveLength(1);
      expect(skills[0]).toMatchObject({
        name: "plan",
        folders: ["/home/me/.claude/skills", "/home/me/.agents/skills"],
        agents: ["claude", "opencode", "codex"],
      });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 lists skills Copilot's own format would reject, named after their folder when the file has no name", async () => {
      const fs = fakeFs({
        dirs: ["/home/me/.claude/skills", "/home/me/.claude/skills/My Notes"],
        files: { "/home/me/.claude/skills/My Notes/SKILL.md": "Summarize my notes." },
      });
      const skills = await discoverReadOnlySkills({ roots: [CLAUDE_HOME], excludedDirs: [], fs });
      expect(skills.map((s) => [s.name, s.description, s.body])).toEqual([
        ["My Notes", "", "Summarize my notes."],
      ]);
    });

    it("skips hidden entries, files, folders without SKILL.md, and broken links", async () => {
      const fs = fakeFs({
        dirs: [
          "/home/me/.claude/skills",
          "/home/me/.claude/skills/.system",
          "/home/me/.claude/skills/empty",
        ],
        files: {
          "/home/me/.claude/skills/.system/SKILL.md": skillMd("system", "Bundled"),
          "/home/me/.claude/skills/README.md": "notes",
        },
        links: { "/home/me/.claude/skills/gone": "/nowhere/gone" },
      });
      const skills = await discoverReadOnlySkills({ roots: [CLAUDE_HOME], excludedDirs: [], fs });
      expect(skills).toEqual([]);
      expect(logWarn).not.toHaveBeenCalled();
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3659 leaves a folder it cannot read empty and logs a warning, while still listing other folders", async () => {
      const fs = fakeFs({
        dirs: [
          "/home/me/.claude/skills",
          "/home/me/.agents/skills",
          "/home/me/.agents/skills/plan",
        ],
        files: { "/home/me/.agents/skills/plan/SKILL.md": skillMd("plan", "Plan work") },
        failures: { "/home/me/.claude/skills": "EPERM" },
      });
      const skills = await discoverReadOnlySkills({
        roots: [CLAUDE_HOME, AGENTS_HOME],
        excludedDirs: [],
        fs,
      });
      expect(skills.map((s) => s.name)).toEqual(["plan"]);
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining("Could not list /home/me/.claude/skills")
      );
    });

    it("returns nothing without a warning when an agent's folder does not exist", async () => {
      const skills = await discoverReadOnlySkills({
        roots: [CLAUDE_HOME],
        excludedDirs: [],
        fs: fakeFs({}),
      });
      expect(skills).toEqual([]);
      expect(logWarn).not.toHaveBeenCalled();
    });
  });
});
