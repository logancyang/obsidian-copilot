import { discoverProjectSkills, type ProjectDiscoveryFs } from "./discoverProjectSkills";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

type Node =
  | { kind: "file"; content: string }
  | { kind: "dir" }
  | { kind: "symlink"; target: string };

/**
 * Build a small in-memory FS shaped like {@link ProjectDiscoveryFs}.
 * Files are stored by absolute path; ancestor directories are synthesized
 * so `isDirectory` returns true for any intermediate path.
 */
function mkFs(initial: Record<string, Node> = {}): ProjectDiscoveryFs {
  const map = new Map<string, Node>(Object.entries(initial));
  for (const p of [...map.keys()]) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (ancestor.length === 0) continue;
      if (!map.has(ancestor)) map.set(ancestor, { kind: "dir" });
    }
  }
  return {
    async exists(p) {
      return map.has(p);
    },
    async isDirectory(p) {
      const e = map.get(p);
      return e !== undefined && e.kind === "dir";
    },
    async isSymlink(p) {
      const e = map.get(p);
      return e !== undefined && e.kind === "symlink";
    },
    async readFile(p) {
      const e = map.get(p);
      if (e === undefined || e.kind !== "file") {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      }
      return e.content;
    },
    async list(p) {
      const prefix = `${p}/`;
      const out = new Set<string>();
      for (const k of map.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest.length === 0) continue;
        out.add(rest.split("/")[0]);
      }
      return Array.from(out);
    },
  };
}

const skillMd = (name: string): string =>
  ["---", `name: ${name}`, `description: A ${name} skill.`, "---", "body"].join("\n");

describe("discoverProjectSkills", () => {
  const VAULT = "/vault";
  const AGENT_DIRS = {
    claude: ".claude/skills",
    codex: ".agents/skills",
    opencode: ".opencode/skills",
  } as const;

  it("returns an empty list when no agent dirs exist", async () => {
    const fs = mkFs({});
    const out = await discoverProjectSkills({
      vaultRootAbsPath: VAULT,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(out).toEqual([]);
  });

  it("returns an empty list when an agent dir exists but is empty", async () => {
    const fs = mkFs({ "/vault/.claude/skills": { kind: "dir" } });
    const out = await discoverProjectSkills({
      vaultRootAbsPath: VAULT,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(out).toEqual([]);
  });

  it("returns a single candidate when one valid skill lives under one agent dir", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/foo/SKILL.md": { kind: "file", content: skillMd("foo") },
    });
    const out = await discoverProjectSkills({
      vaultRootAbsPath: VAULT,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      agent: "claude",
      name: "foo",
      filePath: "/vault/.claude/skills/foo/SKILL.md",
      dirPath: "/vault/.claude/skills/foo",
    });
    expect(typeof out[0].contentHash).toBe("string");
    expect(out[0].contentHash.length).toBeGreaterThan(0);
  });

  it("skips a directory whose SKILL.md fails to parse", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/bad/SKILL.md": {
        kind: "file",
        content: "this is not valid frontmatter",
      },
      "/vault/.claude/skills/good/SKILL.md": {
        kind: "file",
        content: skillMd("good"),
      },
    });
    const out = await discoverProjectSkills({
      vaultRootAbsPath: VAULT,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(out.map((c) => c.name)).toEqual(["good"]);
  });

  it("skips a symlinked top-level entry (reconciliation handles those)", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/linked": {
        kind: "symlink",
        target: "/vault/copilot/skills/foo",
      },
      "/vault/.claude/skills/real/SKILL.md": {
        kind: "file",
        content: skillMd("real"),
      },
    });
    const out = await discoverProjectSkills({
      vaultRootAbsPath: VAULT,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(out.map((c) => c.name)).toEqual(["real"]);
  });

  it("returns one candidate per agent when the same skill lives in multiple dirs", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/foo/SKILL.md": { kind: "file", content: skillMd("foo") },
      "/vault/.agents/skills/foo/SKILL.md": { kind: "file", content: skillMd("foo") },
    });
    const out = await discoverProjectSkills({
      vaultRootAbsPath: VAULT,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(out.map((c) => c.agent).sort()).toEqual(["claude", "codex"]);
    // Same content → same hash; the merge layer collapses these into one row.
    expect(out[0].contentHash).toBe(out[1].contentHash);
  });

  it("skips a directory without a SKILL.md", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/staging/notes.md": { kind: "file", content: "scratch" },
    });
    const out = await discoverProjectSkills({
      vaultRootAbsPath: VAULT,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(out).toEqual([]);
  });
});
