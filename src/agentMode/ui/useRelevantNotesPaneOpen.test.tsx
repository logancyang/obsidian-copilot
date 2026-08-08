import { useRelevantNotesPaneOpen } from "@/agentMode/ui/useRelevantNotesPaneOpen";
import { RELEVANT_NOTES_VIEWTYPE } from "@/constants";
import { act, renderHook } from "@testing-library/react";
import type { App, EventRef, WorkspaceLeaf } from "obsidian";

describe("useRelevantNotesPaneOpen", () => {
  describe("useRelevantNotesPaneOpen()", () => {
    it("tracks the initial pane state, layout changes, and removes its listener on unmount", () => {
      let leaves = [{} as WorkspaceLeaf];
      let layoutChange: (() => void) | undefined;
      const ref = {} as EventRef;
      const workspace = {
        getLeavesOfType: jest.fn(() => leaves),
        on: jest.fn((_name: string, callback: () => void) => {
          layoutChange = callback;
          return ref;
        }),
        offref: jest.fn(),
      };
      const app = { workspace } as unknown as App;

      const { result, unmount } = renderHook(() => useRelevantNotesPaneOpen(app));

      expect(result.current).toBe(true);
      expect(workspace.getLeavesOfType).toHaveBeenCalledWith(RELEVANT_NOTES_VIEWTYPE);
      expect(workspace.on).toHaveBeenCalledWith("layout-change", expect.any(Function));

      leaves = [];
      act(() => layoutChange?.());

      expect(result.current).toBe(false);

      unmount();

      expect(workspace.offref).toHaveBeenCalledWith(ref);
    });
  });
});
