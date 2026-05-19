import { runBulkMove } from "./bulkMove";
import type { BulkMoveFs } from "./bulkMove";
import type { ImportCandidate } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

/**
 * Build a tiny in-memory FS that's just rich enough for the bulk-move
 * orchestration. Entries are stored as either text (files) or as a
 * marker (`__dir__`). Symlinks are stored with the prefix `__link__:`
 * followed by the absolute target.
 */
type Node =
  | { kind: "file"; content: string }
  | { kind: "dir" }
  | { kind: "symlink"; target: string };

function mkFs(initial: Record<string, Node> = {}): BulkMoveFs & {
  __dump(): Record<string, Node>;
  __setSymlinkBlocked(blocked: boolean): void;
} {
  const map = new Map<string, Node>(Object.entries(initial));
  // Synthesize directory entries for every ancestor.
  for (const fullPath of Array.from(map.keys())) {
    const parts = fullPath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (ancestor.length === 0) continue;
      if (!map.has(ancestor)) map.set(ancestor, { kind: "dir" });
    }
  }

  let symlinkBlocked = false;

  /**
   * Move a subtree atomically — every entry whose path starts with
   * `from + "/"` or equals `from` is rewritten to start with `to`.
   */
  function rename(from: string, to: string): void {
    if (!map.has(from)) throw Object.assign(new Error(`ENOENT: ${from}`), { code: "ENOENT" });
    if (map.has(to)) throw Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST" });
    const prefix = from + "/";
    const moves: Array<[string, string]> = [];
    for (const k of map.keys()) {
      if (k === from) moves.push([k, to]);
      else if (k.startsWith(prefix)) moves.push([k, to + k.slice(from.length)]);
    }
    for (const [oldKey, newKey] of moves) {
      const v = map.get(oldKey)!;
      map.delete(oldKey);
      map.set(newKey, v);
    }
    // Ensure ancestors of `to` exist.
    const parts = to.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (ancestor.length === 0) continue;
      if (!map.has(ancestor)) map.set(ancestor, { kind: "dir" });
    }
  }

  const fs: BulkMoveFs & {
    __dump(): Record<string, Node>;
    __setSymlinkBlocked(blocked: boolean): void;
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
      map.set(linkPath, { kind: "symlink", target });
    },
    async unlink(p) {
      const e = map.get(p);
      if (e === undefined) return;
      if (e.kind !== "symlink") return; // mimics our helper guard upstream
      map.delete(p);
    },
    async rmRecursive(p) {
      const prefix = p + "/";
      for (const k of Array.from(map.keys())) {
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
    __dump() {
      return Object.fromEntries(map);
    },
    __setSymlinkBlocked(blocked) {
      symlinkBlocked = blocked;
    },
  };

  // Patch rename helper into the FS so renameWithRetry-style tests work.
  // We monkey-patch onto an internal — bulkMove uses `renameWithRetry` from
  // `node:fs` indirectly. To keep tests pure, override `fs.promises.rename`
  // via the helper module. We achieve this by re-routing through this FS
  // when both source and dest are known to our map. See the rename mock
  // below.
  Object.defineProperty(fs, "__rename", { value: rename, enumerable: false });
  return fs;
}

// `runBulkMove` calls `renameWithRetry`, which lives in its own module and
// uses `node:fs`. To keep this an in-memory test we replace that module.
let currentRename: ((from: string, to: string) => void) | null = null;
jest.mock("./renameWithRetry", () => ({
  __esModule: true,
  renameWithRetry: jest.fn(async (from: string, to: string) => {
    if (currentRename === null) throw new Error("rename not bound");
    currentRename(from, to);
  }),
}));

const CANONICAL = "/vault/copilot/skills";

const VALID_SKILL_MD = (name: string): string =>
  `---\nname: ${name}\ndescription: A short skill.\n---\nbody`;

/** Helper: build a candidate with sensible defaults. */
function candidate(overrides: Partial<ImportCandidate>): ImportCandidate {
  return {
    name: "foo",
    sourceAgent: "claude",
    sourcePath: "/vault/.claude/skills/foo",
    fileCount: 1,
    totalBytes: 80,
    ...overrides,
  };
}

