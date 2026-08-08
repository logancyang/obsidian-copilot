import { reconcile, type ReconcileFs } from "./reconcile";
import type { Skill } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

/**
 * In-memory FS tailored to the reconcile pass. Stores three kinds of nodes:
 *
 * - `dir`  — real directory.
 * - `file` — regular file (only used as filler).
 * - `link` — symlink/junction with an absolute target.
 *
 * Provides the {@link ReconcileFs} surface plus debug accessors. Ancestor
 * directories are auto-synthesized on insert.
 */
type Node = { kind: "dir" } | { kind: "file" } | { kind: "link"; target: string };

interface TestFs extends ReconcileFs {
  __dump(): Record<string, Node>;
  __set(path: string, node: Node): void;
  __setSymlinkBlocked(blocked: boolean): void;
}

function mkFs(initial: Record<string, Node> = {}): TestFs {
  const map = new Map<string, Node>();
  let symlinkBlocked = false;

  const ensureAncestors = (p: string) => {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const a = parts.slice(0, i).join("/");
      if (a.length === 0) continue;
      if (!map.has(a)) map.set(a, { kind: "dir" });
    }
  };

  for (const [p, n] of Object.entries(initial)) {
    ensureAncestors(p);
    map.set(p, n);
  }

  const fs: TestFs = {
    async exists(p) {
      return map.has(p);
    },
    async isDirectory(p) {
      return map.get(p)?.kind === "dir";
    },
    async isSymlink(p) {
      return map.get(p)?.kind === "link";
    },
    async readlinkAbs(p) {
      const n = map.get(p);
      return n !== undefined && n.kind === "link" ? n.target : null;
    },
    async list(p) {
      const prefix = p.replace(/\/+$/, "") + "/";
      const out = new Set<string>();
      for (const k of map.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest.length === 0) continue;
        out.add(rest.split("/")[0]);
      }
      return Array.from(out);
    },
    async symlink(target, linkPath) {
      if (symlinkBlocked) {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }
      if (map.has(linkPath)) {
        throw Object.assign(new Error(`EEXIST: ${linkPath}`), { code: "EEXIST" });
      }
      ensureAncestors(linkPath);
      map.set(linkPath, { kind: "link", target });
    },
    async unlink(p) {
      const n = map.get(p);
      if (n === undefined) return;
      if (n.kind !== "link") return;
      map.delete(p);
    },
    async rmRecursive(p) {
      const prefix = p + "/";
      for (const k of Array.from(map.keys())) {
        if (k === p || k.startsWith(prefix)) map.delete(k);
      }
    },
    async readFile(p) {
      const n = map.get(p);
      if (n === undefined || n.kind !== "file") {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      }
      // Test fixtures store files as `{ kind: "file" }` markers without
      // content — return an empty string. None of the reconcile cases
      // need real file contents (it's symlink-only).
      return "";
    },
    async writeFile(p, _content) {
      ensureAncestors(p);
      map.set(p, { kind: "file" });
    },
    __dump() {
      return Object.fromEntries(map);
    },
    __set(p, n) {
      ensureAncestors(p);
      map.set(p, n);
    },
    __setSymlinkBlocked(blocked) {
      symlinkBlocked = blocked;
    },
  };
  return fs;
}

const VAULT = "/vault";
const CANONICAL = "/vault/copilot/skills";
const AGENT_DIRS_ABS = {
  claude: `${VAULT}/.claude/skills`,
  codex: `${VAULT}/.agents/skills`,
  opencode: `${VAULT}/.opencode/skills`,
} as const;

function mkSkill(name: string, enabledAgents: Skill["enabledAgents"] = []): Skill {
  return {
    name,
    description: "A short skill",
    filePath: `${CANONICAL}/${name}/SKILL.md`,
    dirPath: `${CANONICAL}/${name}`,
    body: "body",
    enabledAgents,
    location: { kind: "canonical" },
  };
}

