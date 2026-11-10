import { readCodexCopilotTools } from "@/agentMode/backends/codex/codexCopilotToolCalls";

describe("codexCopilotToolCalls", () => {
  describe("readCodexCopilotTools()", () => {
    it("reads a call on Copilot's server as running its tool with the nested arguments", () => {
      expect(
        readCodexCopilotTools({
          server: "obsidian-copilot",
          tool: "excalidraw_write",
          arguments: { path: "a.excalidraw.md" },
        })
      ).toEqual({
        calls: [{ name: "excalidraw_write", args: { path: "a.excalidraw.md" } }],
      });
    });

    it("reads empty arguments for a call that sent none", () => {
      expect(
        readCodexCopilotTools({ server: "obsidian-copilot", tool: "excalidraw_read" })
      ).toEqual({ calls: [{ name: "excalidraw_read", args: {} }] });
    });

    it.each([
      ["a call on another server", { server: "other", tool: "notion_search", arguments: {} }],
      ["a call without a tool name", { server: "obsidian-copilot" }],
      ["a call without input", undefined],
    ])("returns null for %s", (_name, input) => {
      expect(readCodexCopilotTools(input)).toBeNull();
    });
  });
});
