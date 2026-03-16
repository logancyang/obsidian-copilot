import { summarizeToolCall, summarizeToolResult } from "./AgentReasoningState";

describe("AgentReasoningState tool summaries", () => {
  test("summarizeToolCall has daily/random CLI specific wording", () => {
    expect(summarizeToolCall("obsidianDailyNote", { command: "daily:read" })).toBe(
      "Reading today's daily note"
    );
    expect(summarizeToolCall("obsidianDailyNote", { command: "daily:read", vault: "Work" })).toBe(
      `Reading today's daily note from "Work"`
    );
    expect(summarizeToolCall("obsidianDailyNote", { command: "daily:path" })).toBe(
      "Getting daily note path"
    );

    expect(summarizeToolCall("obsidianRandomRead")).toBe("Reading a random note");
    expect(summarizeToolCall("obsidianRandomRead", { vault: "Personal" })).toBe(
      `Reading a random note from "Personal"`
    );
  });

  test("summarizeToolResult has daily/random CLI specific wording", () => {
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

  test("summarizeToolCall has properties/tasks/links CLI specific wording", () => {
    expect(summarizeToolCall("obsidianProperties", { command: "properties" })).toBe(
      "Listing vault properties"
    );
    expect(
      summarizeToolCall("obsidianProperties", { command: "property:read", name: "tags" })
    ).toBe(`Reading property "tags"`);
    expect(summarizeToolCall("obsidianTasks", { command: "tasks" })).toBe("Listing vault tasks");
    expect(summarizeToolCall("obsidianLinks", { command: "backlinks" })).toBe("Listing backlinks");
    expect(summarizeToolCall("obsidianLinks", { command: "orphans" })).toBe(
      "Listing orphaned notes"
    );
    expect(summarizeToolCall("obsidianLinks", { command: "unresolved" })).toBe(
      "Listing unresolved links"
    );
  });

  test("summarizeToolResult has properties/tasks/links CLI specific wording", () => {
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
      summarizeToolResult("obsidianLinks", { success: true }, undefined, { command: "backlinks" })
    ).toBe("Listed backlinks");
    expect(
      summarizeToolResult("obsidianLinks", { success: true }, undefined, { command: "orphans" })
    ).toBe("Listed orphaned notes");
  });
});
