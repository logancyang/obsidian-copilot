import { parseSkillFile } from "./skillFormat";
import { runRenameSkill, runUpdateProperties, type PropertiesFs } from "./updateProperties";
import type { Skill } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// `runRenameSkill` calls `renameWithRetry` for the canonical dir-rename.
// Provide an in-memory implementation that mutates the FS map so tests can
// assert on the renamed paths.
let renameImpl: ((from: string, to: string) => Promise<void>) | null = null;
jest.mock("./renameWithRetry", () => ({
  __esModule: true,
  renameWithRetry: jest.fn(async (from: string, to: string) => {
    if (renameImpl !== null) {
      await renameImpl(from, to);
    } else {
      throw new Error("renameWithRetry was not stubbed for this test");
    }
  }),
}));

type Node = { kind: "dir" } | { kind: "file"; content: string } | { kind: "link"; target: string };

function mkFs(initial: Record<string, Node> = {}): PropertiesFs & {
  __dump(): Record<string, Node>;
  __setSymlinkBlocked(blocked: boolean): void;
} {
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

  // Wire the rename-with-retry stub to mutate this map.
  renameImpl = async (from: string, to: string) => {
    const fromNode = map.get(from);
    if (fromNode === undefined) {
      throw Object.assign(new Error(`ENOENT: ${from}`), { code: "ENOENT" });
    }
    if (map.has(to)) {
      throw Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST" });
    }
    ensureAncestors(to);
    // Walk every path with the `from` prefix and re-key under `to`.
    const fromPrefix = from + "/";
    const toPrefix = to + "/";
    const renamed: Array<[string, Node]> = [];
    for (const [k, v] of map.entries()) {
      if (k === from) {
        renamed.push([to, v]);
      } else if (k.startsWith(fromPrefix)) {
        renamed.push([toPrefix + k.slice(fromPrefix.length), v]);
      }
    }
    // Delete old entries.
    for (const [k] of Array.from(map.entries())) {
      if (k === from || k.startsWith(fromPrefix)) map.delete(k);
    }
    for (const [k, v] of renamed) map.set(k, v);
  };

  return {
    async exists(p) {
      return map.has(p);
    },
    async isDirectory(p) {
      return map.get(p)?.kind === "dir";
    },
    async isSymlink(p) {
      return map.get(p)?.kind === "link";
    },
    async symlink(target, linkPath) {
      if (symlinkBlocked) {
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
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
      return n.content;
    },
    async writeFile(p, content) {
      ensureAncestors(p);
      map.set(p, { kind: "file", content });
    },
    __dump() {
      return Object.fromEntries(map);
    },
    __setSymlinkBlocked(blocked) {
      symlinkBlocked = blocked;
    },
  };
}

afterEach(() => {
  renameImpl = null;
});

const VAULT = "/vault";
const CANON = "/vault/copilot/skills";
const AGENT_DIRS_ABS = {
  claude: `${VAULT}/.claude/skills`,
  codex: `${VAULT}/.agents/skills`,
  opencode: `${VAULT}/.opencode/skills`,
} as const;

/** Build a minimal SKILL.md fixture. Optional unknown metadata keys preserved. */
const SKILL_MD = (
  name: string,
  opts: { agents?: string; description?: string; authorMeta?: string } = {}
): string => {
  const { agents = "", description = "A short skill.", authorMeta } = opts;
  const lines = ["---", `name: ${name}`, `description: ${description}`, "metadata:"];
  if (authorMeta !== undefined) lines.push(`  author: ${authorMeta}`);
  lines.push(`  copilot-enabled-agents: "${agents}"`);
  lines.push("---", "body");
  return lines.join("\n");
};

function mkSkill(name: string, enabledAgents: Skill["enabledAgents"] = []): Skill {
  return {
    name,
    description: "A short skill.",
    filePath: `${CANON}/${name}/SKILL.md`,
    dirPath: `${CANON}/${name}`,
    body: "body",
    enabledAgents,
    location: { kind: "canonical" },
  };
}

describe("runUpdateProperties", () => {
  it("description-only patch rewrites the file and does not touch symlinks", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo", { agents: "claude" }) },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANON}/foo` },
    });

    const result = await runUpdateProperties({
      skill: mkSkill("foo", ["claude"]),
      patch: { description: "An updated short skill." },
      fs,
    });

    expect(result).toEqual({ ok: true });
    const skillMd = fs.__dump()[`${CANON}/foo/SKILL.md`];
    expect(skillMd.kind).toBe("file");
    expect((skillMd as { kind: "file"; content: string }).content).toMatch(
      /description: An updated short skill\./
    );
    // Symlink untouched.
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toEqual({
      kind: "link",
      target: `${CANON}/foo`,
    });
  });

  it("preserves unknown top-level keys and unknown metadata.* keys byte-equal", async () => {
    // Hand-construct a SKILL.md that carries an unknown top-level key
    // (`license`) and an unknown metadata key (`author`). The patch should
    // touch only `description`; everything else must survive untouched.
    const original = [
      "---",
      "name: foo",
      "description: original description",
      "license: MIT",
      "metadata:",
      "  author: alice",
      '  copilot-enabled-agents: "claude"',
      "---",
      "body",
    ].join("\n");

    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: original },
    });

    const result = await runUpdateProperties({
      skill: mkSkill("foo", ["claude"]),
      patch: { description: "new description" },
      fs,
    });
    expect(result).toEqual({ ok: true });

    const skillMd = fs.__dump()[`${CANON}/foo/SKILL.md`];
    const next = (skillMd as { kind: "file"; content: string }).content;

    // Parse the result and assert structural preservation.
    const parsed = parseSkillFile(next, "foo");
    expect(parsed.frontmatter.description).toBe("new description");
    expect(parsed.frontmatter.license).toBe("MIT");
    expect(parsed.frontmatter.enabledAgents).toEqual(["claude"]);

    // The unknown metadata key should still appear verbatim in the raw output.
    expect(next).toMatch(/author: alice/);
  });

  it("emits Claude-only flags as top-level frontmatter keys", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo") },
    });
    const result = await runUpdateProperties({
      skill: mkSkill("foo"),
      patch: {
        description: "A short skill.",
        allowedTools: "Read Grep",
        model: "claude-sonnet-4",
        disableModelInvocation: true,
        userInvocable: false,
      },
      fs,
    });
    expect(result).toEqual({ ok: true });

    const next = (fs.__dump()[`${CANON}/foo/SKILL.md`] as { kind: "file"; content: string })
      .content;
    expect(next).toMatch(/^allowed-tools: Read Grep$/m);
    expect(next).toMatch(/^model: claude-sonnet-4$/m);
    expect(next).toMatch(/^disable-model-invocation: true$/m);
    expect(next).toMatch(/^user-invocable: false$/m);
  });
});

