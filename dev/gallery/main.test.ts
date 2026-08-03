import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { render, within } from "@testing-library/react";
import GalleryPlugin, { GALLERY_VIEWTYPE } from "./main";
import type { App, Command, PluginManifest, WorkspaceLeaf } from "obsidian";
import type { ReactElement, ReactNode } from "react";

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

  return { ItemView, Plugin };
});

interface GalleryViewContract {
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  getDisplayText(): string;
  getIcon(): string;
  getViewType(): string;
  onClose(): Promise<void>;
  onOpen(): Promise<void>;
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
  let revealLeaf: jest.Mock;
  let setViewState: jest.Mock;
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
    setViewState = jest.fn().mockResolvedValue(undefined);
    getLeaf = jest.fn();
    revealLeaf = jest.fn();
    app = {
      workspace: { getLeaf, revealLeaf },
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

    describe("onOpen()", () => {
      it("mounts all Button variants and sizes in the gallery content", async () => {
        await view.onOpen();

        expect(mountViewRoot).toHaveBeenCalledWith(view.containerEl, app, expect.any(Function));
        if (!renderView) {
          throw new Error("Gallery view did not provide a React tree");
        }

        const gallery = render(renderView() as ReactElement);
        const variants = [
          "default",
          "destructive",
          "secondary",
          "ghost",
          "link",
          "success",
          "ghost2",
        ];
        const sizes = ["default", "sm", "lg", "icon", "fit"];

        expect(gallery.getAllByRole("button")).toHaveLength(35);
        for (const variant of variants) {
          const row = within(gallery.getByRole("region", { name: `${variant} Button variant` }));
          expect(row.getByText(variant, { selector: "span" })).toBeTruthy();
          expect(row.getAllByRole("button").map((button) => button.textContent)).toEqual(sizes);
        }

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

      it("opens and reveals the gallery in a new tab", async () => {
        await command.callback?.();

        expect(getLeaf).toHaveBeenCalledWith("tab");
        expect(setViewState).toHaveBeenCalledWith({ type: GALLERY_VIEWTYPE, active: true });
        expect(revealLeaf).toHaveBeenCalledWith(leaf);
      });
    });
  });
});
