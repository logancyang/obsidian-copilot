import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { fireEvent, render, type RenderResult } from "@testing-library/react";
import GalleryPlugin, { GALLERY_VIEWTYPE, type GalleryHandle } from "./main";
import type { AuditReport } from "./audit";
import type { GalleryViewState } from "./Gallery";
import type { App, Command, PluginManifest, WorkspaceLeaf } from "obsidian";
import type { ReactElement, ReactNode } from "react";
import { MessageChannel as TestMessageChannel } from "worker_threads";

jest.mock(
  "./stories.generated",
  () => {
    const loaders = [
      jest.fn(() => Promise.resolve(jest.requireActual("@/agentMode/ui/AgentWelcomeCard.stories"))),
      jest.fn(() => Promise.resolve(jest.requireActual("@/components/ui/badge.stories"))),
      jest.fn(() => Promise.resolve(jest.requireActual("@/components/ui/button.stories"))),
      jest.fn(() => Promise.resolve(jest.requireActual("@/components/gallery-hosts.stories"))),
      jest.fn(() =>
        Promise.resolve({
          default: { title: "Gallery/Test Probes" },
          Broken: {
            render: () => {
              throw new Error("boom");
            },
          },
          Overflow: { render: () => "Overflow probe" },
        })
      ),
    ];
    return {
      modules: [
        {
          componentId: "@/agentMode/ui/AgentWelcomeCard",
          load: loaders[0],
        },
        {
          componentId: "@/components/ui/badge",
          load: loaders[1],
        },
        {
          componentId: "@/components/ui/button",
          load: loaders[2],
        },
        {
          componentId: null,
          load: loaders[3],
        },
        {
          componentId: null,
          load: loaders[4],
        },
      ],
      galleryGeneratedMock: { loaders },
      presentationalComponentCount: 5,
    };
  },
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
  auditStories(widths: number[]): Promise<AuditReport[]>;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  getDisplayText(): string;
  getIcon(): string;
  getState(): GalleryViewState;
  getViewType(): string;
  onClose(): Promise<void>;
  onOpen(): Promise<void>;
  setState(state: unknown): Promise<void>;
  showStory(storyId: string, width?: number): Promise<void>;
}

interface RecordedViewState {
  active?: boolean;
  state?: unknown;
  type: string;
}

function getGeneratedMock(): { loaders: jest.Mock[] } {
  return jest.requireMock<{ galleryGeneratedMock: { loaders: jest.Mock[] } }>("./stories.generated")
    .galleryGeneratedMock;
}

/** Unfolds nested ancestors so a story button becomes clickable. */
function expandStoryPath(gallery: RenderResult, storyId: string): void {
  const segments = storyId.split("/");
  segments.pop();
  let path = "";

  for (const [index, segment] of segments.entries()) {
    path = path ? `${path}/${segment}` : segment;
    if (index === 0) {
      continue;
    }

    const unfoldButton = gallery.queryByRole("button", { name: `Unfold ${path} subtree` });
    if (unfoldButton) {
      fireEvent.click(unfoldButton);
    }
  }
}

