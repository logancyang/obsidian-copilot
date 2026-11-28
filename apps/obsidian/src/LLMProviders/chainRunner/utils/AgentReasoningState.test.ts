import {
  createInitialReasoningState,
  extractFirstSentence,
  parseReasoningBlock,
  serializeReasoningBlock,
  summarizeToolCall,
  summarizeToolResult,
} from "./AgentReasoningState";

describe("AgentReasoningState", () => {
  describe("createInitialReasoningState()", () => {
    it("starts idle with no start time, no elapsed seconds and no steps", () => {
      expect(createInitialReasoningState()).toEqual({
        status: "idle",
        startTime: null,
        elapsedSeconds: 0,
        steps: [],
      });
    });
  });

  describe("summarizeToolCall()", () => {
    it("describes the daily note CLI commands, naming the vault when one is given", () => {
      expect(summarizeToolCall("obsidianDailyNote", { command: "daily:read" })).toBe(
        "Reading today's daily note"
      );
      expect(summarizeToolCall("obsidianDailyNote", { command: "daily:read", vault: "Work" })).toBe(
        `Reading today's daily note from "Work"`
      );
      expect(summarizeToolCall("obsidianDailyNote", { command: "daily:path" })).toBe(
        "Getting daily note path"
      );
    });

    it("describes the random note CLI command, naming the vault when one is given", () => {
      expect(summarizeToolCall("obsidianRandomRead")).toBe("Reading a random note");
      expect(summarizeToolCall("obsidianRandomRead", { vault: "Personal" })).toBe(
        `Reading a random note from "Personal"`
      );
    });

    it("describes the properties, tasks and links CLI commands", () => {
      expect(summarizeToolCall("obsidianProperties", { command: "properties" })).toBe(
        "Listing vault properties"
      );
      expect(
        summarizeToolCall("obsidianProperties", { command: "property:read", name: "tags" })
      ).toBe(`Reading property "tags"`);
      expect(summarizeToolCall("obsidianTasks", { command: "tasks" })).toBe("Listing vault tasks");
      expect(summarizeToolCall("obsidianLinks", { command: "backlinks" })).toBe(
        "Listing backlinks"
      );
      expect(summarizeToolCall("obsidianLinks", { command: "orphans" })).toBe(
        "Listing orphaned notes"
      );
      expect(summarizeToolCall("obsidianLinks", { command: "unresolved" })).toBe(
        "Listing unresolved links"
      );
    });
  });

  describe("summarizeToolResult()", () => {
    it("reports the daily note CLI results, naming the vault when one is given", () => {
      expect(
        summarizeToolResult("obsidianDailyNote", { success: true }, undefined, {
          command: "daily:read",
          vault: "Work",
        })
      ).toBe(`Loaded today's daily note from "Work"`);
      expect(
        summarizeToolResult("obsidianDailyNote", { success: true }, undefined, {
          command: "daily:read",
        })
      ).toBe("Loaded today's daily note");
      expect(
        summarizeToolResult("obsidianDailyNote", { success: true }, undefined, {
          command: "daily:path",
          vault: "Work",
        })
      ).toBe(`Got daily note path from "Work"`);
    });

    it("reports the random note CLI result, naming the vault when one is given", () => {
      expect(
        summarizeToolResult("obsidianRandomRead", { success: true }, undefined, {
          vault: "Personal",
        })
      ).toBe(`Loaded a random note from "Personal"`);
      expect(summarizeToolResult("obsidianRandomRead", { success: true })).toBe(
        "Loaded a random note"
      );
    });

    it("reports the properties, tasks and links CLI results", () => {
      expect(
        summarizeToolResult("obsidianProperties", { success: true }, undefined, {
          command: "properties",
        })
      ).toBe("Listed vault properties");
      expect(
        summarizeToolResult("obsidianProperties", { success: true }, undefined, {
          command: "property:read",
          name: "tags",
        })
      ).toBe(`Read property "tags"`);
      expect(
        summarizeToolResult("obsidianTasks", { success: true }, undefined, { command: "tasks" })
      ).toBe("Listed vault tasks");
      expect(
        summarizeToolResult("obsidianLinks", { success: true }, undefined, {
          command: "backlinks",
        })
      ).toBe("Listed backlinks");
      expect(
        summarizeToolResult("obsidianLinks", { success: true }, undefined, { command: "orphans" })
      ).toBe("Listed orphaned notes");
    });

    it("reports a failed call as the call summary followed by failed", () => {
      expect(
        summarizeToolResult("obsidianRandomRead", { success: false }, undefined, {
          vault: "VaultA",
        })
      ).toBe(`Reading a random note from "VaultA" failed`);
    });
  });

  describe("serializeReasoningBlock()", () => {
    it("writes status, elapsed seconds and step summaries into a hidden comment", () => {
      const block = serializeReasoningBlock({
        status: "complete",
        startTime: 1000,
        elapsedSeconds: 7,
        steps: [
          { timestamp: 1, summary: "Searching the vault" },
          { timestamp: 2, summary: "Reading note" },
        ],
      });

      expect(block).toBe(
        '<!--AGENT_REASONING:complete:7:["Searching the vault","Reading note"]-->'
      );
    });

    it("writes nothing while the state is idle", () => {
      expect(serializeReasoningBlock(createInitialReasoningState())).toBe("");
    });
  });

  describe("parseReasoningBlock()", () => {
    it("recovers a serialized block and returns the message text that follows it", () => {
      const block = serializeReasoningBlock({
        status: "collapsed",
        startTime: null,
        elapsedSeconds: 12,
        steps: [{ timestamp: 1, summary: "Searching the vault" }],
      });

      expect(parseReasoningBlock(`${block}\n\nHere is the answer.`)).toEqual({
        hasReasoning: true,
        status: "collapsed",
        elapsedSeconds: 12,
        steps: ["Searching the vault"],
        contentAfter: "Here is the answer.",
      });
    });

    it("returns null when the content carries no reasoning block", () => {
      expect(parseReasoningBlock("Plain answer")).toBeNull();
    });

    it("keeps the block with no steps when its step list is not valid JSON", () => {
      expect(parseReasoningBlock("<!--AGENT_REASONING:complete:3:not-json-->Answer")).toEqual({
        hasReasoning: true,
        status: "complete",
        elapsedSeconds: 3,
        steps: [],
        contentAfter: "Answer",
      });
    });
  });

  describe("extractFirstSentence()", () => {
    it("returns the first non-blank line of the content", () => {
      expect(extractFirstSentence("\n  Let me search your notes.\nThen I will read one.")).toBe(
        "Let me search your notes."
      );
    });

    it("truncates a long first line to 100 characters ending in an ellipsis", () => {
      const result = extractFirstSentence("a".repeat(150));

      expect(result).toBe(`${"a".repeat(97)}...`);
    });

    it("returns null for blank content", () => {
      expect(extractFirstSentence("  \n ")).toBeNull();
    });
  });
});
