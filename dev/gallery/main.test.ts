import GalleryPlugin, { GALLERY_VIEWTYPE } from "./main";
import type { App, Command, PluginManifest, WorkspaceLeaf } from "obsidian";

jest.mock("obsidian", () => {
  class ItemView {
    app: unknown;
    containerEl: HTMLElement;
    contentEl: HTMLElement;
    leaf: unknown;

    constructor(leaf: unknown) {
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
  contentEl: HTMLElement;
  getDisplayText(): string;
  getIcon(): string;
  getViewType(): string;
  onOpen(): Promise<void>;
}

describe("main", () => {
  let app: App;
  let command: Command;
  let createView: ((leaf: WorkspaceLeaf) => GalleryViewContract) | undefined;
  let getLeaf: jest.Mock;
  let leaf: WorkspaceLeaf;
  let plugin: GalleryPlugin;
  let registerView: jest.Mock;
  let revealLeaf: jest.Mock;
  let setViewState: jest.Mock;
  let view: GalleryViewContract;

  beforeEach(async () => {
    setViewState = jest.fn().mockResolvedValue(undefined);
    leaf = { setViewState } as unknown as WorkspaceLeaf;
    getLeaf = jest.fn().mockReturnValue(leaf);
    revealLeaf = jest.fn();
    app = {
      workspace: { getLeaf, revealLeaf },
    } as unknown as App;
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
      it("renders the empty story count in the view content", async () => {
        await view.onOpen();

        expect(view.contentEl.textContent).toBe("Gallery: 0 stories");
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
