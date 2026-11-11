import { readAntigravityCopilotTools } from "./antigravityCopilotToolCalls";

describe("antigravityCopilotToolCalls", () => {
  describe("readAntigravityCopilotTools()", () => {
    it("reads the Copilot tool named in the agent's title and its arguments", () => {
      expect(
        readAntigravityCopilotTools(
          { query: "Orion", toolSummary: "Search notes" },
          "Run mcp_obsidian-copilot_miyo_search"
        )
      ).toEqual({ calls: [{ name: "miyo_search", args: { query: "Orion" } }] });
    });

    it("drops the agent's own toolSummary so only the tool's real arguments are shown", () => {
      const use = readAntigravityCopilotTools(
        { toolSummary: "Send feedback" },
        "Run mcp_obsidian-copilot_send_feedback"
      );

      expect(use).toEqual({ calls: [{ name: "send_feedback", args: {} }] });
    });

    it.each([
      undefined,
      "File alpha.md",
      "Run ask_question",
      "Run mcp_other-server_search",
      "Run mcp_obsidian-copilot_",
    ])("ignores a call that is not a Copilot MCP tool: %s", (title) => {
      expect(readAntigravityCopilotTools({ query: "x" }, title)).toBeNull();
    });
  });
});
