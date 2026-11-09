import { codexCopilotToolCalls } from "@/agentMode/backends/codex/codexCopilotToolCalls";
import { opencodeCopilotToolCalls } from "@/agentMode/backends/opencode/opencodeCopilotToolCalls";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { NO_COPILOT_TOOL_CALLS, type CopilotToolCallReader } from "@/agentMode/ui/copilotToolCall";
import { excalidrawToolRun, summarizeDrawing } from "@/excalidraw/agentMode/excalidrawToolRun";
import { excalidrawToolCall } from "@/excalidraw/agentMode/testing/excalidrawToolCall";
import { EXCALIDRAW_TURNED_OFF_TEXT } from "@/excalidraw/excalidrawTools";

const PATH = "Incidents/Investigation playbook.excalidraw.md";
const CREATE = { path: PATH, elements: [{ id: "a", type: "rectangle" }] };
const EDIT = { path: PATH, operations: [{ op: "delete", ids: ["a"] }] };
const READERS: Record<string, CopilotToolCallReader> = {
  Claude: NO_COPILOT_TOOL_CALLS,
  Codex: codexCopilotToolCalls,
  OpenCode: opencodeCopilotToolCalls,
};

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
    ])("reads a %s write with elements as a new drawing at its path", (backend, part) => {
      expect(excalidrawToolRun(part, READERS[backend])).toEqual({
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
    ])("reads a %s write with operations as an edit", (backend, part) => {
      expect(excalidrawToolRun(part, READERS[backend])).toEqual({
        action: "edit",
        status: "completed",
        path: PATH,
      });
    });

    it("reads an OpenCode write that passes its operations by shorthand as an edit", () => {
      const part = opencodeCall(
        `const operations = [];\nreturn tools["obsidian-copilot"].excalidraw_write({ path: "${PATH}", operations });`
      );
      expect(excalidrawToolRun(part, opencodeCopilotToolCalls)?.action).toBe("edit");
    });

    it("reads an OpenCode write whose path and labels mention operations as a new drawing", () => {
      const part = opencodeCall(
        `return tools["obsidian-copilot"].excalidraw_write({ path: "operations.excalidraw.md", elements: [{ type: "text", text: "operations: []" }] });`
      );
      expect(excalidrawToolRun(part, opencodeCopilotToolCalls)?.action).toBe("create");
    });

    it.each([
      ["Claude", excalidrawToolCall("excalidraw_read", { path: PATH })],
      ["Codex", codexCall("excalidraw_read", { path: PATH })],
      [
        "OpenCode",
        opencodeCall(`return tools["obsidian-copilot"].excalidraw_read({ path: "${PATH}" });`),
      ],
    ])("reads a %s excalidraw_read call as a read of its drawing", (backend, part) => {
      expect(excalidrawToolRun(part, READERS[backend])).toEqual({
        action: "read",
        status: "completed",
        path: PATH,
      });
    });

    it("keeps a running write's status so the card can show it in progress", () => {
      const part = excalidrawToolCall("excalidraw_write", CREATE, { status: "in_progress" });
      expect(excalidrawToolRun(part, NO_COPILOT_TOOL_CALLS)?.status).toBe("in_progress");
    });

    it.each([
      [
        "a call without a path",
        excalidrawToolCall("excalidraw_write", { elements: [] }),
        NO_COPILOT_TOOL_CALLS,
      ],
      [
        "OpenCode code whose path is a variable",
        opencodeCall('return tools["obsidian-copilot"].excalidraw_read({ path: p });'),
        opencodeCopilotToolCalls,
      ],
    ])("reports no path for %s", (_name, part, reader) => {
      expect(excalidrawToolRun(part, reader)?.path).toBeNull();
    });

    it("reads the agent's render check as a read of its drawing", () => {
      expect(
        excalidrawToolRun(
          excalidrawToolCall("excalidraw_render", { path: PATH }),
          NO_COPILOT_TOOL_CALLS
        )
      ).toEqual({
        action: "read",
        status: "completed",
        path: PATH,
      });
    });

    it("reads an OpenCode call that writes and then renders as the write, so the drawing still gets its card (https://github.com/Brevilabs/obsidian-copilot-private/issues/787)", () => {
      const part = opencodeCall(
        `await tools["obsidian-copilot"].excalidraw_write({ path: "${PATH}", operations: [] });\nreturn tools["obsidian-copilot"].excalidraw_render({ path: "${PATH}" });`
      );
      expect(excalidrawToolRun(part, opencodeCopilotToolCalls)).toEqual({
        action: "edit",
        status: "completed",
        path: PATH,
      });
    });

    it("keeps a failed write's status so its card can count the failure", () => {
      const part = excalidrawToolCall("excalidraw_write", CREATE, { status: "failed" });
      expect(excalidrawToolRun(part, NO_COPILOT_TOOL_CALLS)?.status).toBe("failed");
    });

    it("returns null for a write answered with the Excalidraw-turned-off text so its explanation stays visible (https://github.com/Brevilabs/obsidian-copilot-private/issues/787)", () => {
      const part = excalidrawToolCall("excalidraw_write", CREATE, {
        output: [{ type: "text", text: EXCALIDRAW_TURNED_OFF_TEXT }],
      });
      expect(excalidrawToolRun(part, NO_COPILOT_TOOL_CALLS)).toBeNull();
    });

    it("returns null for a write on another server", () => {
      const part = excalidrawToolCall("excalidraw_write", CREATE, { mcpServer: "other" });
      expect(excalidrawToolRun(part, NO_COPILOT_TOOL_CALLS)).toBeNull();
    });
  });

  describe("summarizeDrawing()", () => {
    const write = (status: ToolCallPart["status"], input: Record<string, unknown> = EDIT) =>
      excalidrawToolCall("excalidraw_write", input, { status });

    it("names the strongest change that went through, counting failed writes separately", () => {
      expect(
        summarizeDrawing(
          [
            write("failed", CREATE),
            write("completed", CREATE),
            excalidrawToolCall("excalidraw_render", { path: PATH }),
            write("failed"),
            write("completed"),
          ],
          NO_COPILOT_TOOL_CALLS
        )
      ).toEqual({ action: "create", status: "completed", path: PATH, failed: 2 });
    });

    it("shows the drawing in progress while any of its calls runs, including a render check", () => {
      expect(
        summarizeDrawing(
          [
            write("completed"),
            excalidrawToolCall("excalidraw_render", { path: PATH }, { status: "in_progress" }),
          ],
          NO_COPILOT_TOOL_CALLS
        ).status
      ).toBe("in_progress");
    });

    it("reports a read-only stretch as a read", () => {
      expect(
        summarizeDrawing(
          [
            excalidrawToolCall("excalidraw_read", { path: PATH }),
            excalidrawToolCall("excalidraw_render", { path: PATH }),
          ],
          NO_COPILOT_TOOL_CALLS
        )
      ).toEqual({ action: "read", status: "completed", path: PATH, failed: 0 });
    });

    it("names a finished drawing by the calls that finished, not by a change that was stopped (https://github.com/Brevilabs/obsidian-copilot-private/issues/787)", () => {
      expect(
        summarizeDrawing(
          [excalidrawToolCall("excalidraw_read", { path: PATH }), write("cancelled")],
          NO_COPILOT_TOOL_CALLS
        )
      ).toEqual({ action: "read", status: "completed", path: PATH, failed: 0 });
    });

    it("reports a drawing as failed when none of its changes went through", () => {
      expect(summarizeDrawing([write("failed"), write("failed")], NO_COPILOT_TOOL_CALLS)).toEqual({
        action: "edit",
        status: "failed",
        path: PATH,
        failed: 2,
      });
    });

    it("reports a drawing as stopped when its only change was cancelled", () => {
      expect(summarizeDrawing([write("cancelled")], NO_COPILOT_TOOL_CALLS).status).toBe(
        "cancelled"
      );
    });
  });
});
