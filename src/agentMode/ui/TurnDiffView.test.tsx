import type { TurnFileChange } from "@/agentMode/session/types";
import {
  openTurnDiff,
  TurnDiffView,
  TURN_DIFF_VIEW_TYPE,
  type TurnDiffViewState,
} from "@/agentMode/ui/TurnDiffView";
import { openVaultPath } from "@/utils/openVaultPath";
import { act, fireEvent, within } from "@testing-library/react";
import { App, WorkspaceLeaf } from "obsidian";

jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));
// Obsidian's renderer is unavailable under jsdom; the body's own rendering is
// covered by the RenderedDiff suite, so echo the markdown it is handed.
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

function fakeApp(): App {
  return {
    workspace: { getActiveFile: () => null },
    vault: { getAbstractFileByPath: () => null },
  } as unknown as App;
}

/** A view already opened by Obsidian, ready to receive its state. */
async function openView(app: App = fakeApp()): Promise<TurnDiffView> {
  const view = new TurnDiffView({ app, detach: jest.fn() } as unknown as WorkspaceLeaf);
  openViews.push(view);
  await act(async () => {
    await view.onOpen();
  });
  return view;
}

/** How often Obsidian was asked to close the tab this view sits in. */
function detachCalls(view: TurnDiffView): number {
  return (view.leaf as unknown as { detach: jest.Mock }).detach.mock.calls.length;
}

async function hydrate(view: TurnDiffView, state: TurnDiffViewState): Promise<void> {
  await act(async () => {
    await view.setState(state);
  });
}

/** The header strip, addressed through the path it always shows. */
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

    describe("getState()", () => {
      it("publishes no state, so a workspace reload cannot restore a tab whose capture is gone", async () => {
        const view = await openView();
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        expect(view.getState()).toEqual({});
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

      it("keeps the hydrated diff on screen when Obsidian replays an empty rehydration state", async () => {
        const view = await openView();
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        await hydrate(view, {} as TurnDiffViewState);

        expect(view.getDisplayText()).toBe("alpha.md");
        expect(view.containerEl.textContent).toContain("red");
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

        const lineDiff = view.containerEl.querySelector("pre.copilot-diff-code");
        expect(lineDiff).not.toBeNull();
        expect(lineDiff!.querySelector(".diff-line-del")?.textContent).toBe('{"nodes": []}');
        expect(lineDiff!.querySelector(".diff-line-ins")?.textContent).toBe('{"nodes": [1]}');
      });
    });

    describe("onOpen()", () => {
      it("closes the tab when a plugin reload rebuilds it without a capture to show", async () => {
        jest.useFakeTimers();
        try {
          const view = await openView();

          await act(async () => {
            await view.setState({} as TurnDiffViewState);
            jest.runAllTimers();
          });

          expect(detachCalls(view)).toBe(1);
        } finally {
          jest.useRealTimers();
        }
      });

      it("keeps the tab open once a change has been handed to it", async () => {
        jest.useFakeTimers();
        try {
          const view = await openView();

          await act(async () => {
            await view.setState({ ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });
            jest.runAllTimers();
          });

          expect(detachCalls(view)).toBe(0);
        } finally {
          jest.useRealTimers();
        }
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
        const app = fakeApp();
        const view = await openView(app);
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        fireEvent.click(within(header(view)).getByText("Open note"));

        expect(openVaultPath).toHaveBeenCalledWith(app, "notes/diff-demo/alpha.md", {
          newLeaf: true,
        });
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

  describe("openTurnDiff()", () => {
    interface FakeWorkspace {
      app: App;
      leaves: { view: { getDiffKey: () => string | undefined } }[];
      revealed: unknown[];
      opened: number;
    }

    /** A workspace that records every tab this helper opens or reveals. */
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

    it("opens a fresh tab when a stale view from a previous plugin lifecycle cannot report its file", async () => {
      const workspace = fakeWorkspace();
      workspace.leaves.push({ view: {} as { getDiffKey: () => string | undefined } });

      await openTurnDiff(workspace.app, change("notes/diff-demo/alpha.md"), "turn-1");

      expect(workspace.opened).toBe(1);
    });
  });
});
