import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { codeStringField, copilotToolCall } from "@/agentMode/ui/copilotToolCall";

function tool(overrides: Partial<ToolCallPart>): ToolCallPart {
  return { kind: "tool_call", id: "x", title: "tool", status: "completed", ...overrides };
}

const WRITE_THEN_RENDER = tool({
  copilotTools: {
    calls: [
      { name: "excalidraw_write", code: 'tools["obsidian-copilot"].excalidraw_write({});' },
      { name: "excalidraw_render", code: 'tools["obsidian-copilot"].excalidraw_render({});' },
    ],
  },
});

describe("copilotToolCall", () => {
  describe("copilotToolCall()", () => {
    it("returns the call to the named tool with its arguments", () => {
      const part = tool({
        copilotTools: {
          calls: [{ name: "excalidraw_write", args: { path: "a.excalidraw.md" } }],
        },
      });
      expect(copilotToolCall(part, "excalidraw_write")).toEqual({
        name: "excalidraw_write",
        args: { path: "a.excalidraw.md" },
      });
    });

    it("finds the named tool among the calls of code that calls several tools", () => {
      expect(copilotToolCall(WRITE_THEN_RENDER, "excalidraw_render")).toEqual({
        name: "excalidraw_render",
        code: 'tools["obsidian-copilot"].excalidraw_render({});',
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 does not treat another server's identically named tool as a Copilot feature", () => {
      const part = tool({
        copilotTools: { calls: [{ name: "excalidraw_write", server: "other", args: {} }] },
      });
      expect(copilotToolCall(part, "excalidraw_write")).toBeNull();
    });

    it.each([
      [
        "a call to another Copilot tool",
        tool({
          copilotTools: {
            calls: [{ name: "excalidraw_render", args: {} }],
          },
        }),
      ],
      [
        "a call to no Copilot tool",
        tool({ mcpServer: "other", vendorToolName: "excalidraw_write" }),
      ],
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
