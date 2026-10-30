import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import {
  excalidrawToolRun,
  opensDrawingCard,
  summarizeDrawing,
} from "@/excalidraw/agentMode/excalidrawToolRun";
import { excalidrawToolCall } from "@/excalidraw/agentMode/testing/excalidrawToolCall";
import { EXCALIDRAW_TURNED_OFF_TEXT } from "@/excalidraw/excalidrawTools";

const PATH = "Incidents/Investigation playbook.excalidraw.md";
const CREATE = { path: PATH, elements: [{ id: "a", type: "rectangle" }] };
const EDIT = { path: PATH, operations: [{ op: "delete", ids: ["a"] }] };

function codexCall(tool: string, args: Record<string, unknown>): ToolCallPart {
  return {
    kind: "tool_call",
    id: "codex",
    title: `mcp.obsidian-copilot.${tool}`,
    status: "completed",
    toolKind: "execute",
    input: { server: "obsidian-copilot", tool, arguments: args },
  };
}

function opencodeCall(code: string): ToolCallPart {
  return {
    kind: "tool_call",
    id: "opencode",
    title: "execute",
    status: "completed",
    toolKind: "other",
    input: { code },
  };
}

describe("excalidrawToolRun", () => {
  describe("excalidrawToolRun()", () => {
    it.each([
      ["Claude", excalidrawToolCall("excalidraw_write", CREATE)],
      ["Codex", codexCall("excalidraw_write", CREATE)],
      [
        "OpenCode",
        opencodeCall(
          `return tools["obsidian-copilot"].excalidraw_write({ path: "${PATH}", elements: [] });`
        ),
      ],
    ])("reads a %s write with elements as a new drawing at its path", (_name, part) => {
      expect(excalidrawToolRun(part)).toEqual({
        action: "create",
        status: "completed",
        path: PATH,
      });
    });

    it.each([
      ["Claude", excalidrawToolCall("excalidraw_write", EDIT)],
      ["Codex", codexCall("excalidraw_write", EDIT)],
      [
        "OpenCode",
        opencodeCall(
          `return tools["obsidian-copilot"].excalidraw_write({ path: '${PATH}', operations: [] });`
        ),
      ],
    ])("reads a %s write with operations as an edit", (_name, part) => {
      expect(excalidrawToolRun(part)).toEqual({ action: "edit", status: "completed", path: PATH });
    });

    it("reads an OpenCode write that passes its operations by shorthand as an edit", () => {
      const part = opencodeCall(
        `const operations = [];\nreturn tools["obsidian-copilot"].excalidraw_write({ path: "${PATH}", operations });`
      );
      expect(excalidrawToolRun(part)?.action).toBe("edit");
    });

    it("reads an OpenCode write whose path and labels mention operations as a new drawing", () => {
      const part = opencodeCall(
        `return tools["obsidian-copilot"].excalidraw_write({ path: "operations.excalidraw.md", elements: [{ type: "text", text: "operations: []" }] });`
      );
      expect(excalidrawToolRun(part)?.action).toBe("create");
    });

    it.each([
      ["Claude", excalidrawToolCall("excalidraw_read", { path: PATH })],
      ["Codex", codexCall("excalidraw_read", { path: PATH })],
      [
        "OpenCode",
        opencodeCall(`return tools["obsidian-copilot"].excalidraw_read({ path: "${PATH}" });`),
      ],
    ])("reads a %s excalidraw_read call as a read of its drawing", (_name, part) => {
      expect(excalidrawToolRun(part)).toEqual({ action: "read", status: "completed", path: PATH });
    });

    it("keeps a running write's status so the card can show it in progress", () => {
      const part = excalidrawToolCall("excalidraw_write", CREATE, { status: "in_progress" });
      expect(excalidrawToolRun(part)?.status).toBe("in_progress");
    });

    it.each([
      ["a call without a path", excalidrawToolCall("excalidraw_write", { elements: [] })],
      [
        "OpenCode code whose path is a variable",
        opencodeCall('return tools["obsidian-copilot"].excalidraw_read({ path: p });'),
      ],
    ])("reports no path for %s", (_name, part) => {
      expect(excalidrawToolRun(part)?.path).toBeNull();
    });

    it("reads the agent's render check as a render of its drawing", () => {
      expect(excalidrawToolRun(excalidrawToolCall("excalidraw_render", { path: PATH }))).toEqual({
        action: "render",
        status: "completed",
        path: PATH,
      });
    });

    it("keeps a failed write's status so its card can count the failure", () => {
      const part = excalidrawToolCall("excalidraw_write", CREATE, { status: "failed" });
      expect(excalidrawToolRun(part)?.status).toBe("failed");
    });

    it("returns null for a write answered with the Excalidraw-turned-off text so its explanation stays visible (https://github.com/Brevilabs/obsidian-copilot-private/issues/787)", () => {
      const part = excalidrawToolCall("excalidraw_write", CREATE, {
        output: [{ type: "text", text: EXCALIDRAW_TURNED_OFF_TEXT }],
      });
      expect(excalidrawToolRun(part)).toBeNull();
    });

    it("returns null for a write on another server", () => {
      const part = excalidrawToolCall("excalidraw_write", CREATE, { mcpServer: "other" });
      expect(excalidrawToolRun(part)).toBeNull();
    });
  });

  describe("opensDrawingCard()", () => {
    it.each([
      ["a finished write", { action: "create", status: "completed" }],
      ["a running edit", { action: "edit", status: "in_progress" }],
      ["a read", { action: "read", status: "completed" }],
    ] as const)("opens a card for %s", (_name, run) => {
      expect(opensDrawingCard({ ...run, path: PATH })).toBe(true);
    });

    it.each([
      ["a failed write, which changed nothing", { action: "edit", status: "failed" }],
      ["a render check, which only looks", { action: "render", status: "completed" }],
    ] as const)(
      "does not open a card for %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/787)",
      (_name, run) => {
        expect(opensDrawingCard({ ...run, path: PATH })).toBe(false);
      }
    );
  });

  describe("summarizeDrawing()", () => {
    const write = (status: ToolCallPart["status"], input: Record<string, unknown> = EDIT) =>
      excalidrawToolCall("excalidraw_write", input, { status });

    it("names the strongest change that went through, counting failed writes separately", () => {
      expect(
        summarizeDrawing([
          write("failed", CREATE),
          write("completed", CREATE),
          excalidrawToolCall("excalidraw_render", { path: PATH }),
          write("failed"),
          write("completed"),
        ])
      ).toEqual({ action: "create", status: "completed", path: PATH, failed: 2 });
    });

    it("shows the drawing in progress while any of its calls runs, including a render check", () => {
      expect(
        summarizeDrawing([
          write("completed"),
          excalidrawToolCall("excalidraw_render", { path: PATH }, { status: "in_progress" }),
        ]).status
      ).toBe("in_progress");
    });

    it("reports a read-only stretch as a read", () => {
      expect(
        summarizeDrawing([
          excalidrawToolCall("excalidraw_read", { path: PATH }),
          excalidrawToolCall("excalidraw_render", { path: PATH }),
        ])
      ).toEqual({ action: "read", status: "completed", path: PATH, failed: 0 });
    });

    it("reports a drawing as stopped when its only change was cancelled", () => {
      expect(summarizeDrawing([write("cancelled")]).status).toBe("cancelled");
    });
  });
});
