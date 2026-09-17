import {
  AGENT_MEMORY_HEADINGS,
  buildAgentMemorySkeleton,
  isValidAgentIcon,
  parseAgentFile,
  serializeAgentFile,
} from "@/agents/agentFile";
import type { CustomAgent } from "@/agents/types";

const JENNIFER: CustomAgent = {
  slug: "jennifer",
  name: "Jennifer",
  description: "Skeptical editor. Cuts fluff, argues for the reader.",
  icon: "🪶",
  backendId: "claude",
  modelId: null,
  memoryEnabled: true,
  created: "2026-09-16T10:00:00Z",
  instructions: "You are Jennifer, a developmental editor.\n",
};

describe("agentFile", () => {
  describe("buildAgentMemorySkeleton()", () => {
    it("titles the file after the agent and lays out the four fixed headings", () => {
      const skeleton = buildAgentMemorySkeleton("Jennifer");
      expect(skeleton).toBe(
        [
          "# Jennifer's memory",
          "",
          "## About the user",
          "",
          "## Preferences and standing requests",
          "",
          "## Ongoing threads",
          "",
          "## Facts and decisions",
          "",
        ].join("\n")
      );
    });

    it("uses every heading the memory contract names, in order", () => {
      const skeleton = buildAgentMemorySkeleton("Vancat");
      expect(AGENT_MEMORY_HEADINGS.map((heading) => skeleton.indexOf(`## ${heading}`))).toEqual([
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      ]);
      expect(skeleton).not.toContain("## undefined");
    });

    it("titles the file 'Agent' when the name is blank", () => {
      expect(buildAgentMemorySkeleton("   ")).toContain("# Agent's memory");
    });
  });

  describe("isValidAgentIcon()", () => {
    it("accepts a single letter", () => {
      expect(isValidAgentIcon("J")).toBe(true);
    });

    it("accepts a single emoji, including multi-code-point ones", () => {
      expect(isValidAgentIcon("🪶")).toBe(true);
      expect(isValidAgentIcon("👩🏽‍🚀")).toBe(true);
      expect(isValidAgentIcon("🇯🇵")).toBe(true);
    });

    it("rejects two characters", () => {
      expect(isValidAgentIcon("JJ")).toBe(false);
      expect(isValidAgentIcon("🪶🪶")).toBe(false);
    });

    it("rejects an empty or whitespace-only value", () => {
      expect(isValidAgentIcon("")).toBe(false);
      expect(isValidAgentIcon("   ")).toBe(false);
    });
  });

  describe("parseAgentFile()", () => {
    it("reads every frontmatter key and keeps the body as the instructions", () => {
      const agent = parseAgentFile(
        "jennifer",
        [
          "---",
          "copilot-agent-name: Jennifer",
          "copilot-agent-description: Skeptical editor.",
          "copilot-agent-icon: 🪶",
          "copilot-agent-backend: claude",
          "copilot-agent-model: sonnet",
          "copilot-agent-memory: true",
          "copilot-agent-created: 2026-09-16T10:00:00Z",
          "---",
          "",
          "You are Jennifer.",
          "",
        ].join("\n")
      );
      expect(agent).toEqual({
        slug: "jennifer",
        name: "Jennifer",
        description: "Skeptical editor.",
        icon: "🪶",
        backendId: "claude",
        modelId: "sonnet",
        memoryEnabled: true,
        created: "2026-09-16T10:00:00Z",
        instructions: "You are Jennifer.\n",
      });
    });

    it("falls back to the folder name and empty optionals when keys are missing", () => {
      const agent = parseAgentFile("vancat", "---\ncopilot-agent-icon: V\n---\nBe blunt.");
      expect(agent).toMatchObject({
        slug: "vancat",
        name: "vancat",
        description: "",
        icon: "V",
        backendId: null,
        modelId: null,
        created: "",
        instructions: "Be blunt.",
      });
    });

    it("treats an omitted memory key as memory on, so a hand edit cannot silently disable it", () => {
      expect(parseAgentFile("vancat", "---\ncopilot-agent-name: Vancat\n---\n").memoryEnabled).toBe(
        true
      );
    });

    it("turns memory off only when the key says false", () => {
      expect(
        parseAgentFile("vancat", "---\ncopilot-agent-memory: false\n---\n").memoryEnabled
      ).toBe(false);
    });

    it("treats a file with no frontmatter as pure instructions", () => {
      const agent = parseAgentFile("vancat", "Just a body.");
      expect(agent.name).toBe("vancat");
      expect(agent.instructions).toBe("Just a body.");
    });

    it("keeps the body when the frontmatter YAML is malformed mid-edit", () => {
      const agent = parseAgentFile("vancat", "---\n: : :\n  - broken\n---\nStill here.");
      expect(agent.name).toBe("vancat");
      expect(agent.instructions).toBe("Still here.");
    });

    it("ignores a non-scalar value where a line of text belongs", () => {
      const agent = parseAgentFile(
        "vancat",
        "---\ncopilot-agent-description:\n  - a\n  - b\n---\nBody."
      );
      expect(agent.description).toBe("");
    });

    it("strips a leading byte-order mark so a BOM'd file still parses", () => {
      const agent = parseAgentFile("vancat", "﻿---\ncopilot-agent-name: Vancat\n---\nBody.");
      expect(agent.name).toBe("Vancat");
    });
  });

  describe("serializeAgentFile()", () => {
    it("writes every key and the instructions body", () => {
      const written = serializeAgentFile(JENNIFER);
      expect(written).toContain("copilot-agent-name: Jennifer");
      expect(written).toContain("copilot-agent-icon: 🪶");
      expect(written).toContain("copilot-agent-backend: claude");
      expect(written).toContain("copilot-agent-memory: true");
      expect(written).toContain("copilot-agent-created: 2026-09-16T10:00:00Z");
      expect(written.endsWith("You are Jennifer, a developmental editor.\n")).toBe(true);
    });

    it("emits unset pins as empty keys so the record is visible to hand edits", () => {
      const written = serializeAgentFile({ ...JENNIFER, backendId: null, modelId: null });
      expect(written).toContain('copilot-agent-backend: ""');
      expect(written).toContain('copilot-agent-model: ""');
    });

    it("round-trips an agent unchanged through parse", () => {
      expect(parseAgentFile("jennifer", serializeAgentFile(JENNIFER))).toEqual(JENNIFER);
    });

    it("quotes a description containing YAML punctuation so it round-trips intact", () => {
      const tricky = { ...JENNIFER, description: 'Edits: hard. Says "no" often.' };
      expect(parseAgentFile("jennifer", serializeAgentFile(tricky)).description).toBe(
        tricky.description
      );
    });
  });
});
