import {
  copilotToolNameLabel,
  toolUseLabel,
  directCopilotToolUse,
  toolInputRecord,
} from "@/agentMode/session/copilotToolCalls";

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
  describe("copilotToolNameLabel()", () => {
    it("names a connector tool by its service without repeating the service prefix (https://github.com/Brevilabs/obsidian-copilot-private/issues/875)", () => {
      expect(copilotToolNameLabel("notion_notion-create-pages")).toBe("Notion · Create pages");
    });

    it("names a built-in tool by its owning server and readable tool name (https://github.com/Brevilabs/obsidian-copilot-private/issues/875)", () => {
      expect(copilotToolNameLabel("send_feedback")).toBe("obsidian-copilot · Send feedback");
    });
  });

  describe("toolUseLabel()", () => {
    it("uses an adapter's normalized display label independently of its canonical feature calls (https://github.com/Brevilabs/obsidian-copilot-private/issues/875)", () => {
      expect(toolUseLabel({ label: "External service · Read", calls: [], wrapper: "Run" })).toBe(
        "Run · External service · Read"
      );
    });

    it("reads older saved canonical calls in first-call order with duplicate names shown once (https://github.com/Brevilabs/obsidian-copilot-private/issues/875)", () => {
      expect(
        toolUseLabel({
          wrapper: "Execute",
          calls: [
            { name: "notion_search", args: {} },
            { name: "send_feedback", code: "legacy call" },
            { name: "notion_search", args: { query: "Orion" } },
          ],
        })
      ).toBe("Execute · Notion · Search, obsidian-copilot · Send feedback");
    });

    it("shows an unwrapped canonical tool label for a direct call (https://github.com/Brevilabs/obsidian-copilot-private/issues/875)", () => {
      expect(toolUseLabel({ calls: [{ name: "notion_search", args: {} }] })).toBe(
        "Notion · Search"
      );
    });

    it("returns no label before metadata arrives or when no tool ran (https://github.com/Brevilabs/obsidian-copilot-private/issues/875)", () => {
      expect(toolUseLabel(undefined)).toBeNull();
      expect(toolUseLabel({ calls: [] })).toBeNull();
    });
  });
});
