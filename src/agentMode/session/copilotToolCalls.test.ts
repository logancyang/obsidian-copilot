import { directCopilotToolUse, toolInputRecord } from "@/agentMode/session/copilotToolCalls";

describe("copilotToolCalls", () => {
  describe("toolInputRecord()", () => {
    it("returns an object input as its fields and anything else as no fields", () => {
      expect(toolInputRecord({ query: "Orion" })).toEqual({ query: "Orion" });
      expect(toolInputRecord("query")).toEqual({});
      expect(toolInputRecord(undefined)).toEqual({});
    });
  });

  describe("directCopilotToolUse()", () => {
    it("says a call on Copilot's server runs its tool with its input as arguments", () => {
      expect(directCopilotToolUse("obsidian-copilot", "notion_search", { query: "Orion" })).toEqual(
        { calls: [{ name: "notion_search", args: { query: "Orion" } }] }
      );
    });

    it.each([
      ["a call on another server", "notion", "notion_search"],
      ["a call without a tool name", "obsidian-copilot", undefined],
      ["a native tool", undefined, "Read"],
    ])("returns undefined for %s", (_name, server, tool) => {
      expect(directCopilotToolUse(server, tool, {})).toBeUndefined();
    });
  });
});
