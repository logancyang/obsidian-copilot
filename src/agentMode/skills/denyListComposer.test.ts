import { composeDenyList } from "./denyListComposer";
import type { BackendId, Skill } from "./types";

/**
 * Build a minimal Skill with only the fields composeDenyList consults.
 * Keeps the test cases dense — composer is pure, so the other fields don't
 * matter.
 */
function skill(name: string, enabledAgents: BackendId[]): Skill {
  return {
    name,
    description: `${name} skill`,
    filePath: `/x/${name}/SKILL.md`,
    dirPath: `/x/${name}`,
    body: "",
    enabledAgents,
  };
}

/**
 * Mirror of each backend's `BackendDescriptor.crossDiscoveredAgents` for
 * test-only convenience — the production data lives on the descriptors
 * themselves; this is a local fixture so we don't repeat the list in every
 * assertion.
 */
const CROSS: Record<BackendId, BackendId[]> = {
  opencode: ["claude", "codex"],
  claude: [],
  codex: [],
};

const deny = (skills: Skill[], b: BackendId) => composeDenyList(skills, b, CROSS[b]);

describe("composeDenyList", () => {
  it("denies a Claude-only skill in OpenCode (cross-discovered via .claude/skills/)", () => {
    const a = skill("a", ["claude"]);
    expect(deny([a], "opencode")).toEqual(["a"]);
    expect(deny([a], "claude")).toEqual([]);
    expect(deny([a], "codex")).toEqual([]);
  });

  it("does not deny a skill that is enabled for OpenCode (and also Claude)", () => {
    const b = skill("b", ["claude", "opencode"]);
    expect(deny([b], "opencode")).toEqual([]);
    expect(deny([b], "claude")).toEqual([]);
    expect(deny([b], "codex")).toEqual([]);
  });

  it("does not deny a skill that is enabled for nothing", () => {
    // Unreachable in normal usage (no symlinks are created), but if a stale
    // canonical doc has no enabledAgents we must not emit a deny entry.
    const c = skill("c", []);
    expect(deny([c], "opencode")).toEqual([]);
    expect(deny([c], "claude")).toEqual([]);
    expect(deny([c], "codex")).toEqual([]);
  });

  it("does not deny an OpenCode-only skill in OpenCode (not cross-discovered for itself)", () => {
    const d = skill("d", ["opencode"]);
    expect(deny([d], "opencode")).toEqual([]);
    expect(deny([d], "claude")).toEqual([]);
    expect(deny([d], "codex")).toEqual([]);
  });

  it("denies a Codex-only skill in OpenCode (cross-discovered via .agents/skills/)", () => {
    const e = skill("e", ["codex"]);
    expect(deny([e], "opencode")).toEqual(["e"]);
    expect(deny([e], "claude")).toEqual([]);
    expect(deny([e], "codex")).toEqual([]);
  });

  it("returns a sorted, de-duplicated list for mixed skills (A/B/C/D)", () => {
    const a = skill("a", ["claude"]);
    const b = skill("b", ["claude", "opencode"]);
    const c = skill("c", []);
    const d = skill("d", ["opencode"]);
    // intentional ordering: unsorted input, ensure sorted output.
    const all = [d, a, c, b];
    expect(deny(all, "opencode")).toEqual(["a"]);
    expect(deny(all, "claude")).toEqual([]);
    expect(deny(all, "codex")).toEqual([]);
  });

  it("sorts deterministically when multiple skills are denied", () => {
    const z = skill("z-task", ["claude"]);
    const m = skill("m-task", ["codex"]);
    const a = skill("a-task", ["claude"]);
    const all = [z, m, a];
    expect(deny(all, "opencode")).toEqual(["a-task", "m-task", "z-task"]);
  });

  it("is empty when no skills exist", () => {
    expect(deny([], "opencode")).toEqual([]);
    expect(deny([], "claude")).toEqual([]);
    expect(deny([], "codex")).toEqual([]);
  });
});
