import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { fireEvent, render } from "@testing-library/react";
import GalleryPlugin, { GALLERY_VIEWTYPE } from "./main";
import type { GalleryViewState } from "./Gallery";
import type { App, Command, PluginManifest, WorkspaceLeaf } from "obsidian";
import type { ReactElement, ReactNode } from "react";

jest.mock(
  "./stories.generated",
  () => ({
    modules: [
      {
        componentId: "@/agentMode/ui/AgentWelcomeCard",
        load: () => Promise.resolve(jest.requireActual("@/agentMode/ui/AgentWelcomeCard.stories")),
      },
      {
        componentId: "@/components/ui/badge",
        load: () => Promise.resolve(jest.requireActual("@/components/ui/badge.stories")),
      },
      {
        componentId: "@/components/ui/button",
        load: () => Promise.resolve(jest.requireActual("@/components/ui/button.stories")),
      },
    ],
    presentationalComponentCount: 5,
  }),
  { virtual: true }
);

jest.mock("@/utils/react/mountPluginViewRoot", () => ({
  mountPluginViewRoot: jest.fn(),
}));

jest.mock("obsidian", () => {
  class ItemView {
    app: unknown;
    containerEl: HTMLElement;
    contentEl: HTMLElement;
    leaf: unknown;

    constructor(leaf: unknown) {
      this.app = (leaf as { app?: unknown }).app;
      this.leaf = leaf;
      this.containerEl = activeDocument.createElement("div");
      this.containerEl.append(activeDocument.createElement("div"));
      this.contentEl = activeDocument.createElement("div");
      this.contentEl.setText = (text: string) => {
        this.contentEl.textContent = text;
      };
      this.containerEl.append(this.contentEl);
    }
  }

  class Plugin {
    app: unknown;
    manifest: unknown;
    addCommand = jest.fn();
    registerView = jest.fn();

    constructor(app: unknown, manifest: unknown) {
      this.app = app;
      this.manifest = manifest;
    }
  }

  class Modal {}

  return { ItemView, Modal, Plugin };
});

interface GalleryViewContract {
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  getDisplayText(): string;
  getIcon(): string;
  getState(): GalleryViewState;
  getViewType(): string;
  onClose(): Promise<void>;
  onOpen(): Promise<void>;
  setState(state: unknown): Promise<void>;
}

interface RecordedViewState {
  active?: boolean;
  state?: unknown;
  type: string;
}

