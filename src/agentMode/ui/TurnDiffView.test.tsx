import type { TurnFileChange } from "@/agentMode/session/types";
import {
  closeRestoredTurnDiffs,
  openTurnDiff,
  TurnDiffView,
  TURN_DIFF_VIEW_TYPE,
  type TurnDiffViewState,
} from "@/agentMode/ui/TurnDiffView";
import { act, fireEvent, within } from "@testing-library/react";
import { App, Notice, TFile, Workspace, WorkspaceLeaf } from "obsidian";

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn((_app, markdown: string, el: HTMLElement) => {
    el.textContent = markdown;
    return Promise.resolve();
  }),
}));

const ALPHA_BEFORE = "The quick brown fox.\n";
const ALPHA_AFTER = "The quick red fox.\n";
const openViews: TurnDiffView[] = [];

function change(path: string, overrides: Partial<TurnFileChange> = {}): TurnFileChange {
  return {
    path,
    status: "modified",
    before: ALPHA_BEFORE,
    after: ALPHA_AFTER,
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}

function fakeApp(files: TFile[] = []): App {
  return {
    workspace: { getActiveFile: () => null, getLeaf: jest.fn(() => ({ openFile: jest.fn() })) },
    vault: {
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
  } as unknown as App;
}

async function openView(app: App = fakeApp()): Promise<TurnDiffView> {
  const view = new TurnDiffView({ app } as unknown as WorkspaceLeaf);
  openViews.push(view);
  await act(async () => {
    await view.onOpen();
  });
  return view;
}

async function hydrate(view: TurnDiffView, state: TurnDiffViewState): Promise<void> {
  await act(async () => {
    await view.setState(state);
  });
}

function header(view: TurnDiffView): HTMLElement {
  const path = within(view.containerEl).getByTitle(/\.(md|canvas|json)$/);
  return path.parentElement!;
}

describe("TurnDiffView", () => {
  afterEach(async () => {
    await act(async () => {
      for (const view of openViews.splice(0)) await view.onClose();
    });
    jest.restoreAllMocks();
  });

  describe("TurnDiffView", () => {
    describe("getDisplayText()", () => {
      it("titles the tab with the file's basename so a row of diff tabs stays readable", async () => {
        const view = await openView();

        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        expect(view.getDisplayText()).toBe("alpha.md");
      });
    });

    describe("getViewType() and getIcon()", () => {
      it("identifies itself as the diff view with the file-diff icon", async () => {
        const view = await openView();

        expect(view.getViewType()).toBe(TURN_DIFF_VIEW_TYPE);
        expect(view.getIcon()).toBe("file-diff");
      });
    });

    describe("setState()", () => {
      it("shows the vault path, the line counts and the rendered before/after of the change", async () => {
        const view = await openView();

        await hydrate(view, {
          ...change("notes/diff-demo/alpha.md", { additions: 4, deletions: 2 }),
          turnId: "turn-1",
        });

        const body = view.containerEl.textContent ?? "";
        expect(within(header(view)).getByTitle("notes/diff-demo/alpha.md")).toBeTruthy();
        expect(within(header(view)).getByText("+4")).toBeTruthy();
        expect(within(header(view)).getByText("−2")).toBeTruthy();
        expect(body).toContain("quick");
        expect(body).toContain("red");
      });

      it("badges a created file as new", async () => {
        const view = await openView();

        await hydrate(view, {
          ...change("notes/diff-demo/epsilon.md", { status: "created", before: null }),
          turnId: "turn-1",
        });

        expect(within(header(view)).getByText("new")).toBeTruthy();
      });

      it("closes its tab when Obsidian rebuilds it with empty state after a plugin reload https://github.com/Brevilabs/obsidian-copilot-private/issues/348", async () => {
        const detach = jest.fn();
        const view = new TurnDiffView({ app: fakeApp(), detach } as unknown as WorkspaceLeaf);
        openViews.push(view);
        await act(async () => {
          await view.onOpen();
        });

        await hydrate(view, {} as TurnDiffViewState);

        expect(detach).toHaveBeenCalledTimes(1);
        expect(view.getDisplayText()).toBe("File diff");
      });

      it("renders a non-markdown file as a whole-file line diff rather than as markdown", async () => {
        const view = await openView();

        await hydrate(view, {
          ...change("notes/diff-demo/board.canvas", {
            before: '{"nodes": []}\n',
            after: '{"nodes": [1]}\n',
          }),
          turnId: "turn-1",
        });

        const lineDiff = view.containerEl.querySelector("pre");
        expect(lineDiff).not.toBeNull();
        expect(lineDiff!.querySelector("[data-change=deleted]")?.textContent).toBe('{"nodes": []}');
        expect(lineDiff!.querySelector("[data-change=inserted]")?.textContent).toBe(
          '{"nodes": [1]}'
        );
      });
    });

    describe("onClose()", () => {
      it("removes the rendered diff and its window-migration listener when the tab closes", async () => {
        const detachMigration = jest.fn();
        jest.spyOn(HTMLElement.prototype, "onWindowMigrated").mockReturnValueOnce(detachMigration);
        const view = await openView();
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });
        expect(view.containerEl.textContent).toContain("red");

        await act(async () => {
          await view.onClose();
        });

        expect(view.containerEl.children[1].childNodes).toHaveLength(0);
        expect(detachMigration).toHaveBeenCalledTimes(1);
        await hydrate(view, { ...change("notes/diff-demo/beta.md"), turnId: "turn-2" });
        expect(view.containerEl.children[1].childNodes).toHaveLength(0);
      });
    });

    describe("Open note", () => {
      it("opens the changed file in its own tab, leaving the diff tab in place", async () => {
        const file = Object.assign(new TFile(), { path: "notes/diff-demo/alpha.md" });
        const app = fakeApp([file]);
        const view = await openView(app);
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        fireEvent.click(within(header(view)).getByText("Open note"));

        expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
        const leaf = jest.mocked(app.workspace.getLeaf).mock.results[0].value;
        expect(leaf.openFile).toHaveBeenCalledWith(file);
      });

      it("tells the user the note is gone instead of creating an empty one when the file moved after the turn https://github.com/Brevilabs/obsidian-copilot-private/issues/348", async () => {
        const app = fakeApp();
        const view = await openView(app);
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        fireEvent.click(within(header(view)).getByText("Open note"));

        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("notes/diff-demo/alpha.md no longer exists.");
      });

      it("offers no Open note for a deleted file, which the vault could only recreate", async () => {
        const view = await openView();

        await hydrate(view, {
          ...change("notes/diff-demo/zeta.md", { status: "deleted", after: null }),
          turnId: "turn-1",
        });

        expect(within(header(view)).queryByText("Open note")).toBeNull();
        expect(within(header(view)).getByText("deleted")).toBeTruthy();
      });
    });
  });

  describe("closeRestoredTurnDiffs()", () => {
    it("closes every diff tab once the layout is ready, since a restored tab has no capture to show https://github.com/Brevilabs/obsidian-copilot-private/issues/348", () => {
      const readyCallbacks: (() => void)[] = [];
      const detachLeavesOfType = jest.fn();
      const workspace = {
        onLayoutReady: (callback: () => void) => readyCallbacks.push(callback),
        detachLeavesOfType,
      } as unknown as Workspace;

      closeRestoredTurnDiffs(workspace);
      expect(detachLeavesOfType).not.toHaveBeenCalled();
      for (const callback of readyCallbacks) callback();

      expect(detachLeavesOfType).toHaveBeenCalledWith(TURN_DIFF_VIEW_TYPE);
    });
  });

  describe("openTurnDiff()", () => {
    interface FakeWorkspace {
      app: App;
      leaves: { view: TurnDiffView }[];
      revealed: unknown[];
      opened: number;
    }

    function fakeWorkspace(): FakeWorkspace {
      const state: FakeWorkspace = {
        app: null as unknown as App,
        leaves: [],
        revealed: [],
        opened: 0,
      };
      state.app = {
        workspace: {
          getLeavesOfType: (type: string) => (type === TURN_DIFF_VIEW_TYPE ? state.leaves : []),
          getLeaf: () => {
            state.opened++;
            const view = new TurnDiffView({ app: state.app } as unknown as WorkspaceLeaf);
            const leaf = {
              view,
              setViewState: (viewState: { state: TurnDiffViewState }) =>
                view.setState(viewState.state),
            };
            state.leaves.push(leaf);
            return leaf;
          },
          revealLeaf: (leaf: unknown) => state.revealed.push(leaf),
        },
      } as unknown as App;
      return state;
    }

    it("opens the file's diff in a new main-area tab", async () => {
      const workspace = fakeWorkspace();

      await openTurnDiff(workspace.app, change("notes/diff-demo/alpha.md"), "turn-1");

      expect(workspace.opened).toBe(1);
      expect(workspace.leaves[0].view.getDiffKey()).toBe("turn-1\nnotes/diff-demo/alpha.md");
      expect(workspace.revealed).toEqual([workspace.leaves[0]]);
    });

    it("reveals the tab already showing that turn's file instead of opening a second copy", async () => {
      const workspace = fakeWorkspace();
      await openTurnDiff(workspace.app, change("notes/diff-demo/alpha.md"), "turn-1");

      await openTurnDiff(workspace.app, change("notes/diff-demo/alpha.md"), "turn-1");

      expect(workspace.opened).toBe(1);
      expect(workspace.revealed).toHaveLength(2);
    });

    it("opens a separate tab for another file of the same turn", async () => {
      const workspace = fakeWorkspace();
      await openTurnDiff(workspace.app, change("notes/diff-demo/alpha.md"), "turn-1");

      await openTurnDiff(workspace.app, change("notes/diff-demo/beta.md"), "turn-1");

      expect(workspace.opened).toBe(2);
    });

    it("opens a separate tab when a later turn changes the same file again", async () => {
      const workspace = fakeWorkspace();
      await openTurnDiff(workspace.app, change("notes/diff-demo/alpha.md"), "turn-1");

      await openTurnDiff(workspace.app, change("notes/diff-demo/alpha.md"), "turn-2");

      expect(workspace.opened).toBe(2);
    });
  });
});
