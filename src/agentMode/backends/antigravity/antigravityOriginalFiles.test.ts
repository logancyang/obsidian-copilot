import type { ToolCallDelta } from "@/agentMode/session/types";
import { readAntigravityOriginalFiles } from "./antigravityOriginalFiles";

const NOTE = "/vault/TesterA/alpha.md";

function completedEdit(
  toolCallId: string,
  diffs: Array<{ path: string; oldText?: string | null; newText: string }>
): ToolCallDelta {
  return {
    toolCallId,
    kind: "edit",
    status: "completed",
    content: diffs.map((diff) => ({ type: "diff" as const, ...diff })),
  };
}

describe("antigravityOriginalFiles", () => {
  describe("readAntigravityOriginalFiles()", () => {
    it("reads each edit's file text from before the write, without the newline agy adds to the end", () => {
      const firstEdit = completedEdit("edit-fast", [
        {
          path: NOTE,
          oldText: "The fast brown fox.\nLast line here.\n\n",
          newText: "The slow brown fox.\nLast line here.\n\n",
        },
      ]);
      const secondEdit = completedEdit("edit-last", [
        {
          path: NOTE,
          oldText: "The slow brown fox.\nLast line here.\n\n",
          newText: "The slow brown fox.\nFourth line here.\n\n",
        },
      ]);

      expect(readAntigravityOriginalFiles(firstEdit)).toEqual({
        [NOTE]: "The fast brown fox.\nLast line here.\n",
      });
      expect(readAntigravityOriginalFiles(secondEdit)).toEqual({
        [NOTE]: "The slow brown fox.\nLast line here.\n",
      });
    });

    it("reports a file the edit created as missing before it", () => {
      expect(
        readAntigravityOriginalFiles(
          completedEdit("create", [{ path: "/vault/new.md", newText: "# New\n" }])
        )
      ).toEqual({ "/vault/new.md": null });
    });

    it("keeps a file without a trailing newline as it was", () => {
      expect(
        readAntigravityOriginalFiles(
          completedEdit("edit", [{ path: NOTE, oldText: "no newline", newText: "x" }])
        )
      ).toEqual({ [NOTE]: "no newline" });
    });

    it("reads nothing from an update that has not completed or carries no diff", () => {
      const pending: ToolCallDelta = {
        ...completedEdit("edit", [{ path: NOTE, oldText: "hunk\n", newText: "HUNK\n" }]),
        status: "pending",
      };
      const shell: ToolCallDelta = {
        toolCallId: "shell",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "done" } }],
      };

      expect(readAntigravityOriginalFiles(pending)).toBeNull();
      expect(readAntigravityOriginalFiles(shell)).toBeNull();
    });
  });
});
