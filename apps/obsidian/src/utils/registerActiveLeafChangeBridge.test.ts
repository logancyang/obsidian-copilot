import { EVENT_NAMES } from "@/constants";
import { registerActiveLeafChangeBridge } from "@/utils/registerActiveLeafChangeBridge";
import type { ItemView, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile } from "obsidian";

jest.mock("obsidian", () => ({
  TFile: class TFile {},
  MarkdownView: class MarkdownView {
    file: unknown = null;
  },
}));

describe("registerActiveLeafChangeBridge", () => {
  describe("registerActiveLeafChangeBridge()", () => {
    it("registers a lifecycle-owned listener that dispatches for Markdown leaves with files", () => {
      let activeLeafChange: ((leaf: WorkspaceLeaf | null) => void) | undefined;
      const eventRef = {};
      const view = {
        app: {
          workspace: {
            on: jest.fn((_name: string, callback: (leaf: WorkspaceLeaf | null) => void) => {
              activeLeafChange = callback;
              return eventRef;
            }),
          },
        },
        registerEvent: jest.fn(),
      } as unknown as ItemView;
      const eventTarget = new EventTarget();
      const onActiveLeafChange = jest.fn();
      eventTarget.addEventListener(EVENT_NAMES.ACTIVE_LEAF_CHANGE, onActiveLeafChange);
      const markdownView = new MarkdownView({} as WorkspaceLeaf);
      markdownView.file = new TFile();

      registerActiveLeafChangeBridge(view, eventTarget);
      activeLeafChange?.({ view: markdownView } as unknown as WorkspaceLeaf);

      expect(view.app.workspace.on).toHaveBeenCalledWith(
        "active-leaf-change",
        expect.any(Function)
      );
      expect(view.registerEvent).toHaveBeenCalledWith(eventRef);
      expect(onActiveLeafChange).toHaveBeenCalledTimes(1);
    });
  });
});
