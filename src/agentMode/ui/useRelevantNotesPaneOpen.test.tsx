import { useRelevantNotesPaneOpen } from "@/agentMode/ui/useRelevantNotesPaneOpen";
import { RELEVANT_NOTES_VIEWTYPE } from "@/constants";
import { act, renderHook } from "@testing-library/react";
import type { App, WorkspaceLeaf } from "obsidian";

function pane(shown: boolean) {
  const isShown = jest.fn(() => shown);
  return { leaf: { view: { containerEl: { isShown } } } as unknown as WorkspaceLeaf, isShown };
}

function workspaceWith(leaves: WorkspaceLeaf[]) {
  const listeners = new Map<string, () => void>();
  const workspace = {
    getLeavesOfType: jest.fn(() => leaves),
    on: jest.fn((name: string, callback: () => void) => {
      listeners.set(name, callback);
      return { name };
    }),
    offref: jest.fn(),
  };
  return {
    workspace,
    app: { workspace } as unknown as App,
    emit: (name: string) => act(() => listeners.get(name)?.()),
  };
}

describe("useRelevantNotesPaneOpen", () => {
  describe("useRelevantNotesPaneOpen()", () => {
    it("reports a visible pane independently of which leaf has focus", () => {
      const fixture = workspaceWith([pane(true).leaf]);
      const { result } = renderHook(() => useRelevantNotesPaneOpen(fixture.app));
      expect(result.current).toBe(true);
      expect(fixture.workspace.getLeavesOfType).toHaveBeenCalledWith(RELEVANT_NOTES_VIEWTYPE);
    });

    it("keeps the shelf available when existing panes are hidden — https://github.com/Brevilabs/obsidian-copilot-private/issues/468", () => {
      const fixture = workspaceWith([pane(false).leaf, pane(false).leaf]);
      const { result } = renderHook(() => useRelevantNotesPaneOpen(fixture.app));
      expect(result.current).toBe(false);
    });

    it("suppresses the shelf while any pane is visible and restores it when the last visible pane hides — https://github.com/Brevilabs/obsidian-copilot-private/issues/468", () => {
      const visible = pane(true);
      const fixture = workspaceWith([pane(false).leaf, visible.leaf]);
      const { result } = renderHook(() => useRelevantNotesPaneOpen(fixture.app));
      expect(result.current).toBe(true);
      visible.isShown.mockReturnValue(false);
      fixture.emit("layout-change");
      expect(result.current).toBe(false);
    });

    it("refreshes on tab activation and after a sidebar finishes collapsing — https://github.com/Brevilabs/obsidian-copilot-private/issues/468", () => {
      const relevant = pane(false);
      const fixture = workspaceWith([relevant.leaf]);
      const { result } = renderHook(() => useRelevantNotesPaneOpen(fixture.app));
      relevant.isShown.mockReturnValue(true);
      fixture.emit("active-leaf-change");
      expect(result.current).toBe(true);
      // The focus event may precede the final hidden layout during collapse.
      fixture.emit("active-leaf-change");
      relevant.isShown.mockReturnValue(false);
      fixture.emit("resize");
      expect(result.current).toBe(false);
      relevant.isShown.mockReturnValue(true);
      fixture.emit("resize");
      expect(result.current).toBe(true);
    });

    it("tracks pane removal and releases every workspace listener on unmount", () => {
      const fixture = workspaceWith([pane(true).leaf]);
      const { result, unmount } = renderHook(() => useRelevantNotesPaneOpen(fixture.app));
      fixture.workspace.getLeavesOfType.mockReturnValue([]);
      fixture.emit("layout-change");
      expect(result.current).toBe(false);
      unmount();
      expect(fixture.workspace.offref.mock.calls.map(([ref]) => ref.name).sort()).toEqual([
        "active-leaf-change",
        "layout-change",
        "resize",
      ]);
    });
  });
});