describe("reconcile", () => {
  it("creates a missing symlink for an enabled agent", async () => {
    const fs = mkFs({
      [`${CANONICAL}/foo`]: { kind: "dir" },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file" },
    });
    const skills = [mkSkill("foo", ["claude"])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(report.created).toContain("/vault/.claude/skills/foo");
    expect(report.errors).toEqual([]);
    const link = fs.__dump()["/vault/.claude/skills/foo"];
    expect(link).toEqual({ kind: "link", target: `${CANONICAL}/foo` });
  });

  it("repairs a symlink pointing at the wrong target", async () => {
    const fs = mkFs({
      [`${CANONICAL}/foo`]: { kind: "dir" },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file" },
      "/vault/.claude/skills/foo": { kind: "link", target: "/somewhere/else" },
    });
    const skills = [mkSkill("foo", ["claude"])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(report.errors).toEqual([]);
    const link = fs.__dump()["/vault/.claude/skills/foo"];
    expect(link).toEqual({ kind: "link", target: `${CANONICAL}/foo` });
    expect(report.created).toContain("/vault/.claude/skills/foo");
  });

  it("removes an orphan link pointing into the canonical store", async () => {
    const fs = mkFs({
      [`${CANONICAL}/alive`]: { kind: "dir" },
      [`${CANONICAL}/alive/SKILL.md`]: { kind: "file" },
      "/vault/.claude/skills/alive": { kind: "link", target: `${CANONICAL}/alive` },
      // Orphan: link basename has no matching managed skill.
      "/vault/.claude/skills/orphan": { kind: "link", target: `${CANONICAL}/orphan` },
    });
    const skills = [mkSkill("alive", ["claude"])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(report.removedOrphans).toContain("/vault/.claude/skills/orphan");
    expect(fs.__dump()["/vault/.claude/skills/orphan"]).toBeUndefined();
    // The alive link is left alone.
    expect(fs.__dump()["/vault/.claude/skills/alive"]).toEqual({
      kind: "link",
      target: `${CANONICAL}/alive`,
    });
  });

  it("removes a managed link when that skill is no longer enabled for the agent", async () => {
    const fs = mkFs({
      [`${CANONICAL}/foo`]: { kind: "dir" },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file" },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANONICAL}/foo` },
      "/vault/.opencode/skills/foo": { kind: "link", target: `${CANONICAL}/foo` },
    });
    const skills = [mkSkill("foo", ["claude"])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(report.removedOrphans).toContain("/vault/.opencode/skills/foo");
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toEqual({
      kind: "link",
      target: `${CANONICAL}/foo`,
    });
    expect(fs.__dump()["/vault/.opencode/skills/foo"]).toBeUndefined();
  });

  it("leaves unrelated links untouched during orphan cleanup", async () => {
    const fs = mkFs({
      [`${CANONICAL}/foo`]: { kind: "dir" },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file" },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANONICAL}/foo` },
      "/vault/.claude/skills/external": { kind: "link", target: "/elsewhere/external" },
    });
    const skills = [mkSkill("foo", ["claude"])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(report.removedOrphans).not.toContain("/vault/.claude/skills/external");
    expect(fs.__dump()["/vault/.claude/skills/external"]).toEqual({
      kind: "link",
      target: "/elsewhere/external",
    });
  });

  it("never touches a real directory sitting in an agent path", async () => {
    const fs = mkFs({
      [`${CANONICAL}/foo`]: { kind: "dir" },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file" },
      "/vault/.claude/skills/bar": { kind: "dir" },
      "/vault/.claude/skills/bar/SKILL.md": { kind: "file" },
    });
    const skills = [mkSkill("foo", ["claude"])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    // The real dir is untouched.
    expect(fs.__dump()["/vault/.claude/skills/bar"]).toEqual({ kind: "dir" });
    expect(fs.__dump()["/vault/.claude/skills/bar/SKILL.md"]).toEqual({ kind: "file" });
    expect(report.removedOrphans).not.toContain("/vault/.claude/skills/bar");
  });

  it("reports EPERM on creation as an error without crashing", async () => {
    const fs = mkFs({
      [`${CANONICAL}/foo`]: { kind: "dir" },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file" },
    });
    fs.__setSymlinkBlocked(true);
    const skills = [mkSkill("foo", ["claude"])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(report.created).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].path).toBe("/vault/.claude/skills/foo");
    expect(report.errors[0].reason).toBe("eperm");
    // No link landed.
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toBeUndefined();
  });

  it("leaves links pointing outside the canonical store alone", async () => {
    const fs = mkFs({
      [`${CANONICAL}/foo`]: { kind: "dir" },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file" },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANONICAL}/foo` },
      // User-owned link to somewhere else — reconciliation must not touch it.
      "/vault/.claude/skills/userOwned": { kind: "link", target: "/elsewhere/x" },
    });
    const skills = [mkSkill("foo", ["claude"])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(report.removedOrphans).not.toContain("/vault/.claude/skills/userOwned");
    expect(fs.__dump()["/vault/.claude/skills/userOwned"]).toEqual({
      kind: "link",
      target: "/elsewhere/x",
    });
  });

  it("handles a missing agent directory by skipping the reverse sweep for that agent", async () => {
    const fs = mkFs({
      [`${CANONICAL}/foo`]: { kind: "dir" },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file" },
    });
    // No `.claude/skills` directory at all.
    const skills = [mkSkill("foo", [])];

    const report = await reconcile({
      skills,
      canonicalAbsRoot: CANONICAL,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(report.created).toEqual([]);
    expect(report.removedOrphans).toEqual([]);
    expect(report.errors).toEqual([]);
  });
});
