import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import {
  codeStringField,
  copilotToolCall,
  copilotToolName,
  NO_COPILOT_TOOL_CALLS,
  type CopilotToolCallReader,
} from "@/agentMode/ui/copilotToolCall";

function tool(overrides: Partial<ToolCallPart>): ToolCallPart {
  return { kind: "tool_call", id: "x", title: "tool", status: "completed", ...overrides };
}

const READER: CopilotToolCallReader = {
  call: (part, toolName) =>
    part.title === "wrapper" && toolName === "excalidraw_read" ? { code: "wrapped" } : null,
  toolName: (part) => (part.title === "wrapper" ? "notion_search" : null),
};

describe("copilotToolCall", () => {
  describe("copilotToolCall()", () => {
    it("returns the arguments of a call the adapter tagged as the named tool on Copilot's server", () => {
      const part = tool({
        mcpServer: "obsidian-copilot",
        vendorToolName: "excalidraw_write",
        input: { path: "a.excalidraw.md" },
      });
      expect(copilotToolCall(part, "excalidraw_write", READER)).toEqual({
        args: { path: "a.excalidraw.md" },
      });
    });

    it("reads a call the adapter did not tag through the backend's reader", () => {
      expect(copilotToolCall(tool({ title: "wrapper" }), "excalidraw_read", READER)).toEqual({
        code: "wrapped",
      });
    });

    it.each([
      [
        "the same tool name on another server",
        tool({ mcpServer: "other", vendorToolName: "excalidraw_write", input: {} }),
      ],
      [
        "another tool tagged on Copilot's server",
        tool({ mcpServer: "obsidian-copilot", vendorToolName: "excalidraw_render", input: {} }),
      ],
      ["an untagged call the backend's reader does not recognize", tool({ input: undefined })],
    ])("returns null for %s", (_name, part) => {
      expect(copilotToolCall(part, "excalidraw_write", READER)).toBeNull();
    });
  });

  describe("copilotToolName()", () => {
    it("returns the tool name of a call the adapter tagged on Copilot's server", () => {
      const part = tool({ mcpServer: "obsidian-copilot", vendorToolName: "notion_search" });
      expect(copilotToolName(part, NO_COPILOT_TOOL_CALLS)).toBe("notion_search");
    });

    it("names an untagged call through the backend's reader", () => {
      expect(copilotToolName(tool({ title: "wrapper" }), READER)).toBe("notion_search");
    });

    it.each([
      ["a call on another server", tool({ mcpServer: "other", vendorToolName: "notion_search" })],
      ["a native tool", tool({ vendorToolName: "Read" })],
    ])("returns null for %s", (_name, part) => {
      expect(copilotToolName(part, READER)).toBeNull();
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