describe("main", () => {
  let app: App;
  let command: Command;
  let createView: ((leaf: WorkspaceLeaf) => GalleryViewContract) | undefined;
  let getLeaf: jest.Mock;
  let leaf: WorkspaceLeaf;
  let mountViewRoot: jest.MockedFunction<typeof mountPluginViewRoot>;
  let plugin: GalleryPlugin;
  let registerView: jest.Mock;
  let renderView: (() => ReactNode) | undefined;
  let requestSaveLayout: jest.Mock;
  let revealLeaf: jest.Mock;
  let setViewState: jest.Mock<Promise<void>, [RecordedViewState]>;
  let view: GalleryViewContract;
  let viewRoot: PluginViewRootHandle;

  beforeEach(async () => {
    viewRoot = {
      rerender: jest.fn(),
      unmount: jest.fn(),
    };
    mountViewRoot = jest.mocked(mountPluginViewRoot);
    mountViewRoot.mockReset();
    mountViewRoot.mockImplementation((_containerEl, _app, renderTree) => {
      renderView = renderTree;
      return viewRoot;
    });
    requestSaveLayout = jest.fn();
    setViewState = jest.fn<Promise<void>, [RecordedViewState]>().mockResolvedValue(undefined);
    getLeaf = jest.fn();
    revealLeaf = jest.fn();
    app = {
      workspace: { getLeaf, requestSaveLayout, revealLeaf },
    } as unknown as App;
    leaf = { app, setViewState } as unknown as WorkspaceLeaf;
    getLeaf.mockReturnValue(leaf);
    plugin = new GalleryPlugin(app, { id: "copilot-component-gallery" } as PluginManifest);
    const addCommand = jest.mocked(plugin.addCommand);
    registerView = jest.mocked(plugin.registerView);
    addCommand.mockImplementation((registeredCommand) => {
      command = registeredCommand;
      return registeredCommand;
    });
    registerView.mockImplementation((_viewType, viewCreator) => {
      createView = viewCreator as (leaf: WorkspaceLeaf) => GalleryViewContract;
    });

    await plugin.onload();

    if (!createView) {
      throw new Error("Gallery view was not registered");
    }
    view = createView(leaf);
  });

  describe("GalleryView", () => {
    describe("getViewType()", () => {
      it("returns the gallery view type registered by the plugin", () => {
        expect(view.getViewType()).toBe(GALLERY_VIEWTYPE);
      });
    });

    describe("getDisplayText()", () => {
      it("labels the workspace tab as the component gallery", () => {
        expect(view.getDisplayText()).toBe("Component gallery");
      });
    });

    describe("getIcon()", () => {
      it("uses the grid icon for the workspace tab", () => {
        expect(view.getIcon()).toBe("layout-grid");
      });
    });

    describe("getState()", () => {
      it("returns the selected story, subtree, width, and contact-sheet state", async () => {
        await view.setState({
          contactSheet: true,
          selectedStoryId: "UI/Button/Sizes",
          selectedSubtree: "UI",
          width: 600,
        });

        expect(view.getState()).toEqual({
          contactSheet: true,
          selectedStoryId: "UI/Button/Sizes",
          selectedSubtree: "UI",
          width: 600,
        });
      });
    });

    describe("setState()", () => {
      it("restores a persisted story before opening and renders only that story", async () => {
        await view.setState({
          selectedStoryId: "UI/Button/Sizes",
          selectedSubtree: "UI/Button",
          width: 300,
        });
        await view.onOpen();

        if (!renderView) {
          throw new Error("Gallery view did not provide a React tree");
        }
        const gallery = render(renderView() as ReactElement);

        expect(gallery.getByText("UI/Button/Sizes")).toBeTruthy();
        expect(gallery.getByText("Current width:").parentElement?.textContent).toContain("300px");
        expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);
        expect(
          gallery.container.querySelector('[data-gallery-story-id="UI/Button/Sizes"]')
        ).toBeTruthy();

        gallery.unmount();
      });
    });

    describe("onOpen()", () => {
      it("shows a visible nested list, selected marker, exact current id, and one story", async () => {
        await view.onOpen();

        expect(mountViewRoot).toHaveBeenCalledWith(view.containerEl, app, expect.any(Function));
        if (!renderView) {
          throw new Error("Gallery view did not provide a React tree");
        }
        const gallery = render(renderView() as ReactElement);

        expect(
          gallery.getByText("5 presentational components · 3 with stories · 2 missing")
        ).toBeTruthy();
        expect(gallery.getByRole("button", { name: "Show Agent Mode contact sheet" })).toBeTruthy();
        expect(gallery.getByRole("button", { name: "Show UI contact sheet" })).toBeTruthy();
        expect(gallery.getByRole("button", { name: "Default Selected" }).textContent).toContain(
          "Selected"
        );
        expect(gallery.getByText("Agent Mode/Agent Welcome Card/Default")).toBeTruthy();
        expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);

        gallery.unmount();
      });

      it("persists mouse and width changes through ItemView state", async () => {
        await view.onOpen();
        if (!renderView) {
          throw new Error("Gallery view did not provide a React tree");
        }
        const gallery = render(renderView() as ReactElement);

        fireEvent.click(gallery.getByRole("button", { name: "Sizes" }));
        gallery.rerender(renderView() as ReactElement);
        fireEvent.click(gallery.getByRole("button", { name: "600" }));

        expect(view.getState()).toMatchObject({
          contactSheet: false,
          selectedStoryId: "UI/Button/Sizes",
          selectedSubtree: "UI/Button",
          width: 600,
        });
        expect(requestSaveLayout).toHaveBeenCalledTimes(2);

        gallery.unmount();
      });
    });

    describe("onClose()", () => {
      it("unmounts the React root once when the view closes repeatedly", async () => {
        await view.onOpen();

        await view.onClose();
        await view.onClose();

        expect(viewRoot.unmount).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("GalleryPlugin", () => {
    describe("onload()", () => {
      it("registers the gallery view and open command", () => {
        expect(registerView).toHaveBeenCalledWith(GALLERY_VIEWTYPE, expect.any(Function));
        expect(command).toMatchObject({
          id: "open-component-gallery",
          name: "Open component gallery",
        });
      });

      it("opens and reveals a gallery leaf with the last ItemView state", async () => {
        await view.setState({
          selectedStoryId: "UI/Button/Variants",
          selectedSubtree: "UI/Button",
          width: 340,
        });

        await command.callback?.();

        expect(getLeaf).toHaveBeenCalledWith("tab");
        expect(setViewState).toHaveBeenCalledWith({
          type: GALLERY_VIEWTYPE,
          state: {
            contactSheet: false,
            selectedStoryId: "UI/Button/Variants",
            selectedSubtree: "UI/Button",
            width: 340,
          },
          active: true,
        });
        expect(revealLeaf).toHaveBeenCalledWith(leaf);
      });

      it("restores the selected story after its prior tab closes and the command reopens it", async () => {
        await view.onOpen();
        if (!renderView || !createView) {
          throw new Error("Gallery view did not initialize");
        }
        const firstGallery = render(renderView() as ReactElement);
        fireEvent.click(firstGallery.getByRole("button", { name: "Sizes" }));
        firstGallery.rerender(renderView() as ReactElement);
        await view.onClose();
        firstGallery.unmount();

        await command.callback?.();
        const reopenedViewState: unknown = setViewState.mock.calls.at(-1)?.[0].state;
        const reopenedView = createView(leaf);
        await reopenedView.setState(reopenedViewState);
        await reopenedView.onOpen();
        if (!renderView) {
          throw new Error("Reopened gallery view did not provide a React tree");
        }
        const reopenedGallery = render(renderView() as ReactElement);

        expect(reopenedGallery.getByText("UI/Button/Sizes")).toBeTruthy();
        expect(
          reopenedGallery.container.querySelector('[data-gallery-story-id="UI/Button/Sizes"]')
        ).toBeTruthy();

        reopenedGallery.unmount();
      });
    });
  });
});
