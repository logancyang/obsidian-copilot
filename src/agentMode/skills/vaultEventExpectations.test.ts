import {
  absToVaultRel,
  buildDeleteExpectations,
  buildReconcileExpectations,
  buildRenameExpectations,
  buildToggleExpectations,
  buildUpdatePropertiesExpectations,
  matchExpectation,
  type Expectation,
} from "./vaultEventExpectations";
import type { Skill } from "./types";

describe("vaultEventExpectations", () => {
  describe("absToVaultRel", () => {
    it("strips a vault-root prefix", () => {
      expect(absToVaultRel("/vault/copilot/skills/foo", "/vault")).toBe("copilot/skills/foo");
    });

    it("returns empty string when the path is the vault root", () => {
      expect(absToVaultRel("/vault", "/vault")).toBe("");
    });

    it("normalizes trailing slashes on the vault root", () => {
      expect(absToVaultRel("/vault/foo", "/vault/")).toBe("foo");
    });

    it("returns null for a path that escapes the vault", () => {
      expect(absToVaultRel("/other/foo", "/vault")).toBeNull();
    });
  });

  describe("matchExpectation", () => {
    it("matches an exact path expectation by path equality only", () => {
      const exp: Expectation = { kind: "exists", vaultRelPath: "copilot/skills/foo/SKILL.md" };
      expect(matchExpectation(exp, "copilot/skills/foo/SKILL.md")).toBe(true);
      expect(matchExpectation(exp, "copilot/skills/foo")).toBe(false);
    });

    it("matches a subtree expectation on the root and any descendant", () => {
      const exp: Expectation = { kind: "subtree-missing", vaultRelPath: "copilot/skills/foo" };
      expect(matchExpectation(exp, "copilot/skills/foo")).toBe(true);
      expect(matchExpectation(exp, "copilot/skills/foo/SKILL.md")).toBe(true);
      expect(matchExpectation(exp, "copilot/skills/foo/nested/file.md")).toBe(true);
      expect(matchExpectation(exp, "copilot/skills/foobar")).toBe(false);
    });
  });

  describe("buildToggleExpectations", () => {
    it("on enable, expects the symlink to exist and SKILL.md to be modified", () => {
      const skill = makeSkill();
      const exps = buildToggleExpectations(skill, true, "/vault/.claude/skills", "/vault");
      expect(exps).toEqual([
        { kind: "modified", vaultRelPath: "copilot/skills/foo/SKILL.md" },
        { kind: "exists", vaultRelPath: ".claude/skills/foo" },
      ]);
    });

    it("on disable, expects the symlink to be missing", () => {
      const skill = makeSkill();
      const exps = buildToggleExpectations(skill, false, "/vault/.claude/skills", "/vault");
      expect(exps).toEqual([
        { kind: "modified", vaultRelPath: "copilot/skills/foo/SKILL.md" },
        { kind: "missing", vaultRelPath: ".claude/skills/foo" },
      ]);
    });
  });

  describe("buildDeleteExpectations", () => {
    it("expects the subtree to be gone and each link to be missing", () => {
      const skill = makeSkill();
      const exps = buildDeleteExpectations(
        skill,
        { claude: "/vault/.claude/skills", opencode: "/vault/.opencode/skills" },
        "/vault"
      );
      expect(exps).toEqual([
        { kind: "subtree-missing", vaultRelPath: "copilot/skills/foo" },
        { kind: "missing", vaultRelPath: ".claude/skills/foo" },
        { kind: "missing", vaultRelPath: ".opencode/skills/foo" },
      ]);
    });
  });

  describe("buildUpdatePropertiesExpectations", () => {
    it("expects one modify event on the canonical SKILL.md", () => {
      const skill = makeSkill();
      const exps = buildUpdatePropertiesExpectations(skill, "/vault");
      expect(exps).toEqual([{ kind: "modified", vaultRelPath: "copilot/skills/foo/SKILL.md" }]);
    });
  });

  describe("buildRenameExpectations", () => {
    it("expects the old subtree to vanish and the new one to appear", () => {
      const skill = makeSkill();
      const exps = buildRenameExpectations(
        skill,
        "bar",
        "/vault/copilot/skills",
        { claude: "/vault/.claude/skills" },
        "/vault"
      );
      expect(exps).toEqual([
        { kind: "subtree-missing", vaultRelPath: "copilot/skills/foo" },
        { kind: "subtree-exists", vaultRelPath: "copilot/skills/bar" },
        { kind: "missing", vaultRelPath: ".claude/skills/foo" },
        { kind: "exists", vaultRelPath: ".claude/skills/bar" },
      ]);
    });
  });

  describe("buildReconcileExpectations", () => {
    it("turns created/removedOrphans into exists/missing expectations", () => {
      const exps = buildReconcileExpectations(
        {
          created: ["/vault/.claude/skills/foo"],
          removedOrphans: ["/vault/.opencode/skills/stale"],
        },
        "/vault"
      );
      expect(exps).toEqual([
        { kind: "exists", vaultRelPath: ".claude/skills/foo" },
        { kind: "missing", vaultRelPath: ".opencode/skills/stale" },
      ]);
    });

    it("drops paths outside the vault", () => {
      const exps = buildReconcileExpectations(
        { created: ["/elsewhere/foo"], removedOrphans: [] },
        "/vault"
      );
      expect(exps).toEqual([]);
    });
  });
});

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "foo",
    description: "A skill.",
    filePath: "/vault/copilot/skills/foo/SKILL.md",
    dirPath: "/vault/copilot/skills/foo",
    body: "body",
    enabledAgents: [],
    location: { kind: "canonical" },
    ...overrides,
  };
}
