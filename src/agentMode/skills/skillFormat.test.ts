import {
  parseSkillFile,
  serializeSkillFile,
  SkillFormatError,
  validateDescription,
  validateName,
} from "./skillFormat";

const minimalSkill = (overrides: Record<string, string> = {}) => {
  const fm = {
    name: "review-prose",
    description: "Critique writing for clarity, voice, and rhythm.",
    ...overrides,
  };
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${yaml}\n---\nbody text`;
};

describe("parseSkillFile — happy path", () => {
  it("parses a valid SKILL.md", () => {
    const parsed = parseSkillFile(minimalSkill(), "review-prose");
    expect(parsed.frontmatter.name).toBe("review-prose");
    expect(parsed.frontmatter.description).toBe("Critique writing for clarity, voice, and rhythm.");
    expect(parsed.frontmatter.enabledAgents).toEqual([]);
    expect(parsed.body).toBe("body text");
  });

  it("reads Claude-only top-level flags", () => {
    const content = [
      "---",
      "name: foo",
      "description: A skill",
      "model: claude-opus-4-7",
      "disable-model-invocation: true",
      "user-invocable: false",
      "allowed-tools: Read Grep",
      "---",
      "body",
    ].join("\n");
    const parsed = parseSkillFile(content, "foo");
    expect(parsed.frontmatter.model).toBe("claude-opus-4-7");
    expect(parsed.frontmatter.disableModelInvocation).toBe(true);
    expect(parsed.frontmatter.userInvocable).toBe(false);
    expect(parsed.frontmatter.allowedTools).toBe("Read Grep");
  });

  it("reads metadata.copilot-enabled-agents as a comma-separated list", () => {
    const content = [
      "---",
      "name: foo",
      "description: A skill",
      "metadata:",
      '  copilot-enabled-agents: "claude,opencode"',
      "---",
      "body",
    ].join("\n");
    const parsed = parseSkillFile(content, "foo");
    expect(parsed.frontmatter.enabledAgents).toEqual(["claude", "opencode"]);
  });

  it("treats an empty copilot-enabled-agents value as empty", () => {
    const content = [
      "---",
      "name: foo",
      "description: A skill",
      "metadata:",
      '  copilot-enabled-agents: ""',
      "---",
      "",
    ].join("\n");
    const parsed = parseSkillFile(content, "foo");
    expect(parsed.frontmatter.enabledAgents).toEqual([]);
  });
});

describe("parseSkillFile — validation errors", () => {
  it("rejects uppercase names", () => {
    expect(() => parseSkillFile(minimalSkill({ name: "ReviewProse" }), "ReviewProse")).toThrow(
      /same lowercase, hyphenated name/
    );
  });

  it("rejects leading hyphen", () => {
    expect(() => parseSkillFile(minimalSkill({ name: "-foo" }), "-foo")).toThrow(
      /same lowercase, hyphenated name/
    );
  });

  it("rejects trailing hyphen", () => {
    expect(() => parseSkillFile(minimalSkill({ name: "foo-" }), "foo-")).toThrow(
      /same lowercase, hyphenated name/
    );
  });

  it("rejects consecutive hyphens", () => {
    expect(() => parseSkillFile(minimalSkill({ name: "foo--bar" }), "foo--bar")).toThrow(
      /same lowercase, hyphenated name/
    );
  });

  it("rejects parent-dir mismatch", () => {
    expect(() => parseSkillFile(minimalSkill({ name: "foo" }), "bar")).toThrow(
      /same lowercase, hyphenated name/
    );
  });

  it("rejects names longer than 64 characters", () => {
    const longName = "a".repeat(65);
    expect(() => parseSkillFile(minimalSkill({ name: longName }), longName)).toThrow(/64/);
  });

  it("rejects descriptions longer than 1024 characters", () => {
    const longDesc = "x".repeat(1025);
    expect(() => parseSkillFile(minimalSkill({ description: longDesc }), "review-prose")).toThrow(
      /1024/
    );
  });

  it("rejects an empty description", () => {
    // build by hand to avoid YAML interpreting the empty value as null
    const content = ["---", "name: foo", 'description: ""', "---", ""].join("\n");
    expect(() => parseSkillFile(content, "foo")).toThrow(/non-empty/);
  });

  it("rejects a missing frontmatter block", () => {
    expect(() => parseSkillFile("no frontmatter here", "foo")).toThrow(/frontmatter/);
  });

  it("rejects missing name", () => {
    const content = ["---", "description: A skill", "---", ""].join("\n");
    expect(() => parseSkillFile(content, "foo")).toThrow(/missing required field `name`/);
  });

  it("explains how to quote a description containing colon-space for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
    const content = [
      "---",
      "name: review-prose",
      "description: Use this skill for: reviewing notes",
      "---",
      "body",
    ].join("\n");

    expect.assertions(3);
    try {
      parseSkillFile(content, "review-prose");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillFormatError);
      expect((error as SkillFormatError).message).toBe(
        'The description contains ": " and must be quoted.'
      );
      expect((error as SkillFormatError).offendingText).toBe(
        "description: Use this skill for: reviewing notes"
      );
    }
  });

  it("keeps unrelated YAML parse failures generic", () => {
    const content = ["---", "name: review-prose", "description: [unfinished", "---"].join("\n");
    expect(() => parseSkillFile(content, "review-prose")).toThrow(/frontmatter YAML is invalid/);
  });

  it("keeps a parser failure on another field generic for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
    const content = [
      "---",
      "name: review-prose",
      "metadata: Use this for: reviews",
      "description: Use this skill for: reviewing notes",
      "---",
      "body",
    ].join("\n");

    expect.assertions(3);
    try {
      parseSkillFile(content, "review-prose");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillFormatError);
      expect((error as SkillFormatError).message).toMatch(/frontmatter YAML is invalid/);
      expect((error as SkillFormatError).offendingText).toBe("metadata: Use this for: reviews");
    }
  });

  it("accepts a Chinese description that uses full-width punctuation", () => {
    const content = [
      "---",
      "name: review-prose",
      "description: 用于审阅笔记：检查清晰度和结构",
      "---",
      "body",
    ].join("\n");
    expect(parseSkillFile(content, "review-prose").frontmatter.description).toBe(
      "用于审阅笔记：检查清晰度和结构"
    );
  });

  it("reports the offending name line with YAML key spacing for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
    const content = ["---", "name : Release Notes", "description: A skill", "---"].join("\n");

    expect.assertions(3);
    try {
      parseSkillFile(content, "Release Notes");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillFormatError);
      expect((error as SkillFormatError).message).toBe(
        "Use the same lowercase, hyphenated name in the file and folder."
      );
      expect((error as SkillFormatError).offendingText).toBe("name : Release Notes");
    }
  });

  it("reports the offending name line with a quoted YAML key for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
    const content = ["---", '"name": Release Notes', "description: A skill", "---"].join("\n");

    expect.assertions(3);
    try {
      parseSkillFile(content, "Release Notes");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillFormatError);
      expect((error as SkillFormatError).message).toBe(
        "Use the same lowercase, hyphenated name in the file and folder."
      );
      expect((error as SkillFormatError).offendingText).toBe('"name": Release Notes');
    }
  });

  it("distinguishes a non-string name from a missing field for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
    const content = ["---", "name: 42", "description: A skill", "---"].join("\n");

    expect.assertions(3);
    try {
      parseSkillFile(content, "42");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillFormatError);
      expect((error as SkillFormatError).message).toBe("Skill `name` must be a string");
      expect((error as SkillFormatError).offendingText).toBe("name: 42");
    }
  });

  it("distinguishes a non-string description from a missing field for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", () => {
    const content = ["---", "name: review-prose", "description: []", "---"].join("\n");

    expect.assertions(3);
    try {
      parseSkillFile(content, "review-prose");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillFormatError);
      expect((error as SkillFormatError).message).toBe("Skill `description` must be a string");
      expect((error as SkillFormatError).offendingText).toBe("description: []");
    }
  });
});

describe("serializeSkillFile — round-trip preservation", () => {
  it("preserves unknown top-level keys byte-equal", () => {
    const content = [
      "---",
      "name: foo",
      "description: A skill",
      "custom-top-level: keep me",
      "another-foreign: 42",
      "---",
      "body",
    ].join("\n");
    const parsed = parseSkillFile(content, "foo");
    const out = serializeSkillFile(parsed);
    expect(out).toContain("custom-top-level: keep me");
    expect(out).toContain("another-foreign: 42");
  });

  it("preserves unknown metadata.* keys byte-equal", () => {
    const content = [
      "---",
      "name: foo",
      "description: A skill",
      "metadata:",
      "  author: alice",
      "  version: 2",
      '  copilot-enabled-agents: "claude"',
      "---",
      "body",
    ].join("\n");
    const parsed = parseSkillFile(content, "foo");
    const out = serializeSkillFile(parsed);
    expect(out).toContain("author: alice");
    expect(out).toContain("version: 2");
    expect(out).toContain('copilot-enabled-agents: "claude"');
  });

  it("updates enabledAgents while preserving foreign metadata keys", () => {
    const content = [
      "---",
      "name: foo",
      "description: A skill",
      "metadata:",
      "  author: alice",
      '  copilot-enabled-agents: "claude"',
      "---",
      "body",
    ].join("\n");
    const parsed = parseSkillFile(content, "foo");
    const out = serializeSkillFile(parsed, { enabledAgents: ["claude", "opencode"] });
    expect(out).toContain("author: alice");
    expect(out).toContain("copilot-enabled-agents:");
    expect(out).toContain("claude,opencode");
  });

  it("round-trips with no changes produces identical frontmatter shape", () => {
    const parsed = parseSkillFile(minimalSkill(), "review-prose");
    const out = serializeSkillFile(parsed);
    const reparsed = parseSkillFile(out, "review-prose");
    expect(reparsed.frontmatter.name).toBe("review-prose");
    expect(reparsed.frontmatter.description).toBe(
      "Critique writing for clarity, voice, and rhythm."
    );
    expect(reparsed.body).toBe("body text");
  });
});

describe("validateName + validateDescription unit-level", () => {
  it("validateName accepts valid spec names", () => {
    expect(() => validateName("review-prose", "review-prose")).not.toThrow();
    expect(() => validateName("a", "a")).not.toThrow();
    expect(() => validateName("a-b-c", "a-b-c")).not.toThrow();
  });

  it("validateDescription accepts a normal description", () => {
    expect(() => validateDescription("A short description.")).not.toThrow();
  });

  it("validateDescription rejects empty", () => {
    expect(() => validateDescription("")).toThrow(SkillFormatError);
  });
});
