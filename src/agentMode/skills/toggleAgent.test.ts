import { runDeleteSkill, runToggleAgent, type ToggleAgentFs } from "./toggleAgent";
import type { Skill } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// `replaceAgentLink` uses `renameWithRetry` internally on the real-dir
// branch. None of these tests hit that branch (no real dir at the link
// slot), so the helper isn't exercised. Stub it anyway so we don't pull
// in `node:fs` from inside Jest.
jest.mock("./renameWithRetry", () => ({
  __esModule: true,
  renameWithRetry: jest.fn(async () => {
    throw new Error("renameWithRetry was not expected in toggleAgent tests");
  }),
}));

type Node = { kind: "dir" } | { kind: "file"; content: string } | { kind: "link"; target: string };

function mkFs(initial: Record<string, Node> = {}): ToggleAgentFs & {
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

const VAULT = "/vault";
const CANON = "/vault/copilot/skills";
const CLAUDE_DIR = `${VAULT}/.claude/skills`;
const CODEX_DIR = `${VAULT}/.agents/skills`;
const OPENCODE_DIR = `${VAULT}/.opencode/skills`;
const AGENT_DIRS_ABS = {
  claude: CLAUDE_DIR,
  codex: CODEX_DIR,
  opencode: OPENCODE_DIR,
} as const;

const SKILL_MD = (name: string, agents = ""): string =>
  [
    "---",
    `name: ${name}`,
    "description: A short skill.",
    "metadata:",
    `  copilot-enabled-agents: "${agents}"`,
    "---",
    "body",
  ].join("\n");

function mkSkill(name: string, enabledAgents: Skill["enabledAgents"] = []): Skill {
  return {
    name,
    description: "A short skill.",
    filePath: `${CANON}/${name}/SKILL.md`,
    dirPath: `${CANON}/${name}`,
    body: "body",
    enabledAgents,
  };
}

describe("runToggleAgent", () => {
  it("turns Claude on: stamps frontmatter and creates the symlink", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo") },
    });

    const result = await runToggleAgent({
      skill: mkSkill("foo", []),
      agent: "claude",
      enabled: true,
      agentDirAbs: CLAUDE_DIR,
      fs,
    });

    expect(result).toEqual({ ok: true });
    const skillMd = fs.__dump()[`${CANON}/foo/SKILL.md`];
    expect(skillMd.kind).toBe("file");
    expect((skillMd as { kind: "file"; content: string }).content).toMatch(
      /copilot-enabled-agents:\s*"?claude"?/
    );
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toEqual({
      kind: "link",
      target: `${CANON}/foo`,
    });
  });

  it("turns Claude off: removes the link and updates frontmatter", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo", "claude") },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANON}/foo` },
    });

    const result = await runToggleAgent({
      skill: mkSkill("foo", ["claude"]),
      agent: "claude",
      enabled: false,
      agentDirAbs: CLAUDE_DIR,
      fs,
    });

    expect(result).toEqual({ ok: true });
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toBeUndefined();
    const skillMd = fs.__dump()[`${CANON}/foo/SKILL.md`];
    expect((skillMd as { kind: "file"; content: string }).content).not.toMatch(/claude/);
  });

  it("EPERM on symlink: returns eperm, frontmatter still updated, no link created", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo") },
    });
    fs.__setSymlinkBlocked(true);

    const result = await runToggleAgent({
      skill: mkSkill("foo", []),
      agent: "claude",
      enabled: true,
      agentDirAbs: CLAUDE_DIR,
      fs,
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe("eperm");
    // Frontmatter still reflects the new agent — reconciliation will heal later.
    const skillMd = fs.__dump()[`${CANON}/foo/SKILL.md`];
    expect((skillMd as { kind: "file"; content: string }).content).toMatch(
      /copilot-enabled-agents:\s*"?claude"?/
    );
    // No link was created.
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toBeUndefined();
  });

  it("re-enabling an already enabled agent is idempotent", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo", "claude") },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANON}/foo` },
    });

    const result = await runToggleAgent({
      skill: mkSkill("foo", ["claude"]),
      agent: "claude",
      enabled: true,
      agentDirAbs: CLAUDE_DIR,
      fs,
    });

    expect(result).toEqual({ ok: true });
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toEqual({
      kind: "link",
      target: `${CANON}/foo`,
    });
  });
});

describe("runDeleteSkill", () => {
  it("removes the canonical dir and every enabled agent's link", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo", "claude,opencode") },
      "/vault/.claude/skills/foo": { kind: "link", target: `${CANON}/foo` },
      "/vault/.opencode/skills/foo": { kind: "link", target: `${CANON}/foo` },
    });

    const result = await runDeleteSkill({
      skill: mkSkill("foo", ["claude", "opencode"]),
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result).toEqual({ ok: true });
    expect(fs.__dump()[`${CANON}/foo`]).toBeUndefined();
    expect(fs.__dump()[`${CANON}/foo/SKILL.md`]).toBeUndefined();
    expect(fs.__dump()["/vault/.claude/skills/foo"]).toBeUndefined();
    expect(fs.__dump()["/vault/.opencode/skills/foo"]).toBeUndefined();
  });

  it("removes only the canonical dir when no agents are enabled", async () => {
    const fs = mkFs({
      [`${CANON}/foo/SKILL.md`]: { kind: "file", content: SKILL_MD("foo") },
    });

    const result = await runDeleteSkill({
      skill: mkSkill("foo", []),
      agentDirsAbs: AGENT_DIRS_ABS,
      fs,
    });

    expect(result).toEqual({ ok: true });
    expect(fs.__dump()[`${CANON}/foo`]).toBeUndefined();
  });
});
