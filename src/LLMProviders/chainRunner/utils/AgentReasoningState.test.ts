import { summarizeToolCall, summarizeToolResult } from "./AgentReasoningState";

describe("AgentReasoningState tool summaries", () => {
  test("summarizeToolCall has daily/random CLI specific wording", () => {
    expect(summarizeToolCall("obsidianDailyRead")).toBe("Reading today's daily note");
    expect(summarizeToolCall("obsidianDailyRead", { vault: "Work" })).toBe(
      `Reading today's daily note from "Work"`
    );

    expect(summarizeToolCall("obsidianRandomRead")).toBe("Reading a random note");
    expect(summarizeToolCall("obsidianRandomRead", { vault: "Personal" })).toBe(
      `Reading a random note from "Personal"`
    );
  });

  test("summarizeToolResult has daily/random CLI specific wording", () => {
    expect(
      summarizeToolResult("obsidianDailyRead", { success: true }, undefined, { vault: "Work" })
    ).toBe(`Loaded today's daily note from "Work"`);
    expect(summarizeToolResult("obsidianDailyRead", { success: true })).toBe(
      "Loaded today's daily note"
    );

    expect(
      summarizeToolResult("obsidianRandomRead", { success: true }, undefined, { vault: "Personal" })
    ).toBe(`Loaded a random note from "Personal"`);
    expect(summarizeToolResult("obsidianRandomRead", { success: true })).toBe(
      "Loaded a random note"
    );
  });

  test("summarizeToolResult failure path reuses CLI call summary", () => {
    expect(
      summarizeToolResult("obsidianRandomRead", { success: false }, undefined, { vault: "VaultA" })
    ).toBe(`Reading a random note from "VaultA" failed`);
  });
});