describe("main", () => {
  let app: App;
  let command: Command;
  let createView: ((leaf: WorkspaceLeaf) => GalleryViewContract) | undefined;
  let getLeaf: jest.Mock;
  let getLeavesOfType: jest.Mock;
  let getVaultConfig: jest.Mock;
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
    getGeneratedMock().loaders.forEach((loader) => loader.mockClear());
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
    getLeavesOfType = jest.fn().mockReturnValue([]);
    getVaultConfig = jest.fn().mockReturnValue("");
    revealLeaf = jest.fn();
    app = {
      vault: { getConfig: getVaultConfig },
      workspace: { getLeaf, getLeavesOfType, requestSaveLayout, revealLeaf },
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

  afterEach(() => {
    plugin.onunload();
    view.containerEl.remove();
  });

  function installImperativeRenderSimulation(retainedClosedStoryId?: string): jest.Mock {
    activeDocument.body.append(view.containerEl);
    const closeHost = jest.fn();
    const rerender = jest.mocked(viewRoot.rerender);
    rerender.mockImplementation(() => {
      if (!renderView) {
        throw new Error("Gallery view did not provide a React tree");
      }
      const tree = renderView() as ReactElement<{
        catalog: {
          stories: Array<{ host: string; id: string }>;
        };
        onHostChange: (storyId: string, close: (() => void) | null) => void;
        ownerId: string;
        state: GalleryViewState;
      }>;
      const { catalog, onHostChange, ownerId, state } = tree.props;
      const story = catalog.stories.find((candidate) => candidate.id === state.selectedStoryId);
      view.contentEl.replaceChildren();
      if (!story || state.contactSheet) {
        return;
      }

      const storyElement = activeDocument.createElement("div");
      storyElement.dataset.story = story.id;
      storyElement.dataset.storyWidth = String(state.width);
      storyElement.dataset.galleryOwner = ownerId;
      if (story.id === "Gallery/Test Probes/Broken") {
        storyElement.dataset.storyRenderError = "boom";
      }
      Object.defineProperties(storyElement, {
        clientWidth: { configurable: true, value: state.width },
        scrollWidth: {
          configurable: true,
          value:
            story.id === "Gallery/Test Probes/Overflow" && state.width === 300 ? 412 : state.width,
        },
      });
      storyElement.getBoundingClientRect = () => ({ height: 40, width: state.width }) as DOMRect;
      view.contentEl.append(storyElement);

      if (story.host !== "leaf") {
        onHostChange(story.id, () => {
          closeHost(story.id);
          if (story.id === retainedClosedStoryId) {
            storyElement.dataset.state = "closed";
          } else {
            storyElement.remove();
          }
          onHostChange(story.id, null);
        });
      }
    });
    rerender();
    return closeHost;
  }

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
        expect(gallery.getByRole("button", { name: "300" }).getAttribute("aria-pressed")).toBe(
          "true"
        );
        expect(gallery.queryByText("Current width:")).toBeNull();
        expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);
        expect(
          gallery.container.querySelector('[data-gallery-story-id="UI/Button/Sizes"]')
        ).toBeTruthy();

        gallery.unmount();
      });
    });

    describe("showStory()", () => {
      it("mounts an exact story at a positive dynamic width and persists the selection", async () => {
        await view.onOpen();
        installImperativeRenderSimulation();

        await view.showStory("UI/Button/Variants", 512);

        expect(view.getState()).toEqual({
          contactSheet: false,
          selectedStoryId: "UI/Button/Variants",
          selectedSubtree: "UI/Button",
          width: 512,
        });
        expect(
          view.contentEl.querySelector('[data-story="UI/Button/Variants"][data-story-width="512"]')
        ).toBeTruthy();
        expect(requestSaveLayout).toHaveBeenCalledTimes(1);
      });

      it("rejects unknown stories and non-positive widths before changing the view", async () => {
        await view.onOpen();
        installImperativeRenderSimulation();
        const previousState = view.getState();

        await expect(view.showStory("Missing/Story", 300)).rejects.toThrow(
          'Unknown gallery story "Missing/Story"'
        );
        await expect(view.showStory("UI/Button/Variants", 0)).rejects.toThrow(
          "Gallery width must be a positive finite number"
        );
        expect(view.getState()).toEqual(previousState);
      });
    });

    describe("auditStories()", () => {
      it("sweeps one case per width, reports test-only probes, closes hosts, and restores state", async () => {
        await view.setState({
          contactSheet: false,
          selectedStoryId: "UI/Button/Variants",
          selectedSubtree: "UI/Button",
          width: 340,
        });
        await view.onOpen();
        const closeHost = installImperativeRenderSimulation();
        getVaultConfig.mockReturnValue("Things");
        requestSaveLayout.mockClear();

        const reports = await view.auditStories([300, 512]);

        expect(reports).toHaveLength(2);
        expect(reports.map(({ width }) => width)).toEqual([300, 512]);
        expect(reports.every(({ theme }) => theme === "Things-light")).toBe(true);
        expect(getVaultConfig).toHaveBeenCalledWith("cssTheme");
        expect(reports[0].findings).toEqual(
          expect.arrayContaining([
            {
              story: "Gallery/Test Probes/Broken",
              check: "render-failure",
              detail: "boom",
            },
            {
              story: "Gallery/Test Probes/Overflow",
              check: "overflow",
              detail: "scrollWidth 412 > clientWidth 300",
            },
          ])
        );
        expect(
          reports[1].findings.some(
            ({ story, check }) => story === "Gallery/Test Probes/Overflow" && check === "overflow"
          )
        ).toBe(false);
        expect(closeHost).toHaveBeenCalledTimes(6);
        expect(view.getState()).toEqual({
          contactSheet: false,
          selectedStoryId: "UI/Button/Variants",
          selectedSubtree: "UI/Button",
          width: 340,
        });
        expect(requestSaveLayout).not.toHaveBeenCalled();
      });
    });

    describe("onOpen()", () => {
      it("shows a visible nested list, selected styling, exact current id, and one story", async () => {
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
        const selectedStory = gallery.getByRole("button", { name: "Default" });
        expect(selectedStory.getAttribute("aria-current")).toBe("true");
        expect(selectedStory.classList.contains("mod-cta")).toBe(true);
        expect(gallery.queryByText("Selected")).toBeNull();
        expect(gallery.getByText("Agent Mode/Agent Welcome Card/Default")).toBeTruthy();
        expect(gallery.container.querySelectorAll("[data-gallery-story-id]")).toHaveLength(1);

        gallery.unmount();
      });

      it("persists mouse and width changes through ItemView state", async () => {
        await view.onOpen();
        const renderTree = renderView;
        if (!renderTree) {
          throw new Error("Gallery view did not provide a React tree");
        }
        const gallery = render(renderTree() as ReactElement);
        const rerenderGallery = () => gallery.rerender(renderTree() as ReactElement);

        fireEvent.click(gallery.getByRole("button", { name: "600" }));
        rerenderGallery();
        expandStoryPath(gallery, "UI/Button/Disabled");
        fireEvent.click(gallery.getByRole("button", { name: "Disabled" }));

        expect(view.getState()).toMatchObject({
          contactSheet: false,
          selectedStoryId: "UI/Button/Disabled",
          selectedSubtree: "UI/Button",
          width: 600,
        });
        // Tree folds are view-local; only the width and story pick persist.
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
        expect(typeof window.__gallery?.audit).toBe("function");
        expect(typeof window.__gallery?.list).toBe("function");
        expect(typeof window.__gallery?.show).toBe("function");
      });

      it("loads the generated catalog once and shares it across gallery views", async () => {
        const firstView = view;
        const secondView = createView?.(leaf);
        if (!secondView) {
          throw new Error("Second gallery view was not created");
        }

        await firstView.onOpen();
        await secondView.onOpen();

        expect(firstView.getState().selectedStoryId).toBe("Agent Mode/Agent Welcome Card/Default");
        expect(secondView.getState().selectedStoryId).toBe("Agent Mode/Agent Welcome Card/Default");
        expect(mountViewRoot).toHaveBeenCalledTimes(2);
        expect(getGeneratedMock().loaders.every((loader) => loader.mock.calls.length === 1)).toBe(
          true
        );
      });

      it("lists every story and drives an existing revealed view through the typed handle", async () => {
        await view.onOpen();
        installImperativeRenderSimulation();
        (leaf as unknown as { view: GalleryViewContract }).view = view;
        getLeavesOfType.mockReturnValue([leaf]);
        const handle = window.__gallery as GalleryHandle;

        expect(handle.list()).toEqual([
          "Agent Mode/Agent Welcome Card/Default",
          "Gallery/Host Environments/DefaultLeaf",
          "Gallery/Host Environments/DeleteConfirmation",
          "Gallery/Host Environments/ModelPreferences",
          "Gallery/Host Environments/ResponseActions",
          "Gallery/Test Probes/Broken",
          "Gallery/Test Probes/Overflow",
          "UI/Badge/Accent",
          "UI/Badge/Status",
          "UI/Badge/Success",
          "UI/Badge/Variants",
          "UI/Button/Disabled",
          "UI/Button/Sizes",
          "UI/Button/Variants",
        ]);

        await handle.show("UI/Button/Sizes", { width: 512 });

        expect(getLeaf).not.toHaveBeenCalled();
        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(view.getState()).toMatchObject({
          selectedStoryId: "UI/Button/Sizes",
          width: 512,
        });
      });

      it("settles a background audit after restoring state with a retained closed popover", async () => {
        const previousState = {
          contactSheet: false,
          selectedStoryId: "Gallery/Host Environments/DefaultLeaf",
          selectedSubtree: "Gallery/Host Environments",
          width: 340,
        };
        await view.setState(previousState);
        await view.onOpen();
        const closeHost = installImperativeRenderSimulation(
          "Gallery/Host Environments/ResponseActions"
        );
        (leaf as unknown as { view: GalleryViewContract }).view = view;
        getLeavesOfType.mockReturnValue([leaf]);
        const handle = window.__gallery as GalleryHandle;
        const win = view.containerEl.win;
        const messageChannelDescriptor = Object.getOwnPropertyDescriptor(win, "MessageChannel");
        Object.defineProperty(win, "MessageChannel", {
          configurable: true,
          value: TestMessageChannel,
        });
        const documentHasFocus = jest.spyOn(activeDocument, "hasFocus").mockReturnValue(false);
        const animationFrame = jest.spyOn(win, "requestAnimationFrame").mockReturnValue(1);
        const timeout = jest.spyOn(win, "setTimeout").mockReturnValue(1);

        try {
          const reports = await handle.audit({ widths: [300] });

          expect(closeHost).toHaveBeenCalledWith("Gallery/Host Environments/ResponseActions");
          expect(reports[0].findings).toContainEqual({
            story: "Gallery/Test Probes/Broken",
            check: "render-failure",
            detail: "boom",
          });
          expect(view.getState()).toEqual(previousState);
          expect(animationFrame).not.toHaveBeenCalled();
          expect(timeout).not.toHaveBeenCalled();
        } finally {
          animationFrame.mockRestore();
          timeout.mockRestore();
          documentHasFocus.mockRestore();
          if (messageChannelDescriptor) {
            Object.defineProperty(win, "MessageChannel", messageChannelDescriptor);
          } else {
            Reflect.deleteProperty(win, "MessageChannel");
          }
        }
      });

      it("rejects invalid external widths before opening a view", async () => {
        const handle = window.__gallery as GalleryHandle;

        await expect(handle.show("UI/Button/Sizes", { width: Number.NaN })).rejects.toThrow(
          "Gallery width must be a positive finite number"
        );
        await expect(handle.audit({ widths: [300, -1] })).rejects.toThrow(
          "Gallery audit widths must be positive finite numbers"
        );
        expect(getLeaf).not.toHaveBeenCalled();
        expect(revealLeaf).not.toHaveBeenCalled();
      });

      it("serializes external operations, restores prior state, and continues after rejection", async () => {
        const previousState = {
          contactSheet: false,
          selectedStoryId: "UI/Button/Variants",
          selectedSubtree: "UI/Button",
          width: 340,
        };
        await view.setState(previousState);
        await view.onOpen();
        installImperativeRenderSimulation();
        (leaf as unknown as { view: GalleryViewContract }).view = view;
        getLeavesOfType.mockReturnValue([leaf]);
        const handle = window.__gallery as GalleryHandle;
        const originalShowStory: GalleryViewContract["showStory"] = view.showStory;
        let markAuditStarted: () => void = () => undefined;
        let releaseAudit: () => void = () => undefined;
        const auditStarted = new Promise<void>((resolve) => {
          markAuditStarted = resolve;
        });
        const auditRelease = new Promise<void>((resolve) => {
          releaseAudit = resolve;
        });
        jest.spyOn(view, "auditStories").mockImplementationOnce(async () => {
          await originalShowStory.call(view, "Gallery/Host Environments/DeleteConfirmation", 300);
          markAuditStarted();
          await auditRelease;
          await view.setState(previousState);
          throw new Error("audit failed");
        });
        const stateBeforeShow: GalleryViewState[] = [];
        const showStory = jest.spyOn(view, "showStory").mockImplementation(async (id, width) => {
          stateBeforeShow.push(view.getState());
          await originalShowStory.call(view, id, width);
        });

        const firstOperation = handle.audit({ widths: [300] });
        await auditStarted;
        const secondOperation = handle.show("UI/Button/Sizes", { width: 512 });
        await Promise.resolve();

        expect(showStory).not.toHaveBeenCalled();
        expect(view.getState()).toMatchObject({
          selectedStoryId: "Gallery/Host Environments/DeleteConfirmation",
          width: 300,
        });

        releaseAudit();
        await expect(firstOperation).rejects.toThrow("audit failed");
        await secondOperation;

        expect(stateBeforeShow).toEqual([previousState]);
        expect(view.getState()).toEqual({
          contactSheet: false,
          selectedStoryId: "UI/Button/Sizes",
          selectedSubtree: "UI/Button",
          width: 512,
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
        const renderTree = renderView;
        if (!renderTree || !createView) {
          throw new Error("Gallery view did not initialize");
        }
        const firstGallery = render(renderTree() as ReactElement);
        const rerenderGallery = () => firstGallery.rerender(renderTree() as ReactElement);
        expandStoryPath(firstGallery, "UI/Button/Sizes");
        fireEvent.click(firstGallery.getByRole("button", { name: "Sizes" }));
        rerenderGallery();
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

    describe("onunload()", () => {
      it("cancels the active host and rejects work still queued for the plugin", async () => {
        await view.onOpen();
        const closeHost = installImperativeRenderSimulation();
        (leaf as unknown as { view: GalleryViewContract }).view = view;
        getLeavesOfType.mockReturnValue([leaf]);
        const handle = window.__gallery as GalleryHandle;

        await handle.show("Gallery/Host Environments/ResponseActions", { width: 300 });
        plugin.onunload();

        expect(closeHost).toHaveBeenCalledWith("Gallery/Host Environments/ResponseActions");
        await expect(handle.show("UI/Button/Sizes")).rejects.toMatchObject({ name: "AbortError" });
      });

      it("removes only the handle still owned by the unloading plugin instance", async () => {
        const firstHandle = window.__gallery;
        const replacement = new GalleryPlugin(app, {
          id: "copilot-component-gallery",
        } as PluginManifest);
        await replacement.onload();
        const replacementHandle = window.__gallery;

        plugin.onunload();
        expect(window.__gallery).toBe(replacementHandle);
        expect(window.__gallery).not.toBe(firstHandle);

        replacement.onunload();
        expect(window.__gallery).toBeUndefined();
      });
    });
  });
});