describe("runRenameSkill", () => {
  it("happy path with two enabled agents: dir renamed, symlinks repointed, name rewritten", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: {
        kind: "file",
        content: SKILL_MD("foo", { agents: "claude,opencode" }),
      },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANON}/foo` },
      "/vault/.opencode/skills/foo": { kind: "link", target: `${CANON}/foo` },
    });

    const result = await runRenameSkill({
      skill: mkSkill("foo", ["claude", "opencode"]),
      newName: "bar",
      canonicalAbsRoot: CANON,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result.ok).toBe(true);

    // Old paths gone, new paths exist.
    expect(fs.__dump()[`${CANON}/foo`]).toBeUndefined();
    expect(fs.__dump()[`${CANON}/foo/SKILL.md`]).toBeUndefined();
    expect(fs.__dump()[`${CANON}/bar`]).toEqual({ kind: "dir" });

    // Both symlinks repointed to the new absolute target with new basename.
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toBeUndefined();
    expect(fs.__dump()["/vault/.opencode/skills/foo"]).toBeUndefined();
    expect(fs.__dump()["/vault/.claude/skills/bar"]).toEqual({
      kind: "link",
      target: `${CANON}/bar`,
    });
    expect(fs.__dump()["/vault/.opencode/skills/bar"]).toEqual({
      kind: "link",
      target: `${CANON}/bar`,
    });

    // SKILL.md `name:` rewritten.
    const skillMd = fs.__dump()[`${CANON}/bar/SKILL.md`];
    expect(skillMd.kind).toBe("file");
    expect((skillMd as { kind: "file"; content: string }).content).toMatch(/^name: bar$/m);
  });

  it("project-single skill renames IN PLACE inside its agent folder (no canonical move, no symlinks)", async () => {
    // Regression: a project skill must NOT be relocated into the canonical
    // folder on rename (that would drop its inferred enabled-agents and let
    // reconciliation sweep the orphan link, disabling it everywhere). Per
    // Skills Discovery Redesign §244 the rename happens in place.
    const fs = mkFs({
      "/vault/.claude/skills/foo/SKILL.md": {
        kind: "file",
        content: ["---", "name: foo", "description: A short skill.", "---", "body"].join("\n"),
      },
    });

    const skill: Skill = {
      name: "foo",
      description: "A short skill.",
      filePath: "/vault/.claude/skills/foo/SKILL.md",
      dirPath: "/vault/.claude/skills/foo",
      body: "body",
      enabledAgents: ["claude"],
      location: { kind: "project", agentDirs: ["claude"] },
    };

    const result = await runRenameSkill({
      skill,
      newName: "bar",
      canonicalAbsRoot: CANON,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newDirPath).toBe("/vault/.claude/skills/bar");
    }

    // Renamed in place; old name gone, new name is a real dir in the agent folder.
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toBeUndefined();
    expect(fs.__dump()["/vault/.claude/skills/bar"]).toEqual({ kind: "dir" });

    // Crucially: NOT moved into the canonical folder, and no symlink created.
    expect(fs.__dump()[`${CANON}/bar`]).toBeUndefined();
    expect(fs.__dump()["/vault/.claude/skills/bar"]).not.toEqual({
      kind: "link",
      target: expect.anything(),
    });

    // SKILL.md `name:` rewritten in place.
    const skillMd = fs.__dump()["/vault/.claude/skills/bar/SKILL.md"];
    expect(skillMd.kind).toBe("file");
    expect((skillMd as { kind: "file"; content: string }).content).toMatch(/^name: bar$/m);
  });

  it("collision: returns reason 'collision' with no filesystem mutation", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo") },
      [`${CANON}/baz/SKILL.md`]: { kind: "file", content: SKILL_MD("baz") },
    });
    const before = JSON.stringify(fs.__dump());

    const result = await runRenameSkill({
      skill: mkSkill("foo"),
      newName: "baz",
      canonicalAbsRoot: CANON,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result).toEqual({ ok: false, reason: "collision" });
    expect(JSON.stringify(fs.__dump())).toBe(before);
  });

  it("invalid new name: returns reason 'invalid' with no mutation", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo") },
    });
    const before = JSON.stringify(fs.__dump());

    const result = await runRenameSkill({
      skill: mkSkill("foo"),
      newName: "Bad-Name", // uppercase
      canonicalAbsRoot: CANON,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(JSON.stringify(fs.__dump())).toBe(before);
  });

  it("EPERM on symlink retarget: canonical rename succeeds, reason 'eperm', successful links point to new target", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: {
        kind: "file",
        content: SKILL_MD("foo", { agents: "claude,opencode" }),
      },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANON}/foo` },
      "/vault/.opencode/skills/foo": { kind: "link", target: `${CANON}/foo` },
    });

    // After old links are removed, blocking symlink creation triggers EPERM
    // on every retarget. Canonical rename should still succeed.
    fs.__setSymlinkBlocked(true);

    const result = await runRenameSkill({
      skill: mkSkill("foo", ["claude", "opencode"]),
      newName: "bar",
      canonicalAbsRoot: CANON,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result).toEqual({ ok: false, reason: "eperm", mutated: true });
    // Canonical rename did succeed.
    expect(fs.__dump()[`${CANON}/foo`]).toBeUndefined();
    expect(fs.__dump()[`${CANON}/bar`]).toEqual({ kind: "dir" });
    // SKILL.md `name:` was rewritten.
    const skillMd = fs.__dump()[`${CANON}/bar/SKILL.md`];
    expect((skillMd as { kind: "file"; content: string }).content).toMatch(/^name: bar$/m);
  });

  it("EPERM partial: links that did succeed point to the new target", async () => {
    // Block symlink creation only after the first successful one. We simulate
    // by toggling the blocker mid-test via a custom symlink wrapper.
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: {
        kind: "file",
        content: SKILL_MD("foo", { agents: "claude,opencode" }),
      },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANON}/foo` },
      "/vault/.opencode/skills/foo": { kind: "link", target: `${CANON}/foo` },
    });

    // Wrap `symlink` so the second call (for opencode) trips EPERM.
    let symlinkCallCount = 0;
    const origSymlink = fs.symlink.bind(fs);
    fs.symlink = async (target: string, linkPath: string) => {
      symlinkCallCount += 1;
      if (symlinkCallCount >= 2) {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }
      return origSymlink(target, linkPath);
    };

    const result = await runRenameSkill({
      skill: mkSkill("foo", ["claude", "opencode"]),
      newName: "bar",
      canonicalAbsRoot: CANON,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result).toEqual({ ok: false, reason: "eperm", mutated: true });
    // Successful link points to new target.
    expect(fs.__dump()["/vault/.claude/skills/bar"]).toEqual({
      kind: "link",
      target: `${CANON}/bar`,
    });
    // Failed link's old basename was removed but never recreated.
    expect(fs.__dump()["/vault/.opencode/skills/foo"]).toBeUndefined();
    expect(fs.__dump()["/vault/.opencode/skills/bar"]).toBeUndefined();
  });

  it("no-op rename (newName === skill.name) returns ok without touching FS", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo") },
    });
    const before = JSON.stringify(fs.__dump());

    const result = await runRenameSkill({
      skill: mkSkill("foo"),
      newName: "foo",
      canonicalAbsRoot: CANON,
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(fs.__dump())).toBe(before);
  });
});
