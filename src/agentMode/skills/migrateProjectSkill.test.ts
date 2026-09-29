import { migrateProjectSkill, type MigrateSkillFs } from "./migrateProjectSkill";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

let activeRename: ((from: string, to: string) => void) | null = null;

jest.mock("./renameWithRetry", () => ({
  renameWithRetry: jest.fn(async (from: string, to: string) => {
    if (activeRename === null) {
      throw new Error("renameWithRetry mock called with no in-memory FS active");
    }
    activeRename(from, to);
  }),
}));

type Node =
  | { kind: "file"; content: string }
  | { kind: "dir" }
  | { kind: "symlink"; target: string };

function mkFs(initial: Record<string, Node> = {}): MigrateSkillFs & {
  dump(): Record<string, Node>;
  blockSymlink(blocked: boolean): void;
} {
  const map = new Map<string, Node>(Object.entries(initial));
  for (const p of [...map.keys()]) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (ancestor.length === 0) continue;
      if (!map.has(ancestor)) map.set(ancestor, { kind: "dir" });
    }
  }

  let symlinkBlocked = false;

  function renameSubtree(from: string, to: string): void {
    if (!map.has(from)) {
      throw Object.assign(new Error(`ENOENT: ${from}`), { code: "ENOENT" });
    }
    if (map.has(to)) {
      throw Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST" });
    }
    const prefix = `${from}/`;
    const moves: Array<[string, string]> = [];
    for (const k of map.keys()) {
      if (k === from) moves.push([k, to]);
      else if (k.startsWith(prefix)) moves.push([k, `${to}${k.slice(from.length)}`]);
    }
    for (const [oldKey, newKey] of moves) {
      const v = map.get(oldKey)!;
      map.delete(oldKey);
      map.set(newKey, v);
    }
    const parts = to.split("/");
    for (let i = 1; i < parts.length; i++) {
      const a = parts.slice(0, i).join("/");
      if (a.length === 0) continue;
      if (!map.has(a)) map.set(a, { kind: "dir" });
    }
  }

  activeRename = renameSubtree;

  const fs: MigrateSkillFs & {
    dump(): Record<string, Node>;
    blockSymlink(blocked: boolean): void;
  } = {
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
    async symlink(target, linkPath) {
      if (symlinkBlocked) {
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      }
      if (map.has(linkPath)) {
        throw Object.assign(new Error(`EEXIST: ${linkPath}`), { code: "EEXIST" });
      }
      const parent = linkPath.slice(0, linkPath.lastIndexOf("/"));
      if (parent.length > 0 && !map.has(parent)) map.set(parent, { kind: "dir" });
      map.set(linkPath, { kind: "symlink", target });
    },
    async unlink(p) {
      const e = map.get(p);
      if (e === undefined) return;
      if (e.kind !== "symlink") return;
      map.delete(p);
    },
    async rmRecursive(p) {
      const prefix = `${p}/`;
      for (const k of [...map.keys()]) {
        if (k === p || k.startsWith(prefix)) map.delete(k);
      }
    },
    async readFile(p) {
      const e = map.get(p);
      if (e === undefined || e.kind !== "file") {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      }
      return e.content;
    },
    async writeFile(p, content) {
      const parent = p.slice(0, p.lastIndexOf("/"));
      if (parent.length > 0 && !map.has(parent)) map.set(parent, { kind: "dir" });
      map.set(p, { kind: "file", content });
    },
    async mkdirRecursive(p) {
      const parts = p.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const ancestor = parts.slice(0, i).join("/");
        if (ancestor.length === 0) continue;
        if (!map.has(ancestor)) map.set(ancestor, { kind: "dir" });
      }
    },
    async list(p) {
      const prefix = `${p}/`;
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
    dump() {
      return Object.fromEntries(map);
    },
    blockSymlink(blocked) {
      symlinkBlocked = blocked;
    },
  };

  return fs;
}

const skillMd = (name: string, agents = ""): string =>
  [
    "---",
    `name: ${name}`,
    "description: A skill.",
    "metadata:",
    `  copilot-enabled-agents: "${agents}"`,
    "---",
    "body",
  ].join("\n");

