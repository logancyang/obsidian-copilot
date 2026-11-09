import { codexCopilotToolCalls } from "@/agentMode/backends/codex/codexCopilotToolCalls";
import type { AgentMessagePart } from "@/agentMode/session/types";

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;

function codexCall(input: unknown): ToolCallPart {
  return {
    kind: "tool_call",
    id: "codex",
    title: "mcp.obsidian-copilot.excalidraw_write",
    status: "completed",
    toolKind: "execute",
    input,
  };
}

describe("codexCopilotToolCalls", () => {
  describe("call()", () => {
    it("returns the nested arguments of a call to the named tool on Copilot's server", () => {
      const part = codexCall({
        server: "obsidian-copilot",
        tool: "excalidraw_write",
        arguments: { path: "a.excalidraw.md" },
      });
      expect(codexCopilotToolCalls.call(part, "excalidraw_write")).toEqual({
        args: { path: "a.excalidraw.md" },
      });
    });

    it("returns empty arguments for a call that sent none", () => {
      const part = codexCall({ server: "obsidian-copilot", tool: "excalidraw_read" });
      expect(codexCopilotToolCalls.call(part, "excalidraw_read")).toEqual({ args: {} });
    });

    it.each([
      [
        "a call to another Copilot tool",
        codexCall({ server: "obsidian-copilot", tool: "excalidraw_render", arguments: {} }),
      ],
      [
        "the same tool on another server",
        codexCall({ server: "other", tool: "excalidraw_write", arguments: {} }),
      ],
      ["a call without input", codexCall(undefined)],
    ])("returns null for %s", (_name, part) => {
      expect(codexCopilotToolCalls.call(part, "excalidraw_write")).toBeNull();
    });
  });

  describe("toolName()", () => {
    it("returns the tool a call on Copilot's server runs", () => {
      const part = codexCall({ server: "obsidian-copilot", tool: "notion_search", arguments: {} });
      expect(codexCopilotToolCalls.toolName(part)).toBe("notion_search");
    });

    it.each([
      ["a call on another server", codexCall({ server: "other", tool: "notion_search" })],
      ["a call without a tool name", codexCall({ server: "obsidian-copilot" })],
      ["a call without input", codexCall(undefined)],
    ])("returns null for %s", (_name, part) => {
      expect(codexCopilotToolCalls.toolName(part)).toBeNull();
    });
  });
});
