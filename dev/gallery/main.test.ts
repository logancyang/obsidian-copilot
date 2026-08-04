import * as buttonStories from "@/components/ui/button.stories";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import { render, within } from "@testing-library/react";
import GalleryPlugin, { GALLERY_VIEWTYPE } from "./main";
import type { App, Command, PluginManifest, WorkspaceLeaf } from "obsidian";
import { createElement, useState, type ReactElement, type ReactNode } from "react";

jest.mock(
  "./stories.generated",
  () => ({
    modules: [
      {
        componentId: "@/components/ui/button",
        load: () => Promise.resolve(jest.requireActual("@/components/ui/button.stories")),
      },
    ],
    presentationalComponentCount: 3,
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
  renderTree(
    storyModules: Array<{
      componentId: string | null;
      storyModule: unknown;
    }>
  ): ReactNode;
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
      it("loads and renders every named Button story export with merged metadata", async () => {
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
        const storyNames = Object.keys(buttonStories).filter(
          (exportName) => exportName !== "default"
        );
        expect(
          gallery.getByText("3 presentational components · 1 with stories · 2 missing")
        ).toBeTruthy();
        const buttonGroup = gallery.getByRole("region", { name: "UI / Button stories" });
        const disabledStory = within(buttonGroup).getByRole("region", {
          name: "Disabled story",
        });
        const variantsStory = within(buttonGroup).getByRole("region", {
          name: "Variants story",
        });
        const sizesStory = within(buttonGroup).getByRole("region", { name: "Sizes story" });

        expect(
          within(buttonGroup).getByRole("heading", { level: 2, name: "UI / Button" })
        ).toBeTruthy();
        expect(within(buttonGroup).getByText(`${storyNames.length} stories`)).toBeTruthy();
        expect(within(buttonGroup).getAllByRole("region")).toHaveLength(storyNames.length);
        for (const storyName of storyNames) {
          expect(
            within(
              within(buttonGroup).getByRole("region", { name: `${storyName} story` })
            ).getByRole("heading", { level: 3, name: storyName })
          ).toBeTruthy();
        }

        const disabledButton = within(disabledStory).getByRole("button", { name: "Working…" });
        expect((disabledButton as HTMLButtonElement).disabled).toBe(true);
        expect(disabledButton.getAttribute("type")).toBe("button");
        expect(disabledStory.dataset.galleryHost).toBe("leaf");
        expect(disabledStory.dataset.galleryLayout).toBe("padded");
        expect(disabledStory.dataset.galleryWidth).toBe("300");
        expect(
          within(variantsStory)
            .getAllByRole("button")
            .map((button) => button.textContent)
        ).toEqual(variants);
        expect(
          within(sizesStory)
            .getAllByRole("button")
            .map((button) => button.textContent)
        ).toEqual(sizes);

        gallery.unmount();
      });
    });

    describe("renderTree()", () => {
      it("groups multiple modules under human-readable titles with named story counts", () => {
        const gallery = render(
          view.renderTree([
            {
              componentId: "@/components/ui/first",
              storyModule: {
                default: { title: "UI/First" },
                Only: { render: () => "First story" },
              },
            },
            {
              componentId: null,
              storyModule: {
                default: { title: "Forms/Inputs/Second" },
                Empty: { render: () => "Empty story" },
                Filled: { render: () => "Filled story" },
              },
            },
            {
              componentId: "@/components/ui/empty",
              storyModule: {
                default: { title: "UI/Empty" },
              },
            },
          ]) as ReactElement
        );

        const firstGroup = gallery.getByRole("region", { name: "UI / First stories" });
        const secondGroup = gallery.getByRole("region", {
          name: "Forms / Inputs / Second stories",
        });

        expect(within(firstGroup).getByText("1 story")).toBeTruthy();
        expect(within(secondGroup).getByText("2 stories")).toBeTruthy();
        expect(
          gallery.getByText("3 presentational components · 1 with stories · 2 missing")
        ).toBeTruthy();
        expect(within(firstGroup).getByRole("region", { name: "Only story" })).toBeTruthy();
        expect(within(secondGroup).getByRole("region", { name: "Filled story" })).toBeTruthy();

        gallery.unmount();
      });

      it("excludes meta-level coverage opt-outs without counting wired stories", () => {
        const gallery = render(
          view.renderTree([
            {
              componentId: "@/components/ui/covered",
              storyModule: {
                default: { title: "UI/Covered" },
                Example: {
                  parameters: { gallery: { coverage: false } },
                  render: () => "Covered story",
                },
              },
            },
            {
              componentId: "@/components/ui/opted-out",
              storyModule: {
                default: {
                  title: "UI/OptedOut",
                  parameters: { gallery: { coverage: false } },
                },
                Example: { render: () => "Opted-out story" },
              },
            },
            {
              componentId: null,
              storyModule: {
                default: { title: "Feature/Wired" },
                Example: { render: () => "Bonus story" },
              },
            },
          ]) as ReactElement
        );

        expect(
          gallery.getByText("2 presentational components · 1 with stories · 1 missing")
        ).toBeTruthy();

        gallery.unmount();
      });

      it("rejects a story without a render function or meta component", () => {
        expect(() =>
          view.renderTree([
            {
              componentId: "@/components/ui/missing-component",
              storyModule: {
                default: { title: "UI/MissingComponent" },
                Broken: {},
              },
            },
          ])
        ).toThrow('Story "UI/MissingComponent/Broken" must define render or meta.component');
      });

      it("renders story functions through React and uses their authored display names", () => {
        function HookStory(): ReactElement {
          const [label] = useState("Hook-backed story");
          return createElement("span", null, label);
        }

        const gallery = render(
          view.renderTree([
            {
              componentId: null,
              storyModule: {
                default: { title: "UI/HookStory" },
                ExportName: { name: "Display name", render: HookStory },
              },
            },
          ]) as ReactElement
        );

        const story = gallery.getByRole("region", { name: "Display name story" });
        expect(within(story).getByRole("heading", { level: 3, name: "Display name" })).toBeTruthy();
        expect(within(story).getByText("Hook-backed story")).toBeTruthy();

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
