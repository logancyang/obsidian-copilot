import { detectImportCandidates, type ImportDetectorFs } from "./importDetector";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

/**
 * Type tag for entries in the in-memory FS. Files carry size; directories
 * are containers; symlinks resolve to another absolute path.
 */
type Entry = { kind: "file"; size: number } | { kind: "dir" } | { kind: "symlink"; target: string };

/**
 * Build an `ImportDetectorFs` over a flat map of `{ absPath → entry }`.
 * Parent directories are inferred from each file/dir entry so tests only
 * have to declare leaves.
 */
function makeFs(entries: Record<string, Entry>): ImportDetectorFs {
  const map = new Map<string, Entry>(Object.entries(entries));
  // Synthesize directory entries for every ancestor of every path.
  for (const fullPath of Array.from(map.keys())) {
    const parts = fullPath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (ancestor.length === 0) continue;
      if (!map.has(ancestor)) {
        map.set(ancestor, { kind: "dir" });
      }
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
    async readlinkAbs(p) {
      const e = map.get(p);
      return e !== undefined && e.kind === "symlink" ? e.target : null;
    },
    async list(p) {
      const prefix = p.replace(/\/+$/, "") + "/";
      const out = new Set<string>();
      for (const k of map.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest.length === 0) continue;
        const first = rest.split("/")[0];
        out.add(first);
      }
      return Array.from(out);
    },
    async statSize(p) {
      const e = map.get(p);
      return e !== undefined && e.kind === "file" ? e.size : 0;
    },
  };
}

const VAULT = "/vault";
const CANONICAL = "/vault/copilot/skills";
const AGENT_DIRS = {
  claude: ".claude/skills",
  codex: ".agents/skills",
  opencode: ".opencode/skills",
} as const;

describe("detectImportCandidates", () => {
  it("returns empty buckets when no agent dirs exist", async () => {
    const fs = makeFs({});
    const result = await detectImportCandidates({
      vaultRootAbsPath: VAULT,
      canonicalAbsPath: CANONICAL,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(result.claude).toEqual([]);
    expect(result.codex).toEqual([]);
    expect(result.opencode).toEqual([]);
  });

  it("classifies real dirs with SKILL.md as candidates, grouped by agent", async () => {
    const fs = makeFs({
      "/vault/.claude/skills/foo/SKILL.md": { kind: "file", size: 100 },
      "/vault/.claude/skills/foo/extra.md": { kind: "file", size: 50 },
      "/vault/.agents/skills/bar/SKILL.md": { kind: "file", size: 200 },
      "/vault/.opencode/skills/baz/SKILL.md": { kind: "file", size: 300 },
    });

    const result = await detectImportCandidates({
      vaultRootAbsPath: VAULT,
      canonicalAbsPath: CANONICAL,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });

    expect(result.claude.map((c) => c.name)).toEqual(["foo"]);
    expect(result.claude[0].sourceAgent).toBe("claude");
    expect(result.claude[0].sourcePath).toBe("/vault/.claude/skills/foo");
    expect(result.claude[0].fileCount).toBe(2);
    expect(result.claude[0].totalBytes).toBe(150);

    expect(result.codex.map((c) => c.name)).toEqual(["bar"]);
    expect(result.codex[0].sourceAgent).toBe("codex");

    expect(result.opencode.map((c) => c.name)).toEqual(["baz"]);
    expect(result.opencode[0].sourceAgent).toBe("opencode");
  });

  it("creates buckets for dynamically registered backends", async () => {
    const fs = makeFs({
      "/vault/.custom/skills/alpha/SKILL.md": { kind: "file", size: 42 },
    });

    const result = await detectImportCandidates({
      vaultRootAbsPath: VAULT,
      canonicalAbsPath: CANONICAL,
      agentDirsProjectRel: { ...AGENT_DIRS, custom: ".custom/skills" },
      fs,
    });

    expect(result.custom.map((c) => c.name)).toEqual(["alpha"]);
    expect(result.custom[0].sourceAgent).toBe("custom");
  });

  it("skips dirs without a SKILL.md", async () => {
    const fs = makeFs({
      "/vault/.claude/skills/staging/notes.md": { kind: "file", size: 10 },
    });
    const result = await detectImportCandidates({
      vaultRootAbsPath: VAULT,
      canonicalAbsPath: CANONICAL,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(result.claude).toEqual([]);
  });

  it("skips symlinks pointing into the canonical folder", async () => {
    const fs = makeFs({
      "/vault/.claude/skills/managed": {
        kind: "symlink",
        target: "/vault/copilot/skills/managed",
      },
      "/vault/copilot/skills/managed/SKILL.md": { kind: "file", size: 10 },
    });
    const result = await detectImportCandidates({
      vaultRootAbsPath: VAULT,
      canonicalAbsPath: CANONICAL,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(result.claude).toEqual([]);
  });

  it("skips symlinks pointing somewhere unrelated", async () => {
    const fs = makeFs({
      "/vault/.claude/skills/external": {
        kind: "symlink",
        target: "/home/user/elsewhere/skill",
      },
    });
    const result = await detectImportCandidates({
      vaultRootAbsPath: VAULT,
      canonicalAbsPath: CANONICAL,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(result.claude).toEqual([]);
  });

  it("returns a sorted, well-formed candidate list across mixed inputs", async () => {
    const fs = makeFs({
      "/vault/.claude/skills/zeta/SKILL.md": { kind: "file", size: 5 },
      "/vault/.claude/skills/alpha/SKILL.md": { kind: "file", size: 7 },
      "/vault/.claude/skills/managed": {
        kind: "symlink",
        target: "/vault/copilot/skills/managed",
      },
      "/vault/.claude/skills/no-skill-md/something.txt": { kind: "file", size: 9 },
    });
    const result = await detectImportCandidates({
      vaultRootAbsPath: VAULT,
      canonicalAbsPath: CANONICAL,
      agentDirsProjectRel: AGENT_DIRS,
      fs,
    });
    expect(result.claude.map((c) => c.name)).toEqual(["alpha", "zeta"]);
  });
});
