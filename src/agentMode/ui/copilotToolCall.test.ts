import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { codeStringField, copilotToolCall } from "@/agentMode/ui/copilotToolCall";

function tool(overrides: Partial<ToolCallPart>): ToolCallPart {
  return { kind: "tool_call", id: "x", title: "tool", status: "completed", ...overrides };
}

describe("copilotToolCall", () => {
  describe("copilotToolCall()", () => {
    it("returns the arguments of a Claude call to the named tool on Copilot's server", () => {
      const part = tool({
        mcpServer: "obsidian-copilot",
        vendorToolName: "excalidraw_write",
        input: { path: "a.excalidraw.md" },
      });
      expect(copilotToolCall(part, "excalidraw_write")).toEqual({
        args: { path: "a.excalidraw.md" },
      });
    });

    it("returns the nested arguments of a Codex call to the named tool on Copilot's server", () => {
      const part = tool({
        input: {
          server: "obsidian-copilot",
          tool: "excalidraw_write",
          arguments: { path: "a.excalidraw.md" },
        },
      });
      expect(copilotToolCall(part, "excalidraw_write")).toEqual({
        args: { path: "a.excalidraw.md" },
      });
    });

    it("returns empty arguments for a Codex call that sent none", () => {
      const part = tool({ input: { server: "obsidian-copilot", tool: "excalidraw_read" } });
      expect(copilotToolCall(part, "excalidraw_read")).toEqual({ args: {} });
    });

    it("returns the OpenCode code from the named tool's call onward", () => {
      const part = tool({
        input: {
          code: 'const a = 1;\nreturn tools["obsidian-copilot"].excalidraw_read({ path: "a.md" });',
        },
      });
      expect(copilotToolCall(part, "excalidraw_read")).toEqual({
        code: 'tools["obsidian-copilot"].excalidraw_read({ path: "a.md" });',
      });
    });

    it.each([
      [
        "the same tool name on another server",
        tool({ mcpServer: "other", vendorToolName: "excalidraw_write", input: {} }),
      ],
      [
        "another Copilot tool",
        tool({ mcpServer: "obsidian-copilot", vendorToolName: "excalidraw_render", input: {} }),
      ],
      [
        "a Codex call to another tool",
        tool({ input: { server: "obsidian-copilot", tool: "excalidraw_render", arguments: {} } }),
      ],
      [
        "OpenCode code that only mentions the tool",
        tool({ input: { code: "// excalidraw_write" } }),
      ],
      ["a call without input", tool({ input: undefined })],
    ])("returns null for %s", (_name, part) => {
      expect(copilotToolCall(part, "excalidraw_write")).toBeNull();
    });
  });

  describe("codeStringField()", () => {
    it("reads a double-quoted field, with or without quotes around its name", () => {
      expect(codeStringField('f({ path: "Drawings/a.md" })', "path")).toBe("Drawings/a.md");
      expect(codeStringField('f({ "path": "say \\"hi\\"" })', "path")).toBe('say "hi"');
    });

    it("reads a single-quoted field with escaped quotes (https://github.com/Brevilabs/obsidian-copilot-private/issues/735)", () => {
      expect(codeStringField(`f({ query: 'Sam\\'s "standing" desk' })`, "query")).toBe(
        'Sam\'s "standing" desk'
      );
    });

    it.each([
      ["a field that is a variable", "f({ path: p })"],
      ["a missing field", 'f({ other: "x" })'],
      ["an empty string", 'f({ path: "" })'],
    ])("returns null for %s", (_name, code) => {
      expect(codeStringField(code, "path")).toBeNull();
    });
  });
});
