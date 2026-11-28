import {
  duplicateSourceDirsFor,
  migrateProjectSkill,
  type MigrateProjectSkillOptions,
  type MigrateSkillFs,
} from "./migrateProjectSkill";
import type { Skill } from "./types";

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

const CANONICAL = "/vault/copilot/skills";
const CLAUDE_DIR = "/vault/.claude/skills";
const CODEX_DIR = "/vault/.agents/skills";
const OPENCODE_DIR = "/vault/.opencode/skills";
const AGENT_DIRS = { claude: CLAUDE_DIR, codex: CODEX_DIR, opencode: OPENCODE_DIR };

const migrate = (
  fs: MigrateSkillFs,
  overrides: Partial<MigrateProjectSkillOptions> = {}
): ReturnType<typeof migrateProjectSkill> =>
  migrateProjectSkill({
    sourceName: "foo",
    sourceDirAbs: `${CLAUDE_DIR}/foo`,
    duplicateSourceDirsAbs: [],
    canonicalAbsRoot: CANONICAL,
    enabledAgentsAfter: ["claude"],
    targetAgentDirsAbs: AGENT_DIRS,
    preTakenNames: [],
    fs,
    ...overrides,
  });

const fileContent = (node: Node | undefined): string | undefined =>
  node?.kind === "file" ? node.content : undefined;

const symlinkTarget = (node: Node | undefined): string | undefined =>
  node?.kind === "symlink" ? node.target : undefined;

describe("migrateProjectSkill", () => {
  describe("migrateProjectSkill()", () => {
    it("moves a single-source project skill into the canonical store and links it for every enabled agent", async () => {
      const fs = mkFs({
        [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
      });

      const result = await migrate(fs, { enabledAgentsAfter: ["claude", "codex"] });

      expect(result).toMatchObject({
        ok: true,
        resolvedName: "foo",
        newDirPath: `${CANONICAL}/foo`,
      });
      const dump = fs.dump();
      expect(fileContent(dump[`${CANONICAL}/foo/SKILL.md`])).toContain(`"claude,codex"`);
      expect(dump[`${CLAUDE_DIR}/foo/SKILL.md`]).toBeUndefined();
      expect(symlinkTarget(dump[`${CLAUDE_DIR}/foo`])).toBe(`${CANONICAL}/foo`);
      expect(symlinkTarget(dump[`${CODEX_DIR}/foo`])).toBe(`${CANONICAL}/foo`);
    });

    it("deletes the mirrored duplicate and links every enabled agent to the canonical copy", async () => {
      const fs = mkFs({
        [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
        [`${CODEX_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
      });

      const result = await migrate(fs, {
        duplicateSourceDirsAbs: [`${CODEX_DIR}/foo`],
        enabledAgentsAfter: ["claude", "codex", "opencode"],
      });

      expect(result.ok).toBe(true);
      const dump = fs.dump();
      expect(dump[`${CODEX_DIR}/foo/SKILL.md`]).toBeUndefined();
      expect(dump[`${CLAUDE_DIR}/foo`]?.kind).toBe("symlink");
      expect(dump[`${CODEX_DIR}/foo`]?.kind).toBe("symlink");
      expect(dump[`${OPENCODE_DIR}/foo`]?.kind).toBe("symlink");
    });

    it("stamps an empty enabled-agents list and creates no links when the last agent was disabled", async () => {
      const fs = mkFs({
        [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo", "claude") },
      });

      const result = await migrate(fs, { enabledAgentsAfter: [] });

      expect(result.ok).toBe(true);
      const dump = fs.dump();
      expect(fileContent(dump[`${CANONICAL}/foo/SKILL.md`])).toContain(
        'copilot-enabled-agents: ""'
      );
      expect(dump[`${CLAUDE_DIR}/foo`]).toBeUndefined();
    });

    it("renames the skill with a numeric suffix when the canonical name is already taken", async () => {
      const fs = mkFs({
        [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
        [`${CANONICAL}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
      });

      const result = await migrate(fs, { preTakenNames: ["foo"] });

      expect(result).toMatchObject({
        ok: true,
        resolvedName: "foo-2",
        newDirPath: `${CANONICAL}/foo-2`,
      });
      const dump = fs.dump();
      expect(dump[`${CANONICAL}/foo-2/SKILL.md`]?.kind).toBe("file");
      expect(dump[`${CLAUDE_DIR}/foo-2`]?.kind).toBe("symlink");
    });

    it("keeps a different real skill of the same name in a target agent slot instead of clobbering it", async () => {
      const fs = mkFs({
        [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
        [`${CODEX_DIR}/foo/SKILL.md`]: { kind: "file", content: "DIFFERENT CONTENT B" },
      });

      const result = await migrate(fs, { enabledAgentsAfter: ["claude", "codex"] });

      expect(result.ok).toBe(true);
      const dump = fs.dump();
      expect(dump[`${CANONICAL}/foo/SKILL.md`]?.kind).toBe("file");
      expect(dump[`${CLAUDE_DIR}/foo`]?.kind).toBe("symlink");
      expect(dump[`${CODEX_DIR}/foo`]?.kind).toBe("dir");
      expect(fileContent(dump[`${CODEX_DIR}/foo/SKILL.md`])).toBe("DIFFERENT CONTENT B");
    });

    it("rolls the directory back to its source and fails when the moved SKILL.md cannot be parsed", async () => {
      const fs = mkFs({
        [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: "not valid frontmatter" },
      });

      const result = await migrate(fs);

      expect(result.ok).toBe(false);
      const dump = fs.dump();
      expect(dump[`${CLAUDE_DIR}/foo/SKILL.md`]?.kind).toBe("file");
      expect(dump[`${CANONICAL}/foo`]).toBeUndefined();
    });

    it("reports a mutated eperm failure and keeps the canonical copy when symlink creation is not permitted", async () => {
      const fs = mkFs({
        [`${CLAUDE_DIR}/foo/SKILL.md`]: { kind: "file", content: skillMd("foo") },
      });
      fs.blockSymlink(true);

      const result = await migrate(fs);

      expect(result).toMatchObject({ ok: false, reason: "eperm", mutated: true });
      expect(fs.dump()[`${CANONICAL}/foo/SKILL.md`]?.kind).toBe("file");
    });
  });

  describe("duplicateSourceDirsFor()", () => {
    const projectSkill = (agentDirs: Skill["enabledAgents"]): Skill => ({
      name: "foo",
      description: "A skill.",
      filePath: `${CLAUDE_DIR}/foo/SKILL.md`,
      dirPath: `${CLAUDE_DIR}/foo`,
      body: "",
      enabledAgents: [],
      location: { kind: "project", agentDirs },
    });

    it("lists the mirrored directories of every agent except the representative copy", () => {
      expect(duplicateSourceDirsFor(projectSkill(["claude", "codex"]), AGENT_DIRS)).toEqual([
        `${CODEX_DIR}/foo`,
      ]);
    });

    it("returns no directories for a canonical skill", () => {
      const skill: Skill = { ...projectSkill([]), location: { kind: "canonical" } };
      expect(duplicateSourceDirsFor(skill, AGENT_DIRS)).toEqual([]);
    });
  });
});
