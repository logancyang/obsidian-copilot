import { deriveEditDiff, diffStats } from "@/agentMode/ui/editDiff";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

const CTX = { vaultBase: "/Users/me/vault" };

function tool(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    kind: "tool_call",
    id: "x",
    title: "tool",
    status: "completed",
    ...overrides,
  };
}

describe("deriveEditDiff", () => {
  it("uses the first {type:diff} output entry, made vault-relative", () => {
    const t = tool({
      vendorToolName: "Edit",
      output: [
        { type: "text", text: "ignored" },
        {
          type: "diff",
          path: "/Users/me/vault/notes/a.md",
          oldText: "old body",
          newText: "new body",
        },
        { type: "diff", path: "later.md", oldText: "x", newText: "y" },
      ],
    });
    expect(deriveEditDiff(t, CTX)).toEqual({
      path: "notes/a.md",
      oldText: "old body",
      newText: "new body",
    });
  });

  it("normalizes a null diff oldText to an empty string", () => {
    const t = tool({
      vendorToolName: "Write",
      output: [{ type: "diff", path: "fresh.md", oldText: null, newText: "hello" }],
    });
    expect(deriveEditDiff(t, CTX)).toEqual({ path: "fresh.md", oldText: "", newText: "hello" });
  });

  it("falls back to Edit input old_string/new_string when no diff output", () => {
    const t = tool({
      vendorToolName: "Edit",
      input: {
        file_path: "/Users/me/vault/draft.md",
        old_string: "before",
        new_string: "after",
      },
    });
    expect(deriveEditDiff(t, CTX)).toEqual({
      path: "draft.md",
      oldText: "before",
      newText: "after",
    });
  });

  it("treats Write input.content as a full-file add (empty oldText)", () => {
    const t = tool({
      vendorToolName: "Write",
      input: { file_path: "new.md", content: "line1\nline2" },
    });
    expect(deriveEditDiff(t, CTX)).toEqual({
      path: "new.md",
      oldText: "",
      newText: "line1\nline2",
    });
  });

  it("resolves the path from filePath / path aliases", () => {
    const viaFilePath = tool({ input: { filePath: "b.md", content: "x" } });
    expect(deriveEditDiff(viaFilePath, CTX)?.path).toBe("b.md");
    const viaPath = tool({ input: { path: "c.md", old_string: "a", new_string: "b" } });
    expect(deriveEditDiff(viaPath, CTX)?.path).toBe("c.md");
  });

  it("returns null for a Read / non-edit part with no diff output or edit input", () => {
    const read = tool({
      vendorToolName: "Read",
      output: [{ type: "text", text: "file contents" }],
    });
    expect(deriveEditDiff(read, CTX)).toBeNull();
  });

  it("returns null when an edit input has no resolvable path", () => {
    const t = tool({ input: { old_string: "a", new_string: "b" } });
    expect(deriveEditDiff(t, CTX)).toBeNull();
  });
});

describe("diffStats", () => {
  it("counts a single-line change inside a large body as +1 / -1, not the file size", () => {
    const body = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n") + "\n";
    const changed = body.replace("line100", "CHANGED");
    expect(diffStats({ path: "big.md", oldText: body, newText: changed })).toEqual({
      added: 1,
      removed: 1,
    });
  });

  it("reports a pure addition as added lines only", () => {
    expect(diffStats({ path: "x.md", oldText: "a\nb\n", newText: "a\nb\nc\nd\n" })).toEqual({
      added: 2,
      removed: 0,
    });
  });

  it("reports a pure deletion as removed lines only", () => {
    expect(diffStats({ path: "x.md", oldText: "a\nb\nc\nd\n", newText: "a\nb\n" })).toEqual({
      added: 0,
      removed: 2,
    });
  });

  it("reports no changes when old and new text are identical", () => {
    expect(diffStats({ path: "x.md", oldText: "same\ntext\n", newText: "same\ntext\n" })).toEqual({
      added: 0,
      removed: 0,
    });
  });
});