describe("migrateProjectSkill", () => {
  const CANONICAL = "/vault/copilot/skills";
  const CLAUDE_DIR = "/vault/.claude/skills";
  const CODEX_DIR = "/vault/.agents/skills";
  const OPENCODE_DIR = "/vault/.opencode/skills";

  it("migrates a single-source project skill and creates symlinks at every enabled agent", async () => {
    const fs = mkFs({
      [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
    });

    const result = await migrateProjectSkill({
      sourceName: "foo",
      sourceDirAbs: `${CLAUDE_DIR}/foo`,
      duplicateSourceDirsAbs: [],
      canonicalAbsRoot: CANONICAL,
      enabledAgentsAfter: ["claude", "codex"],
      targetAgentDirsAbs: {
        claude: CLAUDE_DIR,
        codex: CODEX_DIR,
        opencode: OPENCODE_DIR,
      },
      preTakenNames: [],
      fs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedName).toBe("foo");
    expect(result.newDirPath).toBe(`${CANONICAL}/foo`);

    const dump = fs.dump();
    const canonicalFile = dump[`${CANONICAL}/foo/SKILL.md`];
    expect(canonicalFile?.kind).toBe("file");
    if (canonicalFile?.kind === "file") {
      expect(canonicalFile.content).toContain(`"claude,codex"`);
    }

    expect(dump[`${CLAUDE_DIR}/foo/SKILL.md`]).toBeUndefined();

    const claudeLink = dump[`${CLAUDE_DIR}/foo`];
    const codexLink = dump[`${CODEX_DIR}/foo`];
    expect(claudeLink?.kind).toBe("symlink");
    expect(codexLink?.kind).toBe("symlink");
    if (claudeLink?.kind === "symlink") {
      expect(claudeLink.target).toBe(`${CANONICAL}/foo`);
    }
    if (codexLink?.kind === "symlink") {
      expect(codexLink.target).toBe(`${CANONICAL}/foo`);
    }
  });

  it("migrates a mirrored project skill, deleting the duplicate", async () => {
    const fs = mkFs({
      [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
      [`${CODEX_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
    });

    const result = await migrateProjectSkill({
      sourceName: "foo",
      sourceDirAbs: `${CLAUDE_DIR}/foo`,
      duplicateSourceDirsAbs: [`${CODEX_DIR}/foo`],
      canonicalAbsRoot: CANONICAL,
      enabledAgentsAfter: ["claude", "codex", "opencode"],
      targetAgentDirsAbs: {
        claude: CLAUDE_DIR,
        codex: CODEX_DIR,
        opencode: OPENCODE_DIR,
      },
      preTakenNames: [],
      fs,
    });

    expect(result.ok).toBe(true);
    const dump = fs.dump();
    expect(dump[`${CODEX_DIR}/foo/SKILL.md`]).toBeUndefined();
    expect(dump[`${CLAUDE_DIR}/foo`]?.kind).toBe("symlink");
    expect(dump[`${CODEX_DIR}/foo`]?.kind).toBe("symlink");
    expect(dump[`${OPENCODE_DIR}/foo`]?.kind).toBe("symlink");
  });

  it("refuses to clobber a different real skill of the same name in a target agent slot", async () => {
    const fs = mkFs({
      [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
      [`${CODEX_DIR}/foo/SKILL.md`]: { kind: "file", content: "DIFFERENT CONTENT B" },
    });

    const result = await migrateProjectSkill({
      sourceName: "foo",
      sourceDirAbs: `${CLAUDE_DIR}/foo`,
      duplicateSourceDirsAbs: [],
      canonicalAbsRoot: CANONICAL,
      enabledAgentsAfter: ["claude", "codex"],
      targetAgentDirsAbs: { claude: CLAUDE_DIR, codex: CODEX_DIR, opencode: OPENCODE_DIR },
      preTakenNames: [],
      fs,
    });

    expect(result.ok).toBe(true);
    const dump = fs.dump();
    expect(dump[`${CANONICAL}/foo/SKILL.md`]?.kind).toBe("file");
    expect(dump[`${CLAUDE_DIR}/foo`]?.kind).toBe("symlink");
    expect(dump[`${CODEX_DIR}/foo`]?.kind).toBe("dir");
    const codexFile = dump[`${CODEX_DIR}/foo/SKILL.md`];
    expect(codexFile?.kind).toBe("file");
    if (codexFile?.kind === "file") {
      expect(codexFile.content).toBe("DIFFERENT CONTENT B");
    }
  });

  it("suffixes the target name when the canonical name collides", async () => {
    const fs = mkFs({
      [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
      [`${CANONICAL}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
    });

    const result = await migrateProjectSkill({
      sourceName: "foo",
      sourceDirAbs: `${CLAUDE_DIR}/foo`,
      duplicateSourceDirsAbs: [],
      canonicalAbsRoot: CANONICAL,
      enabledAgentsAfter: ["claude"],
      targetAgentDirsAbs: { claude: CLAUDE_DIR },
      preTakenNames: ["foo"],
      fs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedName).toBe("foo-2");
    expect(result.newDirPath).toBe(`${CANONICAL}/foo-2`);
    const dump = fs.dump();
    expect(dump[`${CANONICAL}/foo-2/SKILL.md`]?.kind).toBe("file");
    const claudeLink = dump[`${CLAUDE_DIR}/foo-2`];
    expect(claudeLink?.kind).toBe("symlink");
  });

  it("migrates with an empty enabled-agents list (disable-last-agent flow)", async () => {
    const fs = mkFs({
      [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo", "claude") },
    });

    const result = await migrateProjectSkill({
      sourceName: "foo",
      sourceDirAbs: `${CLAUDE_DIR}/foo`,
      duplicateSourceDirsAbs: [],
      canonicalAbsRoot: CANONICAL,
      enabledAgentsAfter: [],
      targetAgentDirsAbs: { claude: CLAUDE_DIR },
      preTakenNames: [],
      fs,
    });

    expect(result.ok).toBe(true);
    const dump = fs.dump();
    expect(dump[`${CANONICAL}/foo/SKILL.md`]?.kind).toBe("file");
    expect(dump[`${CLAUDE_DIR}/foo`]).toBeUndefined();
    const canonical = dump[`${CANONICAL}/foo/SKILL.md`];
    if (canonical?.kind === "file") {
      expect(canonical.content).toContain('copilot-enabled-agents: ""');
    }
  });

  it("rolls back the move when the moved SKILL.md fails to parse", async () => {
    const fs = mkFs({
      [`${CLAUDE_DIR}/foo/SKILL.md`]: {
        kind: "file",
        content: "not valid frontmatter",
      },
    });

    const result = await migrateProjectSkill({
      sourceName: "foo",
      sourceDirAbs: `${CLAUDE_DIR}/foo`,
      duplicateSourceDirsAbs: [],
      canonicalAbsRoot: CANONICAL,
      enabledAgentsAfter: ["claude"],
      targetAgentDirsAbs: { claude: CLAUDE_DIR },
      preTakenNames: [],
      fs,
    });

    expect(result.ok).toBe(false);
    const dump = fs.dump();
    expect(dump[`${CLAUDE_DIR}/foo/SKILL.md`]?.kind).toBe("file");
    expect(dump[`${CANONICAL}/foo`]).toBeUndefined();
  });

  it("reports EPERM when symlink creation fails but leaves canonical in place", async () => {
    const fs = mkFs({
      [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
    });
    fs.blockSymlink(true);

    const result = await migrateProjectSkill({
      sourceName: "foo",
      sourceDirAbs: `${CLAUDE_DIR}/foo`,
      duplicateSourceDirsAbs: [],
      canonicalAbsRoot: CANONICAL,
      enabledAgentsAfter: ["claude"],
      targetAgentDirsAbs: { claude: CLAUDE_DIR },
      preTakenNames: [],
      fs,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("eperm");
    expect(result.mutated).toBe(true);
    const dump = fs.dump();
    expect(dump[`${CANONICAL}/foo/SKILL.md`]?.kind).toBe("file");
  });
});
