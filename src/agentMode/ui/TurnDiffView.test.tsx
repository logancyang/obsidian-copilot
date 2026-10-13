import type { TurnFileChange } from "@/agentMode/session/types";
import {
  closeRestoredTurnDiffs,
  openTurnDiff,
  registerTurnDiffCommands,
  TurnDiffView,
  type TurnDiffViewState,
} from "@/agentMode/ui/TurnDiffView";
import {
  appParsing,
  type RecordedParse,
} from "@/agentMode/ui/renderedDiff/testing/recordedParserApp";
import { TURN_DIFF_VIEW_TYPE } from "@/constants";
import { logError } from "@/logger";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { App, Command, Notice, Plugin, TFile, Workspace, WorkspaceLeaf } from "obsidian";

jest.mock("@/logger");
jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn((_app, markdown: string, el: HTMLElement) => {
    el.textContent = markdown;
    return Promise.resolve();
  }),
}));

const ALPHA_BEFORE = "The quick brown fox.\n";
const ALPHA_AFTER = "The quick red fox.\n";
const ALPHA_PARSE: RecordedParse = { sections: [["paragraph", 0, 0]] };
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

function fakeApp(
  files: TFile[] = [],
  parse: RecordedParse | Promise<RecordedParse> = ALPHA_PARSE
): App {
  return {
    ...appParsing(async () => parse),
    workspace: {
      getActiveFile: () => null,
      getLeaf: jest.fn(() => ({ openFile: jest.fn().mockResolvedValue(undefined) })),
    },
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

const textOf = (root: HTMLElement, selector: string): string[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent ?? "");

async function renderedDiff(): Promise<TurnDiffView> {
  const view = await openView();
  await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });
  await waitFor(() => expect(within(header(view)).getByText("1 of 1")).toBeTruthy());
  return view;
}

function header(view: TurnDiffView): HTMLElement {
  const path = within(view.containerEl).getByTitle(/\.(md|canvas|json)$/);
  return path.parentElement!;
}

describe("TurnDiffView", () => {
  beforeEach(() => {
    HTMLElement.prototype.animate = jest.fn();
  });

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

        expect(within(header(view)).getByTitle("notes/diff-demo/alpha.md")).toBeTruthy();
        expect(within(header(view)).getByText("+4")).toBeTruthy();
        expect(within(header(view)).getByText("−2")).toBeTruthy();
        await waitFor(() => expect(textOf(view.containerEl, "del")).toEqual(["brown"]));
        expect(textOf(view.containerEl, "ins")).toEqual(["red"]);
        expect(view.containerEl.querySelector("pre")).toBeNull();
      });

      it("marks the changed text on the left strip once the note has rendered", async () => {
        const view = await openView();

        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        await waitFor(() =>
          expect(
            within(view.containerEl).getByRole("button", { name: "Go to change 1 of 1" })
          ).toBeTruthy()
        );
      });

      it("shows the header at once and leaves the body empty until Obsidian has parsed the note", async () => {
        let finishParsing!: (parse: RecordedParse) => void;
        const parsing = new Promise<RecordedParse>((resolve) => {
          finishParsing = resolve;
        });
        const view = await openView(fakeApp([], parsing));

        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        expect(within(header(view)).getByTitle("notes/diff-demo/alpha.md")).toBeTruthy();
        expect(view.containerEl.querySelector(".markdown-rendered")?.childNodes).toHaveLength(0);
        finishParsing(ALPHA_PARSE);
        await waitFor(() => expect(textOf(view.containerEl, "del")).toEqual(["brown"]));
      });

      it("drops the previous file's change marks while the next file's diff is still parsing (https://github.com/Brevilabs/obsidian-copilot-private/issues/709)", async () => {
        const app = {
          ...fakeApp(),
          ...appParsing(async (source) =>
            source === ALPHA_BEFORE || source === ALPHA_AFTER ? ALPHA_PARSE : new Promise(() => {})
          ),
        };
        const view = await openView(app);
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });
        await waitFor(() =>
          expect(
            within(view.containerEl).getByRole("button", { name: "Go to change 1 of 1" })
          ).toBeTruthy()
        );

        await hydrate(view, {
          ...change("notes/diff-demo/beta.md", { before: "One.\n", after: "Two.\n" }),
          turnId: "turn-1",
        });

        expect(within(view.containerEl).queryAllByRole("button", { name: /Go to change/ })).toEqual(
          []
        );
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

    describe("stepChange()", () => {
      it("moves to the next change and shows its position in the header", async () => {
        const view = await renderedDiff();

        let available = false;
        act(() => {
          available = view.stepChange(1, false);
        });

        expect(available).toBe(true);
        expect(within(header(view)).getByText("1 of 1")).toBeTruthy();
      });

      it("reports a change to step to without moving when only checking", async () => {
        const view = await renderedDiff();

        expect(view.stepChange(1, true)).toBe(true);
        expect(within(header(view)).getByText("1 of 1")).toBeTruthy();
      });

      it("reports nothing to step to before the note has rendered", async () => {
        const view = await openView();

        expect(view.stepChange(1, true)).toBe(false);
      });
    });

    describe("onClose()", () => {
      it("removes the rendered diff and its window-migration listener when the tab closes", async () => {
        const detachMigration = jest.fn();
        jest.spyOn(HTMLElement.prototype, "onWindowMigrated").mockReturnValueOnce(detachMigration);
        const view = await openView();
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });
        await waitFor(() => expect(textOf(view.containerEl, "ins")).toEqual(["red"]));

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

      it("logs the failure when Obsidian cannot open the note", async () => {
        const file = Object.assign(new TFile(), { path: "notes/diff-demo/alpha.md" });
        const app = fakeApp([file]);
        const failure = new Error("view failed to load");
        jest
          .mocked(app.workspace.getLeaf)
          .mockReturnValue({ openFile: jest.fn().mockRejectedValue(failure) } as never);
        const view = await openView(app);
        await hydrate(view, { ...change("notes/diff-demo/alpha.md"), turnId: "turn-1" });

        fireEvent.click(within(header(view)).getByText("Open note"));

        await waitFor(() =>
          expect(logError).toHaveBeenCalledWith("[TurnDiffView] failed to open the note", failure)
        );
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

  describe("registerTurnDiffCommands()", () => {
    function registeredCommands(activeView: unknown): Command[] {
      const commands: Command[] = [];
      const plugin = {
        app: { workspace: { getActiveViewOfType: () => activeView } },
        addCommand: (command: Command) => commands.push(command),
      } as unknown as Plugin;
      registerTurnDiffCommands(plugin);
      return commands;
    }

    it("adds next and previous change commands that step the active diff tab", async () => {
      const view = await renderedDiff();
      const [next, previous] = registeredCommands(view);

      expect([next.name, previous.name]).toEqual([
        "Go to next change in file diff",
        "Go to previous change in file diff",
      ]);
      act(() => {
        previous.checkCallback?.(false);
      });
      expect(within(header(view)).getByText("1 of 1")).toBeTruthy();
      expect(next.checkCallback?.(true)).toBe(true);
    });

    it("repeats both commands while their hotkey is held", () => {
      const commands = registeredCommands(null);

      expect(commands.map((command) => command.repeatable)).toEqual([true, true]);
    });

    it("hides both commands when the active tab is not a file diff", () => {
      const commands = registeredCommands(null);

      expect(commands.map((command) => command.checkCallback?.(true))).toEqual([false, false]);
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
