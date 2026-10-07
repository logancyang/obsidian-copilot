import {
  STARTUP_LOADING_TEXT,
  StartupLoadingView,
  type CopilotStartup,
} from "@/components/StartupLoadingView";
import { logError } from "@/logger";
import type { View, WorkspaceLeaf } from "obsidian";

jest.mock("obsidian", () => ({
  ItemView: class ItemView {
    contentEl = document.createElement("div");
    constructor(public leaf: unknown) {}
  },
}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

interface FakeLeaf {
  view: unknown;
  open: jest.Mock<Promise<View>, [View]>;
}

function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function createStartedView() {
  const stateApplied = deferred<unknown>();
  const view = {
    setState: jest.fn(async (state: unknown) => stateApplied.resolve(state)),
  } as unknown as View;
  return { view, stateApplied: stateApplied.promise };
}

function openLoadingView(createView: CopilotStartup["createStartedView"]) {
  const started = deferred();
  const leaf: FakeLeaf = {
    view: null,
    open: jest.fn(async (view: View) => {
      leaf.view = view;
      return view;
    }),
  };
  const startup: CopilotStartup = {
    whenStarted: () => started.promise,
    createStartedView: jest.fn(createView),
  };
  const view = new StartupLoadingView(
    leaf as unknown as WorkspaceLeaf,
    "copilot-agent-chat-view",
    startup
  );
  leaf.view = view;
  return { view, leaf, startup, started };
}

describe("StartupLoadingView", () => {
  describe("StartupLoadingView", () => {
    describe("getViewType()", () => {
      it("reports the type of the Copilot tab it stands in for, so Obsidian saves the layout unchanged", () => {
        const { view } = openLoadingView(() => undefined);

        expect(view.getViewType()).toBe("copilot-agent-chat-view");
      });
    });

    describe("setState()", () => {
      it("keeps the tab state Obsidian restored, so a layout save during startup does not drop it", async () => {
        const { view } = openLoadingView(() => undefined);

        await view.setState({ chatId: "chat-1" });

        expect(view.getState()).toEqual({ chatId: "chat-1" });
      });
    });

    describe("onOpen()", () => {
      it("shows that Copilot is starting while startup runs", async () => {
        const { view } = openLoadingView(() => undefined);

        await view.onOpen();

        expect(view.contentEl.textContent).toBe(STARTUP_LOADING_TEXT);
      });

      it("swaps itself for the started view and hands over the restored state once Copilot starts https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const started = createStartedView();
        const { view, leaf, started: startup } = openLoadingView(() => started.view);
        await view.setState({ chatId: "chat-1" });

        await view.onOpen();
        startup.resolve();

        await expect(started.stateApplied).resolves.toEqual({ chatId: "chat-1" });
        expect(leaf.open).toHaveBeenCalledWith(started.view);
        expect(leaf.view).toBe(started.view);
      });

      it("stays in place when startup ends without a view because Copilot unloaded https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const { view, leaf, startup, started } = openLoadingView(() => undefined);

        await view.onOpen();
        started.resolve();
        await started.promise;

        expect(startup.createStartedView).toHaveBeenCalledWith("copilot-agent-chat-view", leaf);
        expect(leaf.open).not.toHaveBeenCalled();
        expect(leaf.view).toBe(view);
      });

      it("leaves a tab closed or reused before Copilot started untouched https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const { view, leaf, startup, started } = openLoadingView(() => createStartedView().view);

        await view.onOpen();
        leaf.view = { getViewType: () => "markdown" };
        started.resolve();
        await started.promise;

        expect(startup.createStartedView).not.toHaveBeenCalled();
        expect(leaf.open).not.toHaveBeenCalled();
      });

      it("logs the failure when the started view cannot open", async () => {
        const failure = new Error("view failed to open");
        const logged = deferred();
        jest.mocked(logError).mockImplementationOnce(() => logged.resolve());
        const { view, leaf, started } = openLoadingView(() => createStartedView().view);
        leaf.open.mockRejectedValueOnce(failure);

        await view.onOpen();
        started.resolve();
        await logged.promise;

        expect(logError).toHaveBeenCalledWith(
          "Copilot could not open a tab restored during startup.",
          failure
        );
      });
    });
  });
});