describe("runBulkMove", () => {
  beforeEach(() => {
    currentRename = null;
  });

  it("moves, stamps metadata, and links a single candidate", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/foo/SKILL.md": { kind: "file", content: VALID_SKILL_MD("foo") },
    });
    currentRename = (from, to) =>
      (fs as unknown as { __rename: (a: string, b: string) => void }).__rename(from, to);

    const result = await runBulkMove({
      candidates: [candidate({})],
      canonicalAbsRoot: CANONICAL,
      fs,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("moved");
    expect(result.results[0].targetName).toBe("foo");
    expect(result.results[0].failingSkillMdAbsPath).toBeUndefined();

    const dump = fs.__dump();
    // Canonical dir + SKILL.md present:
    expect(dump["/vault/copilot/skills/foo"].kind).toBe("dir");
    expect(dump["/vault/copilot/skills/foo/SKILL.md"].kind).toBe("file");
    // Metadata stamped:
    const md = (dump["/vault/copilot/skills/foo/SKILL.md"] as { kind: "file"; content: string })
      .content;
    expect(md).toContain("copilot-enabled-agents");
    expect(md).toContain("claude");
    // Source path was replaced with a symlink pointing back at the canonical copy.
    const linkEntry = dump["/vault/.claude/skills/foo"];
    expect(linkEntry.kind).toBe("symlink");
    expect((linkEntry as { kind: "symlink"; target: string }).target).toBe(
      "/vault/copilot/skills/foo"
    );
  });

  it("auto-suffixes on name collision", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/foo/SKILL.md": { kind: "file", content: VALID_SKILL_MD("foo") },
      "/vault/copilot/skills/foo/SKILL.md": { kind: "file", content: VALID_SKILL_MD("foo") },
    });
    currentRename = (from, to) =>
      (fs as unknown as { __rename: (a: string, b: string) => void }).__rename(from, to);

    const result = await runBulkMove({
      candidates: [candidate({})],
      canonicalAbsRoot: CANONICAL,
      preTaken: ["foo"],
      fs,
    });

    expect(result.results[0].status).toBe("moved");
    expect(result.results[0].targetName).toBe("foo-2");

    const dump = fs.__dump();
    expect(dump["/vault/copilot/skills/foo-2"].kind).toBe("dir");
    // The auto-suffix rewrites `name:` inside SKILL.md so the spec's
    // parent-directory-match rule holds for the canonical copy.
    const md = (dump["/vault/copilot/skills/foo-2/SKILL.md"] as { kind: "file"; content: string })
      .content;
    expect(md).toContain("name: foo-2");
    expect(md).toContain("copilot-enabled-agents");
  });

  it("rolls back when SKILL.md fails to parse", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/foo/SKILL.md": { kind: "file", content: "not yaml at all" },
    });
    currentRename = (from, to) =>
      (fs as unknown as { __rename: (a: string, b: string) => void }).__rename(from, to);

    const result = await runBulkMove({
      candidates: [candidate({})],
      canonicalAbsRoot: CANONICAL,
      fs,
    });

    expect(result.results[0].status).toBe("rolledBack");
    expect(result.results[0].reason).toBeDefined();
    // Points at the restored source SKILL.md so the UI can offer "Edit SKILL.md".
    expect(result.results[0].failingSkillMdAbsPath).toBe("/vault/.claude/skills/foo/SKILL.md");

    const dump = fs.__dump();
    // Source restored:
    expect(dump["/vault/.claude/skills/foo/SKILL.md"].kind).toBe("file");
    // No canonical entry:
    expect(dump["/vault/copilot/skills/foo"]).toBeUndefined();
  });

  it("returns epermNoLink when symlink creation fails", async () => {
    const fs = mkFs({
      "/vault/.claude/skills/foo/SKILL.md": { kind: "file", content: VALID_SKILL_MD("foo") },
    });
    currentRename = (from, to) =>
      (fs as unknown as { __rename: (a: string, b: string) => void }).__rename(from, to);
    fs.__setSymlinkBlocked(true);

    const result = await runBulkMove({
      candidates: [candidate({})],
      canonicalAbsRoot: CANONICAL,
      fs,
    });

    expect(result.results[0].status).toBe("epermNoLink");
    // Canonical copy survives — UI offers an editor link to that file.
    expect(result.results[0].failingSkillMdAbsPath).toBe("/vault/copilot/skills/foo/SKILL.md");

    const dump = fs.__dump();
    // Canonical preserved:
    expect(dump["/vault/copilot/skills/foo"].kind).toBe("dir");
    expect(dump["/vault/copilot/skills/foo/SKILL.md"].kind).toBe("file");
    // No symlink at the original path:
    expect(dump["/vault/.claude/skills/foo"]).toBeUndefined();
  });
});
