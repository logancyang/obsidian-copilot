import type { ProjectSkillCandidate } from "./discoverProjectSkills";
import { formatSkillDisplayName, mergeDiscovery } from "./mergeDiscovery";
import { parseSkillFile } from "./skillFormat";
import type { BackendId, Skill } from "./types";

function buildParsed(name: string, body = "body", description = "A skill.") {
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
  return parseSkillFile(content, name);
}

function canonicalSkill(name: string, enabledAgents: BackendId[] = []): Skill {
  return {
    name,
    description: "A skill.",
    filePath: `/vault/copilot/skills/${name}/SKILL.md`,
    dirPath: `/vault/copilot/skills/${name}`,
    body: "body",
    enabledAgents,
    location: { kind: "canonical" },
  };
}

function candidate(
  agent: BackendId,
  name: string,
  contentHash: string,
  body = "body"
): ProjectSkillCandidate {
  return {
    agent,
    name,
    filePath: `/vault/.${agent === "codex" ? "agents" : agent}/skills/${name}/SKILL.md`,
    dirPath: `/vault/.${agent === "codex" ? "agents" : agent}/skills/${name}`,
    contentHash,
    parsed: buildParsed(name, body),
  };
}

describe("mergeDiscovery", () => {
  describe("mergeDiscovery()", () => {
    it("passes canonical rows through unchanged when there are no project candidates", () => {
      const merged = mergeDiscovery([canonicalSkill("foo", ["claude"])], []);
      expect(merged).toHaveLength(1);
      expect(merged[0].name).toBe("foo");
      expect(merged[0].location).toEqual({ kind: "canonical" });
      expect(merged[0].enabledAgents).toEqual(["claude"]);
    });

    it("produces a project-single row for a name that exists only under one agent", () => {
      const merged = mergeDiscovery([], [candidate("claude", "bar", "h1")]);
      expect(merged).toHaveLength(1);
      const row = merged[0];
      expect(row.name).toBe("bar");
      expect(row.location).toEqual({ kind: "project", agentDirs: ["claude"] });
      expect(row.enabledAgents).toEqual(["claude"]);
      expect(row.contentHash).toBe("h1");
      expect(row.displayNameSuffix).toBeUndefined();
    });

    it("merges identical project candidates into one mirrored row", () => {
      const merged = mergeDiscovery(
        [],
        [candidate("claude", "foo", "h1"), candidate("codex", "foo", "h1")]
      );
      expect(merged).toHaveLength(1);
      const row = merged[0];
      expect(row.location).toEqual({ kind: "project", agentDirs: ["claude", "codex"] });
      expect(row.enabledAgents).toEqual(["claude", "codex"]);
    });

    it("uses the alphabetically-first agent as the representative dirPath", () => {
      const merged = mergeDiscovery(
        [],
        [candidate("codex", "foo", "h1"), candidate("claude", "foo", "h1")]
      );
      expect(merged).toHaveLength(1);
      expect(merged[0].dirPath).toBe("/vault/.claude/skills/foo");
    });

    it("splits same-name candidates with different content hashes into separate rows", () => {
      const merged = mergeDiscovery(
        [],
        [candidate("claude", "foo", "h1"), candidate("codex", "foo", "h2")]
      );
      expect(merged).toHaveLength(2);
      const labels = merged.map(formatSkillDisplayName).sort();
      expect(labels).toEqual(["foo (claude)", "foo (codex)"]);
    });

    it("drops project candidates whose name collides with a canonical row", () => {
      const merged = mergeDiscovery(
        [canonicalSkill("foo", ["claude"])],
        [candidate("codex", "foo", "h1")]
      );
      expect(merged).toHaveLength(1);
      expect(merged[0].location).toEqual({ kind: "canonical" });
    });

    it("orders rows by name, then by display-name suffix", () => {
      const merged = mergeDiscovery(
        [],
        [
          candidate("opencode", "foo", "h2"),
          candidate("claude", "foo", "h1"),
          candidate("claude", "bar", "hx"),
        ]
      );
      const labels = merged.map(formatSkillDisplayName);
      expect(labels).toEqual(["bar", "foo (claude)", "foo (opencode)"]);
    });

    it("preserves the parsed body and description on project skills", () => {
      const candA = candidate("claude", "foo", "h1", "claude body");
      const merged = mergeDiscovery([], [candA]);
      expect(merged[0].body).toBe("claude body");
      expect(merged[0].description).toBe("A skill.");
    });
  });

  describe("formatSkillDisplayName()", () => {
    it("returns the bare name when no suffix is present", () => {
      expect(formatSkillDisplayName(canonicalSkill("foo"))).toBe("foo");
    });

    it("appends the suffix when set", () => {
      const skill: Skill = {
        ...canonicalSkill("foo"),
        displayNameSuffix: " (claude)",
      };
      expect(formatSkillDisplayName(skill)).toBe("foo (claude)");
    });
  });
});
