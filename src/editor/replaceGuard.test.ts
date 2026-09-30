import {
  createMapPosReplaceGuard,
  createHighlightReplaceGuard,
  getErrorMessage,
} from "./replaceGuard";
import type { EditorView } from "@codemirror/view";
import type { WorkspaceLeaf } from "obsidian";

jest.mock("./selectionHighlight", () => ({
  SelectionHighlight: {
    getRange: jest.fn(),
  },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
}));

describe("replaceGuard", () => {
  describe("getErrorMessage()", () => {
    it.each([
      ["no_range", "No selection range available."],
      ["range_out_of_bounds", "Selection range is out of bounds."],
      ["content_changed", "Selection content has changed. Please reselect and try again."],
      ["file_changed", "File has changed. Please reselect in the original file."],
      ["editor_changed", "Editor has changed. Please reselect and try again."],
      ["leaf_changed", "Editor pane has changed. Please reselect and try again."],
      ["target_unavailable", "Editor is no longer available."],
      [null, "Cannot replace. Please reselect and try again."],
    ] as const)("returns the user-facing message for reason %s", (reason, message) => {
      expect(getErrorMessage(reason)).toBe(message);
    });
  });

  describe("createMapPosReplaceGuard()", () => {
    const createMockEditorView = (docContent: string, isConnected = true): EditorView => {
      return {
        state: {
          doc: {
            length: docContent.length,
            sliceString: (from: number, to: number) => docContent.slice(from, to),
          },
          toText: (text: string) => ({ length: text.length }),
        },
        dom: {
          isConnected,
        },
        dispatch: jest.fn(),
        focus: jest.fn(),
      } as unknown as EditorView;
    };

    const createMockLeaf = (): WorkspaceLeaf => {
      return {} as WorkspaceLeaf;
    };

    describe("getRange", () => {
      it("returns the initial range", () => {
        const mockView = createMockEditorView("Hello World");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        expect(guard.getRange()).toEqual({ from: 0, to: 5 });
      });
    });

    describe("validate", () => {
      it("returns ok when all conditions are met", () => {
        const mockView = createMockEditorView("Hello World");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(true);
        expect(result.reason).toBeNull();
        expect(result.range).toEqual({ from: 0, to: 5 });
      });

      it("returns leaf_changed when leaf differs", () => {
        const mockView = createMockEditorView("Hello World");
        const mockLeaf = createMockLeaf();
        const differentLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: differentLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("leaf_changed");
      });

      it("returns editor_changed when editorView differs", () => {
        const mockView = createMockEditorView("Hello World");
        const differentView = createMockEditorView("Hello World");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: differentView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("editor_changed");
      });

      it("returns file_changed when filePath differs", () => {
        const mockView = createMockEditorView("Hello World");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/different.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("file_changed");
      });

      it("returns target_unavailable when DOM is disconnected", () => {
        const mockView = createMockEditorView("Hello World", false);
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("target_unavailable");
      });

      it("returns content_changed when text differs", () => {
        const mockView = createMockEditorView("Goodbye World");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("content_changed");
      });

      it("returns range_out_of_bounds when range exceeds doc length", () => {
        const mockView = createMockEditorView("Hi");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 10 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("range_out_of_bounds");
      });
    });

    describe("onDocChanged", () => {
      it("updates range when document changes", () => {
        const mockView = createMockEditorView("Hello World");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const mockChanges = {
          mapPos: (pos: number, assoc: number) => pos + 3,
        };

        guard.onDocChanged?.(mockChanges as unknown as import("@codemirror/state").ChangeDesc);

        expect(guard.getRange()).toEqual({ from: 3, to: 8 });
      });
    });

    describe("replace", () => {
      it("dispatches replacement when validation passes", () => {
        const mockView = createMockEditorView("Hello World");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.replace("Hi");

        expect(result.ok).toBe(true);
        expect(mockView.dispatch).toHaveBeenCalled();
        expect(mockView.focus).toHaveBeenCalled();
      });

      it("returns error when validation fails", () => {
        const mockView = createMockEditorView("Goodbye World");
        const mockLeaf = createMockLeaf();

        const guard = createMapPosReplaceGuard({
          editorView: mockView,
          leafSnapshot: mockLeaf,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          initialRange: { from: 0, to: 5 },
          getLeafState: () => ({
            leaf: mockLeaf,
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.replace("Hi");

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("content_changed");
        expect(mockView.dispatch).not.toHaveBeenCalled();
      });
    });
  });

  describe("createHighlightReplaceGuard()", () => {
    const { SelectionHighlight } = jest.requireMock<{
      SelectionHighlight: { getRange: jest.Mock };
    }>("./selectionHighlight");

    const createMockEditorView = (docContent: string): EditorView => {
      return {
        state: {
          doc: {
            length: docContent.length,
            sliceString: (from: number, to: number) => docContent.slice(from, to),
          },
          toText: (text: string) => ({ length: text.length }),
        },
        dispatch: jest.fn(),
        focus: jest.fn(),
      } as unknown as EditorView;
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe("getRange", () => {
      it("returns range from SelectionHighlight", () => {
        const mockView = createMockEditorView("Hello World");
        SelectionHighlight.getRange.mockReturnValue({ from: 0, to: 5 });

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        expect(guard.getRange()).toEqual({ from: 0, to: 5 });
      });

      it("returns null when no highlight exists", () => {
        const mockView = createMockEditorView("Hello World");
        SelectionHighlight.getRange.mockReturnValue(null);

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        expect(guard.getRange()).toBeNull();
      });
    });

    describe("validate", () => {
      it("returns ok when all conditions are met", () => {
        const mockView = createMockEditorView("Hello World");
        SelectionHighlight.getRange.mockReturnValue({ from: 0, to: 5 });

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(true);
      });

      it("returns target_unavailable when no active editor", () => {
        const mockView = createMockEditorView("Hello World");
        SelectionHighlight.getRange.mockReturnValue({ from: 0, to: 5 });

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: null,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("target_unavailable");
      });

      it("returns editor_changed when editor differs", () => {
        const mockView = createMockEditorView("Hello World");
        const differentView = createMockEditorView("Hello World");
        SelectionHighlight.getRange.mockReturnValue({ from: 0, to: 5 });

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: differentView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("editor_changed");
      });

      it("returns file_changed when file differs", () => {
        const mockView = createMockEditorView("Hello World");
        SelectionHighlight.getRange.mockReturnValue({ from: 0, to: 5 });

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: mockView,
            filePath: "/different.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("file_changed");
      });

      it("returns no_range when no highlight exists", () => {
        const mockView = createMockEditorView("Hello World");
        SelectionHighlight.getRange.mockReturnValue(null);

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("no_range");
      });

      it("returns content_changed when text differs", () => {
        const mockView = createMockEditorView("Goodbye World");
        SelectionHighlight.getRange.mockReturnValue({ from: 0, to: 7 });

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        const result = guard.validate();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("content_changed");
      });
    });

    describe("onDocChanged", () => {
      it("is not defined (SelectionHighlight handles mapPos internally)", () => {
        const mockView = createMockEditorView("Hello World");

        const guard = createHighlightReplaceGuard({
          editorView: mockView,
          filePathSnapshot: "/test.md",
          selectedTextSnapshot: "Hello",
          getCurrentContext: () => ({
            editorView: mockView,
            filePath: "/test.md",
          }),
        });

        expect(guard.onDocChanged).toBeUndefined();
      });
    });
  });
});
